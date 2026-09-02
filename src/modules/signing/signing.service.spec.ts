import { ForbiddenException } from '@nestjs/common';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { sha256Hex } from '../../common/utils/hash';
import { SupabaseFake, fakeConfig } from '../../testing/supabase-fake';
import { AuditService } from '../audit/audit.service';
import type { EnvelopesService } from '../envelopes/envelopes.service';
import { CertificateService } from './pdf/certificate.service';
import { PdfStampService } from './pdf/pdf-stamp.service';
import { SigningService } from './signing.service';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const ENVELOPE = 'env-1';
const USER = 'user-1';

async function contractBytes(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText('CONTRATO', { x: 60, y: 700, size: 14, font });
  return Buffer.from(await doc.save());
}

const signerRow = (id: string, order: number, status: string) => ({
  id,
  envelope_id: ENVELOPE,
  order_index: order,
  full_name: `Firmante ${order + 1}`,
  email: `f${order + 1}@example.cl`,
  role_label: null,
  status,
  signed_at: null,
  declined_at: null,
  decline_reason: null,
  signed_ip: null,
  signed_user_agent: null,
  created_at: new Date().toISOString(),
});

const fieldRow = (id: string, signerId: string, y: number) => ({
  id,
  envelope_id: ENVELOPE,
  signer_id: signerId,
  page_number: 1,
  x: 0.1,
  y,
  w: 0.3,
  h: 0.06,
  type: 'signature',
  required: true,
  value_text: null,
});

async function setup(mode: 'sequential' | 'parallel') {
  const db = new SupabaseFake();
  const original = await contractBytes();
  const storage = new Map<string, Buffer>([['v0.pdf', original]]);

  const envelope = {
    id: ENVELOPE,
    user_id: USER,
    name: 'Contrato',
    mode,
    status: 'sent',
    verification_code: null,
    page_count: 1,
    current_version: 0,
    original_pdf_path: 'original.pdf',
    current_pdf_path: 'v0.pdf',
    final_pdf_path: null,
    original_sha256: sha256Hex(original),
    final_sha256: null,
  };

  const signers = [
    signerRow('s1', 0, mode === 'sequential' ? 'pending' : 'pending'),
    signerRow('s2', 1, mode === 'sequential' ? 'waiting' : 'pending'),
  ];
  const fields = [fieldRow('f1', 's1', 0.7), fieldRow('f2', 's2', 0.8)];

  db.seed('envelopes', [envelope]);
  db.seed('envelope_signers', signers);
  db.seed('signature_fields', fields);

  const envelopes = {
    getBundle: async () => ({
      envelope: db.rows('envelopes')[0] as any,
      signers: db.rows('envelope_signers') as any,
      fields: db.rows('signature_fields') as any,
    }),
    download: async (path: string) => storage.get(path)!,
    upload: async (path: string, bytes: Buffer) => {
      storage.set(path, bytes);
    },
    storagePath: (_u: string, _e: string, file: string) => file,
    generateVerificationCode: () => 'A1B2-C3D4-E5F6',
  } as unknown as EnvelopesService;

  const service = new SigningService(
    db.asService(),
    envelopes,
    new PdfStampService(),
    new CertificateService(),
    new AuditService(db.asService()),
    fakeConfig({ 'app.verifyBaseUrl': 'https://app.example.cl' }),
  );

  return { db, service, storage, original };
}

describe('SigningService (secuencial)', () => {
  it('impide firmar fuera de turno', async () => {
    const { service } = await setup('sequential');

    await expect(
      service.submitSignature({
        envelopeId: ENVELOPE,
        signerId: 's2',
        signatureBase64: PNG_1X1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('firma el primero, habilita al segundo y no cierra el sobre', async () => {
    const { db, service } = await setup('sequential');

    const result = await service.submitSignature({
      envelopeId: ENVELOPE,
      signerId: 's1',
      signatureBase64: PNG_1X1,
    });

    expect(result.completed).toBe(false);
    expect(result.version).toBe(1);

    const signers = db.rows('envelope_signers');
    expect(signers.find((s) => s.id === 's1')!.status).toBe('signed');
    expect(signers.find((s) => s.id === 's2')!.status).toBe('pending');
    expect(db.rows('envelopes')[0].status).toBe('in_progress');
    expect(db.rows('envelopes')[0].final_pdf_path).toBeFalsy();
  });

  it('el segundo firma sobre el PDF que dejó el primero', async () => {
    const { service, storage, original } = await setup('sequential');

    await service.submitSignature({ envelopeId: ENVELOPE, signerId: 's1', signatureBase64: PNG_1X1 });
    const afterFirst = storage.get('v1.pdf')!;
    expect(sha256Hex(afterFirst)).not.toBe(sha256Hex(original));

    await service.submitSignature({ envelopeId: ENVELOPE, signerId: 's2', signatureBase64: PNG_1X1 });
    const afterSecond = storage.get('v2.pdf')!;

    // Cada versión parte de la anterior, no del original
    expect(afterSecond.length).toBeGreaterThan(afterFirst.length);
  });

  it('cierra el sobre al firmar el último y añade la hoja de certificación', async () => {
    const { db, service, storage } = await setup('sequential');

    await service.submitSignature({ envelopeId: ENVELOPE, signerId: 's1', signatureBase64: PNG_1X1 });
    const result = await service.submitSignature({
      envelopeId: ENVELOPE,
      signerId: 's2',
      signatureBase64: PNG_1X1,
    });

    expect(result.completed).toBe(true);

    const envelope = db.rows('envelopes')[0];
    expect(envelope.status).toBe('completed');
    expect(envelope.verification_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(envelope.final_sha256).toHaveLength(64);
    expect(envelope.completed_at).toBeTruthy();

    // El original tiene 1 página; el final añade la hoja de certificación
    const final = await PDFDocument.load(storage.get('final.pdf')!);
    expect(final.getPageCount()).toBe(2);
  });

  it('registra una versión por firma con su hash', async () => {
    const { db, service } = await setup('sequential');

    await service.submitSignature({ envelopeId: ENVELOPE, signerId: 's1', signatureBase64: PNG_1X1 });
    await service.submitSignature({ envelopeId: ENVELOPE, signerId: 's2', signatureBase64: PNG_1X1 });

    const versions = db.rows('envelope_versions');
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    for (const version of versions) {
      expect(version.sha256).toHaveLength(64);
      expect(version.created_by_signer_id).toBeTruthy();
    }
    // Cada firma cambia el documento
    expect(versions[0].sha256).not.toBe(versions[1].sha256);
  });

  it('deja traza de auditoría con el hash antes y después', async () => {
    const { db, service } = await setup('sequential');

    await service.submitSignature({ envelopeId: ENVELOPE, signerId: 's1', signatureBase64: PNG_1X1 });

    const signed = db.rows('audit_events').find((e) => e.event_type === 'signer.signed');
    expect(signed).toBeDefined();
    expect(signed!.sha256_before).toHaveLength(64);
    expect(signed!.sha256_after).toHaveLength(64);
    expect(signed!.sha256_before).not.toBe(signed!.sha256_after);
    expect(signed!.actor_type).toBe('signer');
  });

  it('impide firmar dos veces al mismo firmante', async () => {
    const { service } = await setup('sequential');

    await service.submitSignature({ envelopeId: ENVELOPE, signerId: 's1', signatureBase64: PNG_1X1 });
    await expect(
      service.submitSignature({ envelopeId: ENVELOPE, signerId: 's1', signatureBase64: PNG_1X1 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SigningService (paralelo)', () => {
  it('permite firmar en cualquier orden', async () => {
    const { db, service } = await setup('parallel');

    await service.submitSignature({ envelopeId: ENVELOPE, signerId: 's2', signatureBase64: PNG_1X1 });
    expect(db.rows('envelopes')[0].status).toBe('in_progress');

    const result = await service.submitSignature({
      envelopeId: ENVELOPE,
      signerId: 's1',
      signatureBase64: PNG_1X1,
    });
    expect(result.completed).toBe(true);
  });

  it('una colisión de versión se rechaza con un mensaje accionable', async () => {
    const { db, service } = await setup('parallel');

    // Simula que otro firmante insertó la versión 1 entre medias
    db.failNextInsert = true;

    await expect(
      service.submitSignature({ envelopeId: ENVELOPE, signerId: 's1', signatureBase64: PNG_1X1 }),
    ).rejects.toThrow('Otro firmante acaba de firmar');
  });
});

describe('SigningService.decline', () => {
  it('rechaza el sobre y lo deja bloqueado', async () => {
    const { db, service } = await setup('sequential');

    await service.decline({ envelopeId: ENVELOPE, signerId: 's1', reason: 'No conforme' });

    expect(db.rows('envelopes')[0].status).toBe('declined');
    expect(db.rows('envelope_signers').find((s) => s.id === 's1')!.decline_reason).toBe('No conforme');

    await expect(
      service.submitSignature({ envelopeId: ENVELOPE, signerId: 's1', signatureBase64: PNG_1X1 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no permite rechazar fuera de turno', async () => {
    const { service } = await setup('sequential');

    await expect(
      service.decline({ envelopeId: ENVELOPE, signerId: 's2', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

import { ForbiddenException } from '@nestjs/common';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { sha256Hex } from '../../common/utils/hash';
import { SupabaseFake, fakeConfig } from '../../testing/supabase-fake';
import { AuditService } from '../audit/audit.service';
import { DocumentAuditService } from '../audit/document-audit.service';
import type { EnvelopesService } from '../envelopes/envelopes.service';
import { LegalService } from '../legal/legal.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SignatureSubmission } from './signature-submission';
import { CertificateService } from './pdf/certificate.service';
import { PdfStampService } from './pdf/pdf-stamp.service';
import { SigningService, initialsOf } from './signing.service';

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
  allowed_methods: ['draw', 'type', 'upload', 'click'],
  signature_method: null,
  signature_level: null,
  auth_method: null,
  signature_image_path: null,
  require_rut: false,
  identity_rut: null,
  consent_accepted_at: null,
  consent_sha256: null,
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
    document_type: 'nda',
    required_level: 'fes',
    legal_framework: 'CL',
    consent_text: 'Acepto firmar electrónicamente.',
  };

  const signers = [
    signerRow('s1', 0, mode === 'sequential' ? 'pending' : 'pending'),
    signerRow('s2', 1, mode === 'sequential' ? 'waiting' : 'pending'),
  ];
  const fields = [fieldRow('f1', 's1', 0.7), fieldRow('f2', 's2', 0.8)];

  db.seed('envelopes', [envelope]);
  db.seed('envelope_signers', signers);
  db.seed('signature_fields', fields);

  /** A quién se avisó de que le tocaba firmar. */
  const turnNotices: string[] = [];

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
    uploadBinary: async (path: string, bytes: Buffer) => {
      storage.set(path, bytes);
    },
    storagePath: (_u: string, _e: string, file: string) => file,
    generateVerificationCode: () => 'A1B2-C3D4-E5F6',
    notifyTurn: async (_envelope: unknown, signer: { email: string }) => {
      turnNotices.push(signer.email);
    },
  } as unknown as EnvelopesService;

  // Doble de correo: estas pruebas ejercitan el estampado, no el envío, y sin
  // esto cada firma intentaría salir a la red.
  const sentMail: Array<{ to: string; tag?: string }> = [];
  const mail = {
    isConfigured: true,
    send: async (params: { to: string; tag?: string }) => {
      sentMail.push({ to: params.to, tag: params.tag });
      return { id: 'test', delivered: true };
    },
  } as unknown as MailService;

  const service = new SigningService(
    db.asService(),
    envelopes,
    new PdfStampService(),
    new CertificateService(),
    new AuditService(db.asService()),
    new DocumentAuditService(db.asService()),
    new NotificationsService(db.asService(), mail, fakeConfig({})),
    new LegalService(),
    fakeConfig({ 'app.verifyBaseUrl': 'https://app.example.cl' }),
  );

  /** Firma con los valores por defecto del portal, salvo lo que se sobrescriba. */
  const sign = (signerId: string, patch: Partial<SignatureSubmission> = {}) =>
    service.submitSignature({
      envelopeId: ENVELOPE,
      signerId,
      fullName: `Firmante ${signerId === 's1' ? 1 : 2}`,
      submission: {
        method: 'draw',
        consentAccepted: true,
        authMethod: 'email_otp',
        signatureImageBase64: PNG_1X1,
        ...patch,
      },
    });

  return { db, service, storage, original, sign, sentMail, turnNotices };
}

describe('SigningService (secuencial)', () => {
  it('impide firmar fuera de turno', async () => {
    const { sign } = await setup('sequential');

    await expect(
      sign('s2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('firma el primero, habilita al segundo y no cierra el sobre', async () => {
    const { db, sign } = await setup('sequential');

    const result = await sign('s1');

    expect(result.completed).toBe(false);
    expect(result.version).toBe(1);

    const signers = db.rows('envelope_signers');
    expect(signers.find((s) => s.id === 's1')!.status).toBe('signed');
    expect(signers.find((s) => s.id === 's2')!.status).toBe('pending');
    expect(db.rows('envelopes')[0].status).toBe('in_progress');
    expect(db.rows('envelopes')[0].final_pdf_path).toBeFalsy();
  });

  it('el segundo firma sobre el PDF que dejó el primero', async () => {
    const { storage, original, sign } = await setup('sequential');

    await sign('s1');
    const afterFirst = storage.get('v1.pdf')!;
    expect(sha256Hex(afterFirst)).not.toBe(sha256Hex(original));

    await sign('s2');
    const afterSecond = storage.get('v2.pdf')!;

    // Cada versión parte de la anterior, no del original
    expect(afterSecond.length).toBeGreaterThan(afterFirst.length);
  });

  it('cierra el sobre al firmar el último y añade la hoja de certificación', async () => {
    const { db, storage, sign } = await setup('sequential');

    await sign('s1');
    const result = await sign('s2');

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
    const { db, sign } = await setup('sequential');

    await sign('s1');
    await sign('s2');

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
    const { db, sign } = await setup('sequential');

    await sign('s1');

    const signed = db.rows('audit_events').find((e) => e.event_type === 'signer.signed');
    expect(signed).toBeDefined();
    expect(signed!.sha256_before).toHaveLength(64);
    expect(signed!.sha256_after).toHaveLength(64);
    expect(signed!.sha256_before).not.toBe(signed!.sha256_after);
    expect(signed!.actor_type).toBe('signer');
  });

  it('impide firmar dos veces al mismo firmante', async () => {
    const { sign } = await setup('sequential');

    await sign('s1');
    await expect(
      sign('s1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SigningService (paralelo)', () => {
  it('permite firmar en cualquier orden', async () => {
    const { db, sign } = await setup('parallel');

    await sign('s2');
    expect(db.rows('envelopes')[0].status).toBe('in_progress');

    const result = await sign('s1');
    expect(result.completed).toBe(true);
  });

  it('una colisión de versión se rechaza con un mensaje accionable', async () => {
    const { db, sign } = await setup('parallel');

    // Simula que otro firmante insertó la versión 1 entre medias
    db.failNextInsert = true;

    await expect(
      sign('s1'),
    ).rejects.toThrow('Otro firmante acaba de firmar');
  });
});

describe('SigningService.decline', () => {
  it('rechaza el sobre y lo deja bloqueado', async () => {
    const { db, service, sign } = await setup('sequential');

    await service.decline({ envelopeId: ENVELOPE, signerId: 's1', reason: 'No conforme' });

    expect(db.rows('envelopes')[0].status).toBe('declined');
    expect(db.rows('envelope_signers').find((s) => s.id === 's1')!.decline_reason).toBe('No conforme');

    await expect(
      sign('s1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no permite rechazar fuera de turno', async () => {
    const { service } = await setup('sequential');

    await expect(
      service.decline({ envelopeId: ENVELOPE, signerId: 's2', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SigningService: métodos de firma', () => {
  it('registra el método, el nivel y la forma de identificación', async () => {
    const { db, sign } = await setup('sequential');

    await sign('s1', { method: 'draw', authMethod: 'email_otp', rut: '12.345.678-5' });

    const signer = db.rows('envelope_signers').find((s) => s.id === 's1')!;
    expect(signer.signature_method).toBe('draw');
    expect(signer.auth_method).toBe('email_otp');
    expect(signer.signature_level).toBe('fes_verificada');
    expect(signer.identity_rut).toBe('12.345.678-5');
    expect(signer.consent_accepted_at).toBeTruthy();
    expect(signer.consent_sha256).toHaveLength(64);
  });

  it('no declara identidad verificada cuando falta el RUT', async () => {
    const { db, sign } = await setup('sequential');

    await sign('s1', { method: 'draw', authMethod: 'email_otp' });

    expect(db.rows('envelope_signers').find((s) => s.id === 's1')!.signature_level).toBe('fes');
  });

  it('rechaza firmar sin aceptar el consentimiento', async () => {
    const { sign } = await setup('sequential');

    await expect(sign('s1', { consentAccepted: false })).rejects.toThrow(/aceptar expresamente/);
  });

  it('rechaza el método que el sobre no permite', async () => {
    const { db, sign } = await setup('sequential');

    db.rows('envelope_signers').find((s) => s.id === 's1')!.allowed_methods = ['draw'];

    await expect(sign('s1', { method: 'type', typedName: 'Firmante 1' })).rejects.toThrow(
      /no admite firmar/,
    );
  });

  it('exige el RUT cuando el firmante lo tiene marcado', async () => {
    const { db, sign } = await setup('sequential');

    db.rows('envelope_signers').find((s) => s.id === 's1')!.require_rut = true;

    await expect(sign('s1')).rejects.toThrow(/RUT/);
  });

  it('rechaza un RUT con dígito verificador incorrecto', async () => {
    const { sign } = await setup('sequential');

    await expect(sign('s1', { rut: '12.345.678-9' })).rejects.toThrow(/dígito verificador/);
  });

  it('firma escrita: compone el nombre sin exigir imagen', async () => {
    const { db, sign } = await setup('sequential');

    const result = await sign('s1', {
      method: 'type',
      typedName: 'Firmante 1',
      typedStyle: 'clasico',
      signatureImageBase64: undefined,
    });

    expect(result.version).toBe(1);
    const signer = db.rows('envelope_signers').find((s) => s.id === 's1')!;
    expect(signer.signature_method).toBe('type');
    // Escribir el nombre no es un grafismo propio: no llega a verificada.
    expect(signer.signature_level).toBe('fes');
  });

  it('firma escrita: no acepta firmar con el nombre de otra persona', async () => {
    const { sign } = await setup('sequential');

    await expect(
      sign('s1', { method: 'type', typedName: 'Otra Persona', signatureImageBase64: undefined }),
    ).rejects.toThrow(/debe corresponder a tu nombre/);
  });

  it('exige la imagen cuando el método la necesita', async () => {
    const { sign } = await setup('sequential');

    await expect(sign('s1', { method: 'draw', signatureImageBase64: undefined })).rejects.toThrow(
      /Dibuja tu firma/,
    );
  });

  it('rechaza una imagen que no es PNG', async () => {
    const { sign } = await setup('sequential');

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).toString('base64');
    await expect(sign('s1', { signatureImageBase64: jpeg })).rejects.toThrow(/formato PNG/);
  });

  it('acepta la imagen con el prefijo data: del canvas', async () => {
    const { sign } = await setup('sequential');

    await expect(
      sign('s1', { signatureImageBase64: `data:image/png;base64,${PNG_1X1}` }),
    ).resolves.toMatchObject({ version: 1 });
  });

  it('guarda la imagen de la firma aparte del PDF', async () => {
    const { db, storage, sign } = await setup('sequential');

    await sign('s1');

    expect(storage.has('signatures/s1.png')).toBe(true);
    expect(db.rows('envelope_signers').find((s) => s.id === 's1')!.signature_image_path).toBe(
      'signatures/s1.png',
    );
  });

  it('exige el nivel del sobre y explica qué falta', async () => {
    const { db, sign } = await setup('sequential');

    db.rows('envelopes')[0].required_level = 'fes_verificada';

    // El RUT está, pero escribir el nombre no deja grafismo propio: la firma se
    // queda en simple y el sobre exige verificada.
    await expect(
      sign('s1', {
        method: 'type',
        typedName: 'Firmante 1',
        rut: '12.345.678-5',
        signatureImageBase64: undefined,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'SIGNATURE_LEVEL_INSUFFICIENT',
        requiredLevel: 'fes_verificada',
        achievedLevel: 'fes',
      },
    });

    await expect(
      sign('s1', { method: 'draw', authMethod: 'email_otp', rut: '12.345.678-5' }),
    ).resolves.toMatchObject({ version: 1 });
  });

  it('un sobre verificado reclama el RUT antes que nada', async () => {
    const { db, sign } = await setup('sequential');

    db.rows('envelopes')[0].required_level = 'fes_verificada';

    await expect(sign('s1', { method: 'draw', authMethod: 'email_otp' })).rejects.toThrow(
      /declares tu RUT/,
    );
  });

  it('deja el método y el nivel en la traza de auditoría', async () => {
    const { db, sign } = await setup('sequential');

    await sign('s1', { rut: '12.345.678-5' });

    const event = db.rows('audit_events').find((e) => e.event_type === 'signer.signed')!;
    expect(event.metadata).toMatchObject({
      method: 'draw',
      level: 'fes_verificada',
      authMethod: 'email_otp',
      rutDeclared: true,
    });
  });
});

describe('initialsOf', () => {
  it('toma la primera y la última palabra del nombre', () => {
    expect(initialsOf('Ana María Rojas')).toBe('AR');
    expect(initialsOf('Juan Pérez')).toBe('JP');
  });

  it('se apaña con un solo nombre', () => {
    expect(initialsOf('Cher')).toBe('CH');
  });

  it('no revienta con un nombre vacío', () => {
    expect(initialsOf('   ')).toBe('—');
  });
});

describe('SigningService: avisos por correo', () => {
  it('avisa al siguiente firmante cuando le llega el turno', async () => {
    const { sign, turnNotices } = await setup('sequential');

    expect(turnNotices).toEqual([]);
    await sign('s1');

    expect(turnNotices).toEqual(['f2@example.cl']);
  });

  it('no avisa a nadie en paralelo: todos podían firmar ya', async () => {
    const { sign, turnNotices } = await setup('parallel');

    await sign('s1');
    expect(turnNotices).toEqual([]);
  });

  it('al cerrarse el sobre avisa al emisor y a cada firmante', async () => {
    const { sign, sentMail } = await setup('parallel');

    await sign('s1');
    await sign('s2');

    const completed = sentMail.filter((m) => m.tag === 'envelope-completed');
    // Los firmantes externos no tienen panel: sin este correo nunca sabrían
    // que el documento se cerró.
    expect(completed.map((m) => m.to).sort()).toEqual(
      expect.arrayContaining(['f1@example.cl', 'f2@example.cl']),
    );
  });

  it('un fallo de correo no deshace una firma ya estampada', async () => {
    const { db, service, sign } = await setup('sequential');

    // El transporte revienta en el aviso de cortesía posterior a la firma.
    (service as unknown as { notifications: { notifySignerSigned: () => Promise<void> } })
      .notifications.notifySignerSigned = () => Promise.reject(new Error('SMTP caído'));

    await expect(sign('s1')).rejects.toThrow();

    // La versión sí quedó escrita: el estampado ocurre antes del aviso.
    expect(db.rows('envelope_versions').some((v) => v.version === 1)).toBe(true);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { ConfigService } from '@nestjs/config';
import { DocumentAuditService } from '../audit/document-audit.service';
import { AuthService } from '../auth/auth.service';
import { EnvelopesService } from '../envelopes/envelopes.service';
import { FoldersService } from '../folders/folders.service';
import { SigningService } from '../signing/signing.service';
import { LegalService } from '../legal/legal.service';
import { VerificationService } from '../verification/verification.service';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { SupabaseFake } from '../../testing/supabase-fake';
import { SignatureMethodDto } from '../envelopes/dto/envelope.dto';
import type { SelfSignDto } from './dto/self-sign.dto';
import { sha256Hex } from '../../common/utils/hash';

describe('DocumentsService sign → verify', () => {
  let service: DocumentsService;
  let fake: SupabaseFake;
  const user = { id: 'user-1', email: 'owner@test.cl', role: 'user' };
  let selfSignCalls: Array<Record<string, unknown>>;
  let submitted: Array<Record<string, unknown>>;

  beforeEach(async () => {
    fake = new SupabaseFake();
    fake.seed('documents', []);
    fake.seed('document_audit_events', []);

    selfSignCalls = [];
    submitted = [];

    // Dobles de sobres y firma: aquí se comprueba que la autofirma delega en el
    // flujo normal con los datos correctos, no el estampado en sí, que ya tiene
    // sus propias pruebas en SigningService.
    const envelopes = {
      createForSelfSign: async (
        _user: unknown,
        documentId: string,
        params: { documentType?: string; placements?: unknown[]; ownerName: string },
      ) => {
        selfSignCalls.push({ documentId, ...params });
        return { envelopeId: 'env-1', signerId: 'signer-1' };
      },
    };

    const signing = {
      submitSignature: async (params: Record<string, unknown>) => {
        submitted.push(params);
        // Simula lo que hace el flujo real al cerrar el sobre.
        const doc = fake.rows('documents')[0];
        if (doc) {
          doc.status = 'signed';
          doc.verification_code = 'AAAA-BBBB-CCCC';
          doc.signed_sha256 = 'f'.repeat(64);
        }
        return { status: 'completed', completed: true, version: 1 };
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        DocumentAuditService,
        { provide: SupabaseService, useValue: fake.asService() },
        { provide: AuthService, useValue: { getProfile: async () => ({ full_name: 'Titular' }) } },
        { provide: EnvelopesService, useValue: envelopes },
        { provide: FoldersService, useValue: { assertOwnedFolder: async () => ({ id: 'folder-1', name: 'Legal', user_id: user.id, created_at: '', updated_at: '' }) } },
        { provide: SigningService, useValue: signing },
        { provide: ConfigService, useValue: { get: () => 'https://app.example.cl' } },
      ],
    }).compile();

    service = module.get(DocumentsService);
  });

  it('genera el código de verificación en el servidor al crear', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 test original');
    const created = await service.create(
      user,
      {
        originalname: 'contrato.pdf',
        mimetype: 'application/pdf',
        size: pdfBuffer.length,
        buffer: pdfBuffer,
      } as Express.Multer.File,
    );

    // El código lo decide el servidor: si lo propusiera el cliente, podría
    // elegir uno ya emitido y suplantar la verificación de otro documento.
    expect(created.verificationCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(created.status).toBe('draft');
    expect(created.signedSha256).toBeFalsy();
  });

  describe('avance de firma en el listado', () => {
    const seedEnvelope = (
      documentId: string,
      status: string,
      signers: Array<{ email: string; full_name: string; status: string }>,
    ) => {
      fake.seed('envelopes', [
        {
          id: 'env-1',
          document_id: documentId,
          user_id: user.id,
          status,
          sent_at: '2026-09-15T18:00:00.000Z',
          completed_at: status === 'completed' ? '2026-09-15T19:00:00.000Z' : null,
        },
      ]);
      fake.seed(
        'envelope_signers',
        signers.map((signer, index) => ({ id: `s${index}`, envelope_id: 'env-1', ...signer })),
      );
    };

    const createDocument = () =>
      service.create(user, {
        originalname: 'contrato.pdf',
        mimetype: 'application/pdf',
        size: 23,
        buffer: Buffer.from('%PDF-1.4 test original'),
      } as Express.Multer.File);

    it('dice cuántas partes han firmado mientras el sobre sigue abierto', async () => {
      const doc = await createDocument();
      seedEnvelope(doc.id, 'in_progress', [
        { email: 'ana@empresa.cl', full_name: 'Ana Rojas', status: 'signed' },
        { email: 'luis@empresa.cl', full_name: 'Luis Soto', status: 'notified' },
      ]);

      const [row] = await service.findAll(user);

      // Sin esto, que una parte firmara no cambiaba nada visible en la lista:
      // ni el estado ni el recuento.
      expect(row).toMatchObject({
        status: 'in_progress',
        signedCount: 1,
        totalSigners: 2,
        signedNames: ['Ana Rojas'],
        pendingNames: ['Luis Soto'],
      });
    });

    it('cuenta a todos al completarse', async () => {
      const doc = await createDocument();
      seedEnvelope(doc.id, 'completed', [
        { email: 'ana@empresa.cl', full_name: 'Ana Rojas', status: 'signed' },
        { email: 'luis@empresa.cl', full_name: 'Luis Soto', status: 'signed' },
      ]);

      const [row] = await service.findAll(user);

      expect(row).toMatchObject({ status: 'signed', signedCount: 2, totalSigners: 2 });
      expect(row.pendingNames).toEqual([]);
    });

    it('usa el correo cuando el firmante no tiene nombre', async () => {
      const doc = await createDocument();
      seedEnvelope(doc.id, 'in_progress', [
        { email: 'ana@empresa.cl', full_name: '', status: 'signed' },
        { email: 'luis@empresa.cl', full_name: '', status: 'notified' },
      ]);

      const [row] = await service.findAll(user);
      expect(row.signedNames).toEqual(['ana@empresa.cl']);
    });

    it('distingue enviado, en curso y rechazado', async () => {
      const doc = await createDocument();

      // Antes los tres se colapsaban en «enviado para firma»: un sobre con
      // firmas recogidas parecía no haber empezado, y uno rechazado parecía
      // seguir esperando.
      const cases: Array<[string, string]> = [
        ['sent', 'sent'],
        ['in_progress', 'in_progress'],
        ['declined', 'declined'],
      ];

      for (const [envelopeStatus, expected] of cases) {
        seedEnvelope(doc.id, envelopeStatus, [
          { email: 'ana@empresa.cl', full_name: 'Ana Rojas', status: 'notified' },
        ]);

        const [row] = await service.findAll(user);
        expect(row.status).toBe(expected);
      }
    });

    it('un documento sin sobre no inventa avance', async () => {
      await createDocument();
      const [row] = await service.findAll(user);

      expect(row.signedCount).toBeUndefined();
      expect(row.totalSigners).toBeUndefined();
    });
  });

  describe('autofirma', () => {
    const createDocument = () =>
      service.create(
        user,
        {
          originalname: 'contrato.pdf',
          mimetype: 'application/pdf',
          size: 23,
          buffer: Buffer.from('%PDF-1.4 test original'),
        } as Express.Multer.File,
      );

    const submission: SelfSignDto = {
      method: SignatureMethodDto.draw,
      consentAccepted: true,
      signatureImageBase64: 'iVBORw0KGgo=',
      rut: '12.345.678-5',
      documentType: 'compraventa_bien_mueble',
    };

    it('firma por el flujo de sobres, no por un camino propio', async () => {
      const created = await createDocument();
      await service.selfSign(user, created.id, submission);

      // La firma propia recorre exactamente el mismo camino que una externa:
      // consentimiento, método, nivel, cadena de versiones y certificación.
      expect(selfSignCalls).toHaveLength(1);
      expect(submitted).toHaveLength(1);
      expect(submitted[0]).toMatchObject({ envelopeId: 'env-1', signerId: 'signer-1' });
    });

    it('propaga método, consentimiento y RUT tal cual', async () => {
      const created = await createDocument();
      await service.selfSign(user, created.id, submission);

      expect(submitted[0].submission).toMatchObject({
        method: 'draw',
        consentAccepted: true,
        rut: '12.345.678-5',
        // Sesión autenticada: la identidad ya está comprobada por la cuenta.
        authMethod: 'account_password',
      });
    });

    it('lleva el tipo de documento al sobre, que decide el nivel exigido', async () => {
      const created = await createDocument();
      await service.selfSign(user, created.id, submission);

      expect(selfSignCalls[0]).toMatchObject({
        documentId: created.id,
        documentType: 'compraventa_bien_mueble',
        ownerName: 'Titular',
      });
    });

    it('devuelve el documento ya firmado', async () => {
      const created = await createDocument();
      const signed = await service.selfSign(user, created.id, submission);

      expect(signed.status).toBe('signed');
      expect(signed.verificationCode).toBe('AAAA-BBBB-CCCC');
    });

    it('no permite firmar dos veces', async () => {
      const created = await createDocument();
      await service.selfSign(user, created.id, submission);

      await expect(service.selfSign(user, created.id, submission)).rejects.toThrow(
        /ya está firmado/,
      );
    });

    it('no permite autofirmar un documento ya enviado a otro firmante', async () => {
      const created = await createDocument();
      fake.seed('envelopes', [
        { id: 'env-9', document_id: created.id, user_id: user.id, status: 'sent' },
      ]);

      await expect(service.selfSign(user, created.id, submission)).rejects.toThrow(
        /ya fue enviado para firma/,
      );
    });

    it('no firma documentos de otra persona', async () => {
      const created = await createDocument();

      await expect(
        service.selfSign({ ...user, id: 'otro' }, created.id, submission),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

describe('VerificationService', () => {
  it('expone sha256 cuando el documento lo tiene', async () => {
    const fake = new SupabaseFake();
    const hash = sha256Hex(Buffer.from('%PDF-signed'));
    fake.seed('document_verifications', [
      {
        verification_code: 'TEST-CODE-1234',
        name: 'Doc',
        signer_name: 'Ana',
        signer_email: 'ana@test.cl',
        signed_at: new Date().toISOString(),
        signed_pdf_path: 'u/d/signed.pdf',
        signed_sha256: hash,
        status: 'signed',
      },
    ]);
    fake.seed('documents', [{ id: 'doc-1', verification_code: 'TEST-CODE-1234' }]);
    fake.seed('document_audit_events', []);

    const verification = new VerificationService(fake.asService(), new DocumentAuditService(fake.asService()), new LegalService());

    const result = await verification.verify('test-code-1234');
    expect(result.valid).toBe(true);
    expect(result.sha256).toBe(hash);
    expect(result.integrityCheckAvailable).toBe(true);
  });

  it('lanza 404 con código inválido', async () => {
    const fake = new SupabaseFake();
    const verification = new VerificationService(fake.asService(), new DocumentAuditService(fake.asService()), new LegalService());

    await expect(verification.verify('bad')).rejects.toBeInstanceOf(NotFoundException);
  });

});

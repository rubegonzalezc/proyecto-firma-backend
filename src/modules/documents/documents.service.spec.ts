import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentAuditService } from '../audit/document-audit.service';
import { VerificationService } from '../verification/verification.service';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { SupabaseFake } from '../../testing/supabase-fake';
import { sha256Hex } from '../../common/utils/hash';

describe('DocumentsService sign → verify', () => {
  let service: DocumentsService;
  let fake: SupabaseFake;
  const user = { id: 'user-1', email: 'owner@test.cl', role: 'user' };

  beforeEach(async () => {
    fake = new SupabaseFake();
    fake.seed('documents', []);
    fake.seed('document_audit_events', []);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        DocumentAuditService,
        { provide: SupabaseService, useValue: fake.asService() },
      ],
    }).compile();

    service = module.get(DocumentsService);
  });

  it('genera código en el servidor al crear y hash al firmar', async () => {
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

    expect(created.verificationCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(created.status).toBe('draft');

    const signedPdf = Buffer.from('%PDF-1.4 signed content');
    const signed = await service.sign(user, created.id, {
      signerName: 'Ana Test',
      signerEmail: 'ana@test.cl',
      signedPdfBase64: signedPdf.toString('base64'),
    });

    expect(signed.status).toBe('signed');
    expect(signed.verificationCode).toBe(created.verificationCode);
    expect(signed.signedSha256).toBe(sha256Hex(signedPdf));
    expect(signed.signedAt).toBeTruthy();
  });

  it('rechaza firmar un documento ya firmado', async () => {
    fake.seed('documents', [
      {
        id: 'doc-1',
        user_id: user.id,
        name: 'x.pdf',
        original_pdf_path: 'p/original.pdf',
        signed_pdf_path: 'p/signed.pdf',
        status: 'signed',
        verification_code: 'AAAA-BBBB-CCCC',
        signed_sha256: 'abc',
        created_at: new Date().toISOString(),
        signed_at: new Date().toISOString(),
      },
    ]);

    await expect(
      service.sign(user, 'doc-1', {
        signerName: 'Ana',
        signerEmail: 'a@t.cl',
        signedPdfBase64: Buffer.from('%PDF-x').toString('base64'),
      }),
    ).rejects.toThrow('El documento ya está firmado');
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

    const verification = new VerificationService(fake.asService(), new DocumentAuditService(fake.asService()));

    const result = await verification.verify('test-code-1234');
    expect(result.valid).toBe(true);
    expect(result.sha256).toBe(hash);
    expect(result.integrityCheckAvailable).toBe(true);
  });

  it('lanza 404 con código inválido', async () => {
    const fake = new SupabaseFake();
    const verification = new VerificationService(fake.asService(), new DocumentAuditService(fake.asService()));

    await expect(verification.verify('bad')).rejects.toBeInstanceOf(NotFoundException);
  });
});

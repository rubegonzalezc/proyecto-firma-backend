import { Test, TestingModule } from '@nestjs/testing';
import { DocumentAuditService } from '../audit/document-audit.service';
import { AuthService } from '../auth/auth.service';
import { EnvelopesService } from '../envelopes/envelopes.service';
import { FoldersService } from '../folders/folders.service';
import { SigningService } from '../signing/signing.service';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { SupabaseFake } from '../../testing/supabase-fake';
import { ConfigService } from '@nestjs/config';
import { DocumentsService } from './documents.service';

describe('DocumentsService folders', () => {
  let documents: DocumentsService;
  let folders: FoldersService;
  let fake: SupabaseFake;
  const user = { id: 'user-1', email: 'owner@test.cl', role: 'user' };

  beforeEach(async () => {
    fake = new SupabaseFake();
    fake.seed('documents', []);
    fake.seed('folders', []);
    fake.seed('document_audit_events', []);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        FoldersService,
        DocumentAuditService,
        { provide: SupabaseService, useValue: fake.asService() },
        { provide: AuthService, useValue: { getProfile: async () => ({ full_name: 'Titular' }) } },
        { provide: EnvelopesService, useValue: {} },
        { provide: SigningService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://app.example.cl' } },
      ],
    }).compile();

    documents = module.get(DocumentsService);
    folders = module.get(FoldersService);
  });

  const pdfFile = {
    originalname: 'contrato.pdf',
    mimetype: 'application/pdf',
    size: 23,
    buffer: Buffer.from('%PDF-1.4 test original'),
  } as Express.Multer.File;

  it('sube un documento dentro de una carpeta', async () => {
    const folder = await folders.create(user, { name: 'Legal' });
    const created = await documents.create(user, pdfFile, undefined, folder.id);

    expect(created.folderId).toBe(folder.id);
    expect(created.folderName).toBe('Legal');
  });

  it('filtra documentos por carpeta', async () => {
    const legal = await folders.create(user, { name: 'Legal' });
    const rrhh = await folders.create(user, { name: 'RRHH' });

    await documents.create(user, pdfFile, undefined, legal.id);
    await documents.create(user, pdfFile, undefined, rrhh.id);
    await documents.create(user, pdfFile);

    const legalDocs = await documents.findAll(user, legal.id);
    const rootDocs = await documents.findAll(user, 'none');

    expect(legalDocs).toHaveLength(1);
    expect(legalDocs[0].folderName).toBe('Legal');
    expect(rootDocs).toHaveLength(1);
    expect(rootDocs[0].folderId).toBeNull();
  });

  it('mueve un documento entre carpetas', async () => {
    const legal = await folders.create(user, { name: 'Legal' });
    const rrhh = await folders.create(user, { name: 'RRHH' });
    const created = await documents.create(user, pdfFile, undefined, legal.id);

    const moved = await documents.moveToFolder(user, created.id, rrhh.id);
    expect(moved.folderId).toBe(rrhh.id);
    expect(moved.folderName).toBe('RRHH');
  });
});

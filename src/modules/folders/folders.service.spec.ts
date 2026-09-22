import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { SupabaseFake } from '../../testing/supabase-fake';
import { FoldersService } from './folders.service';

describe('FoldersService', () => {
  let service: FoldersService;
  let fake: SupabaseFake;
  const user = { id: 'user-1', email: 'owner@test.cl', role: 'user' };

  beforeEach(async () => {
    fake = new SupabaseFake();
    fake.seed('folders', []);
    fake.seed('documents', []);

    const module: TestingModule = await Test.createTestingModule({
      providers: [FoldersService, { provide: SupabaseService, useValue: fake.asService() }],
    }).compile();

    service = module.get(FoldersService);
  });

  it('crea una carpeta con nombre normalizado', async () => {
    const folder = await service.create(user, { name: '  Contratos   2026  ' });
    expect(folder).toMatchObject({ name: 'Contratos 2026', documentCount: 0 });
  });

  it('rechaza nombres duplicados del mismo usuario', async () => {
    await service.create(user, { name: 'Legal' });
    await expect(service.create(user, { name: 'Legal' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('cuenta documentos al listar carpetas', async () => {
    const folder = await service.create(user, { name: 'RRHH' });
    fake.seed('documents', [
      { id: 'doc-1', user_id: user.id, folder_id: folder.id, name: 'a.pdf' },
      { id: 'doc-2', user_id: user.id, folder_id: folder.id, name: 'b.pdf' },
    ]);

    const [listed] = await service.findAll(user);
    expect(listed.documentCount).toBe(2);
  });

  it('al eliminar una carpeta los documentos quedan sin carpeta', async () => {
    const folder = await service.create(user, { name: 'Temporal' });
    fake.seed('documents', [
      { id: 'doc-1', user_id: user.id, folder_id: folder.id, name: 'a.pdf' },
    ]);

    const result = await service.remove(user, folder.id);
    expect(result).toEqual({ deleted: true, documentsMovedToRoot: 1 });
    expect(fake.rows('documents')[0].folder_id).toBeNull();
  });

  it('no permite operar carpetas de otro usuario', async () => {
    fake.seed('folders', [
      {
        id: 'folder-x',
        user_id: 'other-user',
        name: 'Privada',
        created_at: '',
        updated_at: '',
      },
    ]);

    await expect(service.update(user, 'folder-x', { name: 'Nueva' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

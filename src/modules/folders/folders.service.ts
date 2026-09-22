import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser, FolderRow } from '../../common/types/database.types';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import type { CreateFolderDto, UpdateFolderDto } from './dto/folder.dto';

export interface FolderListItem {
  id: string;
  name: string;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class FoldersService {
  constructor(private readonly supabase: SupabaseService) {}

  private mapFolder(row: FolderRow, documentCount: number): FolderListItem {
    return {
      id: row.id,
      name: row.name,
      documentCount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
  }

  async findAll(user: AuthUser): Promise<FolderListItem[]> {
    const { data, error } = await this.supabase.admin
      .from('folders')
      .select('*')
      .eq('user_id', user.id)
      .order('name', { ascending: true });

    if (error) throw error;
    const rows = (data as FolderRow[]) ?? [];
    if (rows.length === 0) return [];

    const folderIds = rows.map((row) => row.id);
    const { data: docs, error: docsError } = await this.supabase.admin
      .from('documents')
      .select('folder_id')
      .eq('user_id', user.id)
      .in('folder_id', folderIds);

    if (docsError) throw docsError;

    const counts = new Map<string, number>();
    for (const doc of docs ?? []) {
      const folderId = doc.folder_id as string;
      counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
    }

    return rows.map((row) => this.mapFolder(row, counts.get(row.id) ?? 0));
  }

  async create(user: AuthUser, dto: CreateFolderDto): Promise<FolderListItem> {
    const name = this.normalizeName(dto.name);
    if (!name) throw new BadRequestException('El nombre de la carpeta no puede estar vacío');

    await this.assertUniqueName(user.id, name);

    const { data, error } = await this.supabase.admin
      .from('folders')
      .insert({
        user_id: user.id,
        name,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('Ya existe una carpeta con ese nombre');
      }
      throw error;
    }

    return this.mapFolder(data as FolderRow, 0);
  }

  async update(user: AuthUser, id: string, dto: UpdateFolderDto): Promise<FolderListItem> {
    const folder = await this.getOwnedFolder(user.id, id);
    const name = this.normalizeName(dto.name);
    if (!name) throw new BadRequestException('El nombre de la carpeta no puede estar vacío');
    if (name !== folder.name) {
      await this.assertUniqueName(user.id, name, folder.id);
    }

    const { data, error } = await this.supabase.admin
      .from('folders')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', folder.id)
      .eq('user_id', user.id)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('Ya existe una carpeta con ese nombre');
      }
      throw error;
    }

    const count = await this.countDocumentsInFolder(user.id, id);
    return this.mapFolder(data as FolderRow, count);
  }

  async remove(user: AuthUser, id: string) {
    await this.getOwnedFolder(user.id, id);

    const docsInFolder = this.supabase.admin
      .from('documents')
      .select('id')
      .eq('user_id', user.id)
      .eq('folder_id', id);
    const { data: docs, error: docsError } = await docsInFolder;
    if (docsError) throw docsError;
    const count = docs?.length ?? 0;

    if (count > 0) {
      const { error: clearError } = await this.supabase.admin
        .from('documents')
        .update({ folder_id: null })
        .eq('user_id', user.id)
        .eq('folder_id', id);
      if (clearError) throw clearError;
    }

    const { error } = await this.supabase.admin
      .from('folders')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;

    return { deleted: true, documentsMovedToRoot: count };
  }

  /** Valida que la carpeta exista y pertenezca al usuario. */
  async assertOwnedFolder(userId: string, folderId: string): Promise<FolderRow> {
    return this.getOwnedFolder(userId, folderId);
  }

  private async assertUniqueName(userId: string, name: string, excludeId?: string) {
    let query = this.supabase.admin
      .from('folders')
      .select('id')
      .eq('user_id', userId)
      .eq('name', name);

    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (data) throw new ConflictException('Ya existe una carpeta con ese nombre');
  }

  private async countDocumentsInFolder(userId: string, folderId: string): Promise<number> {
    const { count, error } = await this.supabase.admin
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('folder_id', folderId);

    if (error) throw error;
    return count ?? 0;
  }

  private async getOwnedFolder(userId: string, id: string): Promise<FolderRow> {
    const { data, error } = await this.supabase.admin
      .from('folders')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new NotFoundException('Carpeta no encontrada');
    if ((data as FolderRow).user_id !== userId) {
      throw new NotFoundException('Carpeta no encontrada');
    }
    return data as FolderRow;
  }
}

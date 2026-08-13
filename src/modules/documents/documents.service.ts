import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import type { AuthUser } from '../../common/types/database.types';
import type { DocumentRow } from '../../common/types/database.types';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import type { SignDocumentDto } from './dto/document.dto';

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB

@Injectable()
export class DocumentsService {
  constructor(private readonly supabase: SupabaseService) {}

  private storagePath(userId: string, documentId: string, filename: string): string {
    return `${userId}/${documentId}/${filename}`;
  }

  generateVerificationCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segment = () =>
      Array.from({ length: 4 }, () => chars[randomBytes(1)[0] % chars.length]).join('');
    return `${segment()}-${segment()}-${segment()}`;
  }

  private mapDocument(row: DocumentRow) {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      signerName: row.signer_name,
      signerEmail: row.signer_email,
      verificationCode: row.verification_code,
      createdAt: row.created_at,
      signedAt: row.signed_at,
    };
  }

  async findAll(user: AuthUser) {
    const { data, error } = await this.supabase.admin
      .from('documents')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as DocumentRow[]).map((row) => this.mapDocument(row));
  }

  async findOne(user: AuthUser, id: string) {
    const doc = await this.getOwnedDocument(user.id, id);
    return this.mapDocument(doc);
  }

  async create(user: AuthUser, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Archivo PDF requerido');
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se permiten archivos PDF');
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new BadRequestException('El PDF no puede superar 20 MB');
    }

    const documentId = randomUUID();
    const path = this.storagePath(user.id, documentId, 'original.pdf');

    const { error: uploadError } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .upload(path, file.buffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data, error } = await this.supabase.admin
      .from('documents')
      .insert({
        id: documentId,
        user_id: user.id,
        name: file.originalname,
        original_pdf_path: path,
        status: 'draft',
      })
      .select('*')
      .single();

    if (error) throw error;
    return this.mapDocument(data as DocumentRow);
  }

  async sign(user: AuthUser, id: string, dto: SignDocumentDto) {
    const doc = await this.getOwnedDocument(user.id, id);

    if (doc.status === 'signed') {
      throw new BadRequestException('El documento ya está firmado');
    }

    const pdfBuffer = Buffer.from(dto.signedPdfBase64, 'base64');
    if (pdfBuffer.length === 0 || pdfBuffer.length > MAX_PDF_BYTES) {
      throw new BadRequestException('PDF firmado inválido');
    }

    const verificationCode = dto.verificationCode?.toUpperCase() ?? this.generateVerificationCode();
    const signedPath = this.storagePath(user.id, id, 'signed.pdf');
    const signedAt = new Date().toISOString();

    const { error: uploadError } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .upload(signedPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data, error } = await this.supabase.admin
      .from('documents')
      .update({
        status: 'signed',
        signed_pdf_path: signedPath,
        signer_name: dto.signerName.trim(),
        signer_email: dto.signerEmail.trim().toLowerCase(),
        verification_code: verificationCode,
        signed_at: signedAt,
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('*')
      .single();

    if (error) throw error;
    return this.mapDocument(data as DocumentRow);
  }

  async getDownloadUrl(user: AuthUser, id: string, type: 'original' | 'signed') {
    const doc = await this.getOwnedDocument(user.id, id);
    const path = type === 'signed' ? doc.signed_pdf_path : doc.original_pdf_path;

    if (!path) throw new NotFoundException('Archivo no disponible');

    const { data, error } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .createSignedUrl(path, 300);

    if (error || !data?.signedUrl) throw new NotFoundException('No se pudo generar URL de descarga');

    return { url: data.signedUrl, expiresIn: 300 };
  }

  async remove(user: AuthUser, id: string) {
    const doc = await this.getOwnedDocument(user.id, id);

    const paths = [doc.original_pdf_path, doc.signed_pdf_path].filter(Boolean) as string[];
    if (paths.length > 0) {
      await this.supabase.admin.storage.from(this.supabase.documentsBucket).remove(paths);
    }

    const { error } = await this.supabase.admin
      .from('documents')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;
    return { deleted: true };
  }

  private async getOwnedDocument(userId: string, id: string): Promise<DocumentRow> {
    const { data, error } = await this.supabase.admin
      .from('documents')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Documento no encontrado');
    if ((data as DocumentRow).user_id !== userId) {
      throw new ForbiddenException('No tienes acceso a este documento');
    }
    return data as DocumentRow;
  }
}

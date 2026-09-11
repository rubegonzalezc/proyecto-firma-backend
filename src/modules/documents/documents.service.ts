import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import type { AuthUser } from '../../common/types/database.types';
import type { DocumentRow, EnvelopeRow } from '../../common/types/database.types';
import { sha256Hex } from '../../common/utils/hash';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { DocumentAuditService } from '../audit/document-audit.service';
import { AuthService } from '../auth/auth.service';
import { EnvelopesService } from '../envelopes/envelopes.service';
import { DocumentStampService } from '../signing/pdf/document-stamp.service';
import type { SignDocumentDto } from './dto/document.dto';
import type { SendForSignatureDto } from './dto/send-for-signature.dto';

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB

@Injectable()
export class DocumentsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly documentAudit: DocumentAuditService,
    private readonly authService: AuthService,
    private readonly documentStamp: DocumentStampService,
    private readonly envelopes: EnvelopesService,
    private readonly config: ConfigService,
  ) {}

  private storagePath(userId: string, documentId: string, filename: string): string {
    return `${userId}/${documentId}/${filename}`;
  }

  generateVerificationCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segment = () =>
      Array.from({ length: 4 }, () => chars[randomBytes(1)[0] % chars.length]).join('');
    return `${segment()}-${segment()}-${segment()}`;
  }

  private mapDocument(
    row: DocumentRow,
    envelope?: {
      status: string;
      sent_at: string | null;
      completed_at: string | null;
      signers: Array<{ full_name: string; email: string; status: string }>;
    },
  ) {
    if ((row.status === 'signed' && row.signed_pdf_path) || !envelope) {
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        signerName: row.signer_name,
        signerEmail: row.signer_email,
        verificationCode: row.verification_code,
        signedSha256: row.signed_sha256,
        createdAt: row.created_at,
        signedAt: row.signed_at,
      };
    }

    const pendingSigners = envelope.signers.filter(
      (s) => !['signed', 'declined', 'expired'].includes(s.status),
    );
    const signedSigners = envelope.signers.filter((s) => s.status === 'signed');

    if (envelope.status === 'completed') {
      const signedBy = signedSigners
        .map((s) => s.full_name?.trim() || s.email)
        .join(', ');
      return {
        id: row.id,
        name: row.name,
        status: 'signed' as const,
        signerName: signedBy || row.signer_name,
        signerEmail: signedSigners[0]?.email ?? row.signer_email,
        verificationCode: row.verification_code,
        signedSha256: row.signed_sha256,
        createdAt: row.created_at,
        signedAt: envelope.completed_at ?? row.signed_at,
      };
    }

    if (['sent', 'in_progress', 'declined'].includes(envelope.status)) {
      const sentTo = pendingSigners
        .map((s) => s.full_name?.trim() || s.email)
        .join(', ');
      return {
        id: row.id,
        name: row.name,
        status: 'sent' as const,
        signerName: sentTo || null,
        signerEmail: pendingSigners[0]?.email ?? null,
        verificationCode: row.verification_code,
        signedSha256: row.signed_sha256,
        createdAt: row.created_at,
        signedAt: envelope.sent_at ?? row.signed_at,
      };
    }

    return {
      id: row.id,
      name: row.name,
      status: row.status,
      signerName: row.signer_name,
      signerEmail: row.signer_email,
      verificationCode: row.verification_code,
      signedSha256: row.signed_sha256,
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
    const rows = (data as DocumentRow[]) ?? [];
    if (rows.length === 0) return [];

    const docIds = rows.map((row) => row.id);
    const { data: envelopes, error: envelopesError } = await this.supabase.admin
      .from('envelopes')
      .select('document_id, status, sent_at, completed_at, envelope_signers(full_name, email, status)')
      .eq('user_id', user.id)
      .in('document_id', docIds)
      .not('status', 'eq', 'voided')
      .order('sent_at', { ascending: false });

    if (envelopesError) throw envelopesError;

    const envelopeByDocument = new Map<
      string,
      {
        status: string;
        sent_at: string | null;
        completed_at: string | null;
        signers: Array<{ full_name: string; email: string; status: string }>;
      }
    >();

    for (const envelope of envelopes ?? []) {
      const documentId = envelope.document_id as string;
      if (envelopeByDocument.has(documentId)) continue;
      envelopeByDocument.set(documentId, {
        status: envelope.status as string,
        sent_at: envelope.sent_at as string | null,
        completed_at: envelope.completed_at as string | null,
        signers: ((envelope.envelope_signers as Array<{
          full_name: string;
          email: string;
          status: string;
        }>) ?? []),
      });
    }

    return rows.map((row) => this.mapDocument(row, envelopeByDocument.get(row.id)));
  }

  findInbox(user: AuthUser) {
    return this.envelopes.findInboxForSigner(user);
  }

  async getInboxDownloadUrl(
    user: AuthUser,
    signerId: string,
    type: 'original' | 'signed',
    request?: Request,
  ) {
    const { data: signer, error } = await this.supabase.admin
      .from('envelope_signers')
      .select('id, email, envelope_id, envelopes(*)')
      .eq('id', signerId)
      .maybeSingle();

    if (error) throw error;
    if (!signer) throw new NotFoundException('Invitación no encontrada');

    if ((signer.email as string).trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      throw new ForbiddenException('No tienes acceso a este documento');
    }

    const rawEnvelope = signer.envelopes as EnvelopeRow | EnvelopeRow[] | null;
    const envelope = Array.isArray(rawEnvelope) ? rawEnvelope[0] : rawEnvelope;

    if (!envelope) throw new NotFoundException('Sobre no encontrado');

    const path =
      type === 'original'
        ? envelope.original_pdf_path
        : envelope.status === 'completed' && envelope.final_pdf_path
          ? envelope.final_pdf_path
          : envelope.current_pdf_path;

    if (!path) throw new NotFoundException('Archivo no disponible');

    const { data, error: urlError } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .createSignedUrl(path, 300);

    if (urlError || !data?.signedUrl) {
      throw new NotFoundException('No se pudo generar URL de descarga');
    }

    await this.documentAudit.record({
      documentId: envelope.document_id,
      userId: user.id,
      eventType: 'document.downloaded',
      request,
      metadata: { type, signerId, via: 'inbox' },
    });

    return { url: data.signedUrl, expiresIn: 300 };
  }

  async findOne(user: AuthUser, id: string) {
    const doc = await this.getOwnedDocument(user.id, id);
    return this.mapDocument(doc);
  }

  async create(user: AuthUser, file: Express.Multer.File, request?: Request) {
    if (!file) throw new BadRequestException('Archivo PDF requerido');
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se permiten archivos PDF');
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new BadRequestException('El PDF no puede superar 20 MB');
    }

    const documentId = randomUUID();
    const path = this.storagePath(user.id, documentId, 'original.pdf');
    const verificationCode = this.generateVerificationCode();

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
        verification_code: verificationCode,
      })
      .select('*')
      .single();

    if (error) throw error;

    await this.documentAudit.record({
      documentId,
      userId: user.id,
      eventType: 'document.created',
      request,
      metadata: { name: file.originalname, size: file.size },
    });

    return this.mapDocument(data as DocumentRow);
  }

  async stampSign(user: AuthUser, id: string, request?: Request) {
    const doc = await this.getOwnedDocument(user.id, id);

    if (doc.status === 'signed') {
      throw new BadRequestException('El documento ya está firmado');
    }

    const profile = await this.authService.getProfile(user);
    const displayName = profile.full_name?.trim() || user.email;
    const signerEmail = user.email.trim().toLowerCase();

    const { data: originalFile, error: downloadError } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .download(doc.original_pdf_path);

    if (downloadError || !originalFile) {
      throw new NotFoundException('No se pudo leer el documento original');
    }

    const originalBytes = Buffer.from(await originalFile.arrayBuffer());
    const verificationCode = doc.verification_code ?? this.generateVerificationCode();
    const signedAt = new Date();
    const verifyBaseUrl = (this.config.get<string>('app.verifyBaseUrl') ?? '').replace(/\/$/, '');
    const verifyUrl = `${verifyBaseUrl}/verify/${verificationCode}`;

    const stampedBytes = await this.documentStamp.stamp(originalBytes, {
      displayName,
      email: signerEmail,
      verificationCode,
      signedAt,
      verifyUrl,
    });

    const signedPath = this.storagePath(user.id, id, 'signed.pdf');
    const signedSha256 = sha256Hex(stampedBytes);

    const { error: uploadError } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .upload(signedPath, stampedBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data, error } = await this.supabase.admin
      .from('documents')
      .update({
        status: 'signed',
        signed_pdf_path: signedPath,
        signer_name: displayName,
        signer_email: signerEmail,
        verification_code: verificationCode,
        signed_at: signedAt.toISOString(),
        signed_sha256: signedSha256,
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('*')
      .single();

    if (error) throw error;

    await this.documentAudit.record({
      documentId: id,
      userId: user.id,
      eventType: 'document.signed',
      request,
      metadata: {
        signerName: displayName,
        signerEmail,
        verificationCode,
        signedSha256,
        method: 'stamp',
      },
    });

    return this.mapDocument(data as DocumentRow);
  }

  async sendForSignature(
    user: AuthUser,
    id: string,
    dto: SendForSignatureDto,
    request?: Request,
  ) {
    const doc = await this.getOwnedDocument(user.id, id);
    if (doc.status === 'signed') {
      throw new BadRequestException('El documento ya está firmado');
    }

    const email = dto.signerEmail.trim().toLowerCase();
    if (email === user.email.trim().toLowerCase()) {
      throw new BadRequestException('Indica el correo de otra persona o marca que tú también firmarás.');
    }

    const { data: activeEnvelope } = await this.supabase.admin
      .from('envelopes')
      .select('id')
      .eq('document_id', id)
      .eq('user_id', user.id)
      .in('status', ['sent', 'in_progress'])
      .maybeSingle();

    if (activeEnvelope) {
      throw new BadRequestException('Este documento ya fue enviado para firma.');
    }

    const profile = dto.includeSender ? await this.authService.getProfile(user) : null;
    const ownerName = profile?.full_name?.trim() || user.email;

    return this.envelopes.createAndSendForSignature(
      user,
      id,
      {
        signerEmail: email,
        message: dto.message,
        includeSender: dto.includeSender ?? false,
        ownerName,
        ownerEmail: user.email.trim().toLowerCase(),
      },
      request,
    );
  }

  async sign(user: AuthUser, id: string, dto: SignDocumentDto, request?: Request) {
    const doc = await this.getOwnedDocument(user.id, id);

    if (doc.status === 'signed') {
      throw new BadRequestException('El documento ya está firmado');
    }

    const pdfBuffer = Buffer.from(dto.signedPdfBase64, 'base64');
    if (pdfBuffer.length === 0 || pdfBuffer.length > MAX_PDF_BYTES) {
      throw new BadRequestException('PDF firmado inválido');
    }

    if (pdfBuffer.subarray(0, 4).toString() !== '%PDF') {
      throw new BadRequestException('El archivo firmado no es un PDF válido');
    }

    const verificationCode = doc.verification_code ?? this.generateVerificationCode();
    const signedPath = this.storagePath(user.id, id, 'signed.pdf');
    const signedAt = new Date().toISOString();
    const signedSha256 = sha256Hex(pdfBuffer);

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
        signed_sha256: signedSha256,
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('*')
      .single();

    if (error) throw error;

    await this.documentAudit.record({
      documentId: id,
      userId: user.id,
      eventType: 'document.signed',
      request,
      metadata: {
        signerName: dto.signerName.trim(),
        signerEmail: dto.signerEmail.trim().toLowerCase(),
        verificationCode,
        signedSha256,
      },
    });

    return this.mapDocument(data as DocumentRow);
  }

  async getDownloadUrl(
    user: AuthUser,
    id: string,
    type: 'original' | 'signed',
    request?: Request,
  ) {
    const doc = await this.getOwnedDocument(user.id, id);
    const path = await this.resolveOwnerDownloadPath(user.id, id, doc, type);

    if (!path) throw new NotFoundException('Archivo no disponible');

    const { data, error } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .createSignedUrl(path, 300);

    if (error || !data?.signedUrl) throw new NotFoundException('No se pudo generar URL de descarga');

    await this.documentAudit.record({
      documentId: id,
      userId: user.id,
      eventType: 'document.downloaded',
      request,
      metadata: { type },
    });

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

  private async resolveOwnerDownloadPath(
    userId: string,
    documentId: string,
    doc: DocumentRow,
    type: 'original' | 'signed',
  ): Promise<string | null> {
    if (type === 'original') return doc.original_pdf_path;
    if (doc.signed_pdf_path) return doc.signed_pdf_path;

    const { data: envelope } = await this.supabase.admin
      .from('envelopes')
      .select('status, final_pdf_path, current_pdf_path')
      .eq('document_id', documentId)
      .eq('user_id', userId)
      .not('status', 'eq', 'voided')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!envelope) return null;

    if (envelope.status === 'completed' && envelope.final_pdf_path) {
      return this.resolveSignedPathFromEnvelope(userId, documentId, doc);
    }

    if (['sent', 'in_progress'].includes(envelope.status as string)) {
      return (envelope.current_pdf_path as string) ?? doc.original_pdf_path;
    }

    return this.resolveSignedPathFromEnvelope(userId, documentId, doc);
  }

  /** Recupera el PDF firmado desde un sobre completado y sincroniza el documento si faltaba. */
  private async resolveSignedPathFromEnvelope(
    userId: string,
    documentId: string,
    doc: DocumentRow,
  ): Promise<string | null> {
    const { data: envelope } = await this.supabase.admin
      .from('envelopes')
      .select(
        'final_pdf_path, final_sha256, verification_code, completed_at, envelope_signers(full_name, email, status)',
      )
      .eq('document_id', documentId)
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!envelope?.final_pdf_path) return null;

    if (doc.signed_pdf_path) return doc.signed_pdf_path;

    const { data: finalFile, error: downloadError } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .download(envelope.final_pdf_path as string);

    if (downloadError || !finalFile) return envelope.final_pdf_path as string;

    const finalBytes = Buffer.from(await finalFile.arrayBuffer());
    const signedPath = this.storagePath(userId, documentId, 'signed.pdf');

    await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .upload(signedPath, finalBytes, { contentType: 'application/pdf', upsert: true });

    const signers = (envelope.envelope_signers as Array<{
      full_name: string;
      email: string;
      status: string;
    }>) ?? [];
    const signedSigners = signers.filter((s) => s.status === 'signed');
    const signerName = signedSigners
      .map((s) => s.full_name?.trim() || s.email)
      .join(', ');

    await this.supabase.admin
      .from('documents')
      .update({
        status: 'signed',
        signed_pdf_path: signedPath,
        signed_sha256: envelope.final_sha256,
        verification_code: envelope.verification_code,
        signer_name: signerName || null,
        signer_email: signedSigners[0]?.email ?? null,
        signed_at: envelope.completed_at,
      })
      .eq('id', documentId)
      .eq('user_id', userId);

    return signedPath;
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

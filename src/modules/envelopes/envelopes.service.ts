import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type { Request } from 'express';
import { PDFDocument } from 'pdf-lib';
import type {
  AuthUser,
  DocumentRow,
  EnvelopeRow,
  EnvelopeSignerRow,
  SignatureFieldRow,
} from '../../common/types/database.types';
import { sha256Hex } from '../../common/utils/hash';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { SignerTokenService } from '../signer-access/signer-token.service';
import { CreateEnvelopeDto, FieldTypeDto, SigningModeDto, UpdateEnvelopeDto } from './dto/envelope.dto';
import { activeSigners, initialSignerStatus, validateBeforeSend } from './envelope-state';

const DOWNLOAD_URL_TTL_SECONDS = 300;
const DEFAULT_EXPIRY_DAYS = 30;

export interface EnvelopeBundle {
  envelope: EnvelopeRow;
  signers: EnvelopeSignerRow[];
  fields: SignatureFieldRow[];
}

@Injectable()
export class EnvelopesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
    private readonly tokens: SignerTokenService,
    private readonly config: ConfigService,
  ) {}

  storagePath(userId: string, envelopeId: string, file: string): string {
    return `${userId}/envelopes/${envelopeId}/${file}`;
  }

  /**
   * Código de verificación con reintento. El generador anterior no comprobaba
   * colisiones; aquí el índice único de la tabla es la autoridad y se reintenta
   * si choca.
   */
  generateVerificationCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segment = () =>
      Array.from({ length: 4 }, () => chars[randomBytes(1)[0] % chars.length]).join('');
    return `${segment()}-${segment()}-${segment()}`;
  }

  async download(path: string): Promise<Buffer> {
    const { data, error } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .download(path);

    if (error || !data) throw new NotFoundException('No se pudo leer el documento');
    return Buffer.from(await data.arrayBuffer());
  }

  /** URL firmada de corta vida para un objeto del bucket privado. */
  async signedUrl(path: string, ttlSeconds = DOWNLOAD_URL_TTL_SECONDS): Promise<string> {
    const { data, error } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .createSignedUrl(path, ttlSeconds);

    if (error || !data?.signedUrl) {
      throw new NotFoundException('No se pudo generar la URL de descarga');
    }
    return data.signedUrl;
  }

  async upload(path: string, bytes: Buffer): Promise<void> {
    const { error } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .upload(path, bytes, { contentType: 'application/pdf', upsert: true });

    if (error) throw error;
  }

  async create(user: AuthUser, dto: CreateEnvelopeDto, request?: Request): Promise<EnvelopeBundle> {
    const document = await this.getOwnedDocument(user.id, dto.documentId);

    const originalBytes = await this.download(document.original_pdf_path);
    const originalSha256 = sha256Hex(originalBytes);
    const pageCount = (await PDFDocument.load(originalBytes)).getPageCount();

    this.assertFieldsWithinDocument(dto, pageCount);

    const envelopeId = crypto.randomUUID();
    const originalPath = this.storagePath(user.id, envelopeId, 'original.pdf');
    const currentPath = this.storagePath(user.id, envelopeId, 'v0.pdf');

    await this.upload(originalPath, originalBytes);
    await this.upload(currentPath, originalBytes);

    const { data: envelope, error } = await this.supabase.admin
      .from('envelopes')
      .insert({
        id: envelopeId,
        user_id: user.id,
        document_id: document.id,
        name: dto.name?.trim() || document.name,
        message: dto.message ?? null,
        mode: dto.mode,
        status: 'draft',
        page_count: pageCount,
        current_version: 0,
        original_pdf_path: originalPath,
        current_pdf_path: currentPath,
        original_sha256: originalSha256,
      })
      .select('*')
      .single();

    if (error) throw error;

    // Los ids definitivos se asignan aquí; los campos llegan referenciando los
    // ids temporales del editor y se remapean con esta tabla.
    const idByTemp = new Map<string, string>();
    const signerRows = dto.signers.map((signer, index) => {
      const id = crypto.randomUUID();
      idByTemp.set(signer.tempId, id);
      return {
        id,
        envelope_id: envelopeId,
        order_index: index,
        full_name: signer.fullName.trim(),
        email: signer.email.trim().toLowerCase(),
        role_label: signer.roleLabel ?? null,
        status: initialSignerStatus(index, dto.mode),
      };
    });

    const unknownSigner = dto.fields.find((f) => !idByTemp.has(f.signerTempId));
    if (unknownSigner) {
      await this.hardDelete(envelopeId, [originalPath, currentPath]);
      throw new BadRequestException(
        `El campo referencia un firmante inexistente: ${unknownSigner.signerTempId}`,
      );
    }

    const fieldRows = dto.fields.map((field) => ({
      id: crypto.randomUUID(),
      envelope_id: envelopeId,
      signer_id: idByTemp.get(field.signerTempId)!,
      page_number: field.page,
      x: field.x,
      y: field.y,
      w: field.w,
      h: field.h,
      type: field.type,
      required: field.required ?? true,
      page_rotation: field.pageRotation ?? 0,
      page_width_pt: field.pageWidthPt,
      page_height_pt: field.pageHeightPt,
      detection_source: field.detectionSource ?? 'manual',
      detection_confidence: field.detectionConfidence ?? null,
    }));

    const { error: signersError } = await this.supabase.admin
      .from('envelope_signers')
      .insert(signerRows);
    if (signersError) {
      await this.hardDelete(envelopeId, [originalPath, currentPath]);
      throw signersError;
    }

    const { error: fieldsError } = await this.supabase.admin
      .from('signature_fields')
      .insert(fieldRows);
    if (fieldsError) {
      await this.hardDelete(envelopeId, [originalPath, currentPath]);
      throw fieldsError;
    }

    await this.supabase.admin.from('envelope_versions').insert({
      envelope_id: envelopeId,
      version: 0,
      pdf_path: currentPath,
      sha256: originalSha256,
    });

    await this.audit.record({
      envelopeId,
      actorType: 'owner',
      eventType: 'envelope.created',
      request,
      metadata: { signers: signerRows.length, fields: fieldRows.length, mode: dto.mode },
      sha256After: originalSha256,
    });

    return {
      envelope: envelope as EnvelopeRow,
      signers: signerRows as EnvelopeSignerRow[],
      fields: fieldRows as unknown as SignatureFieldRow[],
    };
  }

  private assertFieldsWithinDocument(dto: CreateEnvelopeDto, pageCount: number): void {
    const outOfRange = dto.fields.find((f) => f.page > pageCount);
    if (outOfRange) {
      throw new BadRequestException(
        `Hay un campo en la página ${outOfRange.page}, pero el documento tiene ${pageCount}`,
      );
    }

    const overflowing = dto.fields.find((f) => f.x + f.w > 1.0001 || f.y + f.h > 1.0001);
    if (overflowing) {
      throw new BadRequestException('Hay un campo que se sale de los límites de la página');
    }
  }

  private async hardDelete(envelopeId: string, paths: string[]): Promise<void> {
    await this.supabase.admin.storage.from(this.supabase.documentsBucket).remove(paths);
    await this.supabase.admin.from('envelopes').delete().eq('id', envelopeId);
  }

  async findAll(user: AuthUser) {
    const { data, error } = await this.supabase.admin
      .from('envelopes')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as EnvelopeRow[]).map((row) => this.mapEnvelope(row));
  }

  async findOne(user: AuthUser, id: string) {
    const bundle = await this.getOwnedBundle(user.id, id);
    return {
      ...this.mapEnvelope(bundle.envelope),
      signers: bundle.signers.map((s) => this.mapSigner(s)),
      fields: bundle.fields.map((f) => this.mapField(f)),
    };
  }

  async update(user: AuthUser, id: string, dto: UpdateEnvelopeDto) {
    const { envelope } = await this.getOwnedBundle(user.id, id);

    if (envelope.status !== 'draft') {
      throw new BadRequestException('Solo se puede modificar un sobre en borrador');
    }

    const { data, error } = await this.supabase.admin
      .from('envelopes')
      .update({
        name: dto.name?.trim() ?? envelope.name,
        message: dto.message ?? envelope.message,
        mode: dto.mode ?? envelope.mode,
        expires_at: dto.expiresAt ?? envelope.expires_at,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return this.mapEnvelope(data as EnvelopeRow);
  }

  /**
   * Valida el sobre, emite un enlace por firmante y lo pasa a `sent`.
   * Los enlaces en claro se devuelven una única vez: en base de datos solo
   * queda su hash, así que no hay forma de recuperarlos después.
   */
  async send(user: AuthUser, id: string, request?: Request) {
    const { envelope, signers, fields } = await this.getOwnedBundle(user.id, id);

    if (envelope.status !== 'draft') {
      throw new BadRequestException('Este sobre ya fue enviado');
    }

    const counts = new Map<string | null, number>();
    for (const field of fields) {
      counts.set(field.signer_id, (counts.get(field.signer_id) ?? 0) + 1);
    }

    const problems = validateBeforeSend(signers, counts);
    if (problems.length > 0) {
      throw new BadRequestException({ message: 'El sobre no está listo para enviarse', problems });
    }

    const expiresAt =
      envelope.expires_at ??
      new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86_400_000).toISOString();

    const links: Array<{ signerId: string; email: string; url: string }> = [];
    for (const signer of signers) {
      const token = await this.tokens.issue(signer.id, expiresAt);
      links.push({ signerId: signer.id, email: signer.email, url: this.portalUrl(token) });

      await this.supabase.admin
        .from('envelope_signers')
        .update({ status: signer.status === 'waiting' ? 'waiting' : 'notified' })
        .eq('id', signer.id);

      await this.audit.record({
        envelopeId: id,
        signerId: signer.id,
        actorType: 'system',
        eventType: 'signer.invited',
        request,
        metadata: { email: signer.email, order: signer.order_index },
      });
    }

    const { data, error } = await this.supabase.admin
      .from('envelopes')
      .update({ status: 'sent', sent_at: new Date().toISOString(), expires_at: expiresAt })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    await this.audit.record({
      envelopeId: id,
      actorType: 'owner',
      eventType: 'envelope.sent',
      request,
      metadata: { signers: signers.length },
    });

    return { envelope: this.mapEnvelope(data as EnvelopeRow), links };
  }

  private portalUrl(token: string): string {
    const base = this.config.get<string>('app.portalBaseUrl') ?? '';
    return `${base.replace(/\/$/, '')}/sign/${token}`;
  }

  /** Documentos enviados al usuario autenticado para que los firme. */
  async findInboxForSigner(user: AuthUser) {
    const email = user.email.trim().toLowerCase();

    const { data, error } = await this.supabase.admin
      .from('envelope_signers')
      .select('*, envelopes(*)')
      .eq('email', email)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const rows = (data ?? []).filter((row) => {
      const envelope = row.envelopes as EnvelopeRow | null;
      return envelope && !['draft', 'voided'].includes(envelope.status);
    });

    const ownerIds = [
      ...new Set(
        rows
          .map((row) => (row.envelopes as EnvelopeRow | null)?.user_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const ownersById = new Map<string, { full_name: string | null; email: string | null }>();
    if (ownerIds.length > 0) {
      const { data: owners } = await this.supabase.admin
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ownerIds);

      for (const owner of owners ?? []) {
        ownersById.set(owner.id as string, {
          full_name: owner.full_name as string | null,
          email: owner.email as string | null,
        });
      }
    }

    const inbox = [];
    for (const row of rows) {
      const signer = row as EnvelopeSignerRow;
      const envelope = row.envelopes as EnvelopeRow;
      const owner = ownersById.get(envelope.user_id);
      const yourTurn = activeSigners(
        [{ id: signer.id, order_index: signer.order_index, status: signer.status }],
        envelope.mode,
      ).some((s) => s.id === signer.id);

      const expiresAt =
        envelope.expires_at ??
        new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86_400_000).toISOString();

      let signUrl: string | null = null;
      const canSignNow =
        yourTurn &&
        ['sent', 'in_progress'].includes(envelope.status) &&
        !['signed', 'declined', 'expired'].includes(signer.status);

      if (canSignNow) {
        const token = await this.tokens.reissue(signer.id, expiresAt);
        signUrl = this.portalUrl(token);
      }

      const listStatus =
        signer.status === 'signed'
          ? 'signed'
          : signer.status === 'declined'
            ? 'declined'
            : 'to_sign';

      inbox.push({
        id: signer.id,
        envelopeId: envelope.id,
        documentId: envelope.document_id,
        name: envelope.name,
        status: listStatus,
        role: 'signer' as const,
        yourTurn,
        signUrl,
        ownerName: owner?.full_name?.trim() || owner?.email || null,
        ownerEmail: owner?.email ?? null,
        sentAt: envelope.sent_at,
        signedAt: signer.signed_at,
        createdAt: signer.created_at,
      });
    }

    return inbox.sort((a, b) => {
      const aTime = new Date(a.sentAt ?? a.createdAt).getTime();
      const bTime = new Date(b.sentAt ?? b.createdAt).getTime();
      return bTime - aTime;
    });
  }

  async void(user: AuthUser, id: string, reason?: string, request?: Request) {
    const { envelope } = await this.getOwnedBundle(user.id, id);

    if (['completed', 'voided'].includes(envelope.status)) {
      throw new BadRequestException('Este sobre ya no se puede anular');
    }

    const { data, error } = await this.supabase.admin
      .from('envelopes')
      .update({ status: 'voided' })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    await this.tokens.revokeForEnvelope(id);
    await this.audit.record({
      envelopeId: id,
      actorType: 'owner',
      eventType: 'envelope.voided',
      request,
      metadata: { reason: reason ?? null },
    });

    return this.mapEnvelope(data as EnvelopeRow);
  }

  async getDownloadUrl(
    user: AuthUser,
    id: string,
    type: 'original' | 'current' | 'final',
    request?: Request,
  ) {
    const { envelope } = await this.getOwnedBundle(user.id, id);

    const path =
      type === 'final'
        ? envelope.final_pdf_path
        : type === 'current'
          ? envelope.current_pdf_path
          : envelope.original_pdf_path;

    if (!path) throw new NotFoundException('Ese archivo aún no existe');

    const { data, error } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .createSignedUrl(path, DOWNLOAD_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      throw new NotFoundException('No se pudo generar la URL de descarga');
    }

    await this.audit.record({
      envelopeId: id,
      actorType: 'owner',
      eventType: 'envelope.downloaded',
      request,
      metadata: { type },
    });

    return { url: data.signedUrl, expiresIn: DOWNLOAD_URL_TTL_SECONDS };
  }

  async auditTrail(user: AuthUser, id: string) {
    await this.getOwnedBundle(user.id, id);
    return this.audit.listForEnvelope(id);
  }

  async getBundle(envelopeId: string): Promise<EnvelopeBundle> {
    const { data: envelope, error } = await this.supabase.admin
      .from('envelopes')
      .select('*')
      .eq('id', envelopeId)
      .maybeSingle();

    if (error) throw error;
    if (!envelope) throw new NotFoundException('Sobre no encontrado');

    const [{ data: signers }, { data: fields }] = await Promise.all([
      this.supabase.admin
        .from('envelope_signers')
        .select('*')
        .eq('envelope_id', envelopeId)
        .order('order_index', { ascending: true }),
      this.supabase.admin.from('signature_fields').select('*').eq('envelope_id', envelopeId),
    ]);

    return {
      envelope: envelope as EnvelopeRow,
      signers: (signers ?? []) as EnvelopeSignerRow[],
      fields: (fields ?? []) as SignatureFieldRow[],
    };
  }

  private async getOwnedBundle(userId: string, envelopeId: string): Promise<EnvelopeBundle> {
    const bundle = await this.getBundle(envelopeId);
    if (bundle.envelope.user_id !== userId) {
      throw new ForbiddenException('No tienes acceso a este sobre');
    }
    return bundle;
  }

  private async getOwnedDocument(userId: string, documentId: string): Promise<DocumentRow> {
    const { data, error } = await this.supabase.admin
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new NotFoundException('Documento no encontrado');
    if ((data as DocumentRow).user_id !== userId) {
      throw new ForbiddenException('No tienes acceso a este documento');
    }
    return data as DocumentRow;
  }

  /** Crea un sobre de un firmante con campos por defecto y lo envía de inmediato. */
  async createAndSendForSignature(
    user: AuthUser,
    documentId: string,
    params: { signerEmail: string; message?: string },
    request?: Request,
  ) {
    const signerTempId = 'signer-1';
    const email = params.signerEmail.trim().toLowerCase();

    const document = await this.getOwnedDocument(user.id, documentId);
    const originalBytes = await this.download(document.original_pdf_path);
    const pdf = await PDFDocument.load(originalBytes);
    const pageCount = pdf.getPageCount();
    const lastPage = pdf.getPage(pageCount - 1);
    const { width, height } = lastPage.getSize();

    const bundle = await this.create(
      user,
      {
        documentId,
        mode: SigningModeDto.parallel,
        message: params.message,
        signers: [
          {
            tempId: signerTempId,
            fullName: email.split('@')[0],
            email,
            roleLabel: 'Firmante',
          },
        ],
        fields: [
          {
            signerTempId,
            page: pageCount,
            x: 0.08,
            y: 0.82,
            w: 0.55,
            h: 0.07,
            type: FieldTypeDto.signature,
            pageWidthPt: width,
            pageHeightPt: height,
            detectionSource: 'fallback',
          },
          {
            signerTempId,
            page: pageCount,
            x: 0.66,
            y: 0.82,
            w: 0.24,
            h: 0.05,
            type: FieldTypeDto.date,
            pageWidthPt: width,
            pageHeightPt: height,
            detectionSource: 'fallback',
          },
        ],
      },
      request,
    );

    return this.send(user, bundle.envelope.id, request);
  }

  mapEnvelope(row: EnvelopeRow) {
    return {
      id: row.id,
      documentId: row.document_id,
      name: row.name,
      message: row.message,
      mode: row.mode,
      status: row.status,
      verificationCode: row.verification_code,
      pageCount: row.page_count,
      currentVersion: row.current_version,
      originalSha256: row.original_sha256,
      finalSha256: row.final_sha256,
      expiresAt: row.expires_at,
      sentAt: row.sent_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }

  mapSigner(row: EnvelopeSignerRow) {
    return {
      id: row.id,
      orderIndex: row.order_index,
      fullName: row.full_name,
      email: row.email,
      roleLabel: row.role_label,
      status: row.status,
      signedAt: row.signed_at,
      declineReason: row.decline_reason,
    };
  }

  mapField(row: SignatureFieldRow) {
    return {
      id: row.id,
      signerId: row.signer_id,
      page: row.page_number,
      x: Number(row.x),
      y: Number(row.y),
      w: Number(row.w),
      h: Number(row.h),
      type: row.type,
      required: row.required,
      detectionSource: row.detection_source,
      detectionConfidence: row.detection_confidence,
    };
  }
}

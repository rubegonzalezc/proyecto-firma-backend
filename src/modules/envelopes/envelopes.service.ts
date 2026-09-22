import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
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
import { NotificationsService } from '../notifications/notifications.service';
import { SignerTokenService } from '../signer-access/signer-token.service';
import { LegalService } from '../legal/legal.service';
import { MailService } from '../mail/mail.service';
import { signatureRequestEmail } from '../mail/mail.templates';
import type { SignatureMethod } from '../legal/signature-levels';
import type { DetectedPlacementDto } from '../documents/dto/send-for-signature.dto';
import {
  CreateEnvelopeDto,
  FieldInputDto,
  FieldTypeDto,
  SignatureLevelDto,
  SigningModeDto,
  UpdateEnvelopeDto,
} from './dto/envelope.dto';
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
  private readonly logger = new Logger(EnvelopesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
    private readonly tokens: SignerTokenService,
    private readonly notifications: NotificationsService,
    private readonly legal: LegalService,
    private readonly mail: MailService,
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
    return this.uploadBinary(path, bytes, 'application/pdf');
  }

  /**
   * Sube cualquier binario al bucket privado. La imagen de la firma se guarda
   * aparte del PDF para poder peritarla sin tener que extraerla del documento.
   */
  async uploadBinary(path: string, bytes: Buffer, contentType: string): Promise<void> {
    const { error } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .upload(path, bytes, { contentType, upsert: true });

    if (error) throw error;
  }

  async create(user: AuthUser, dto: CreateEnvelopeDto, request?: Request): Promise<EnvelopeBundle> {
    const document = await this.getOwnedDocument(user.id, dto.documentId);

    // El tipo de documento decide el nivel de firma y los métodos disponibles.
    // Se resuelve aquí y no al firmar: si la ley no permite cerrar este acto
    // electrónicamente, el sobre no debería llegar a existir.
    const legal = this.legal.recommend(dto.documentType, dto.requiredLevel);
    if (!legal.signableHere) {
      throw new BadRequestException({
        message: legal.blockingReason,
        code: 'DOCUMENT_TYPE_NOT_SIGNABLE',
        documentType: legal.documentType.id,
        requiredLevel: legal.requiredLevel,
        obligations: legal.documentType.obligations,
      });
    }

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
        document_type: legal.documentType.id,
        required_level: legal.requiredLevel,
        legal_framework: 'CL',
        // Se congela el texto aceptado: el catálogo puede cambiar de redacción
        // y la prueba tiene que seguir apuntando a lo que se aceptó ese día.
        consent_text: legal.consentText,
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
      // El emisor puede restringir los métodos, nunca ampliarlos más allá de lo
      // que el tipo de documento admite.
      const requested = (signer.allowedMethods ?? []) as SignatureMethod[];
      const allowed = requested.filter((m) => legal.allowedMethods.includes(m));

      return {
        id,
        envelope_id: envelopeId,
        order_index: index,
        full_name: signer.fullName.trim(),
        email: signer.email.trim().toLowerCase(),
        role_label: signer.roleLabel ?? null,
        status: initialSignerStatus(index, dto.mode),
        allowed_methods: allowed.length > 0 ? allowed : legal.allowedMethods,
        require_rut: signer.requireRut ?? legal.requireRut,
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

    const rows = await Promise.all(
      (data as EnvelopeRow[]).map((row) => this.applyExpiry(row)),
    );
    return rows.map((row) => this.mapEnvelope(row));
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

    const legal =
      dto.documentType || dto.requiredLevel
        ? this.legal.recommend(
            dto.documentType ?? envelope.document_type,
            dto.requiredLevel ?? envelope.required_level,
          )
        : null;

    if (legal && !legal.signableHere) {
      throw new BadRequestException({
        message: legal.blockingReason,
        code: 'DOCUMENT_TYPE_NOT_SIGNABLE',
      });
    }

    const { data, error } = await this.supabase.admin
      .from('envelopes')
      .update({
        name: dto.name?.trim() ?? envelope.name,
        message: dto.message ?? envelope.message,
        mode: dto.mode ?? envelope.mode,
        expires_at: dto.expiresAt ?? envelope.expires_at,
        ...(legal
          ? {
              document_type: legal.documentType.id,
              required_level: legal.requiredLevel,
              consent_text: legal.consentText,
            }
          : {}),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    // Cambiar el tipo de documento cambia lo que se le permite al firmante.
    // Sin esto, un borrador que pasa de NDA a contrato de trabajo conservaría
    // los métodos laxos del NDA.
    if (legal) {
      await this.supabase.admin
        .from('envelope_signers')
        .update({ allowed_methods: legal.allowedMethods, require_rut: legal.requireRut })
        .eq('envelope_id', id);
    }

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

    const senderName = await this.displayNameOf(user);
    const rule = this.legal.rule(envelope.document_type);

    const links: Array<{
      signerId: string;
      email: string;
      url: string;
      emailed: boolean;
    }> = [];

    for (const signer of signers) {
      const token = await this.tokens.issue(signer.id, expiresAt);
      const url = this.portalUrl(token);

      await this.supabase.admin
        .from('envelope_signers')
        .update({ status: signer.status === 'waiting' ? 'waiting' : 'notified' })
        .eq('id', signer.id);

      // En modo secuencial solo se avisa a quien ya puede firmar: mandarle el
      // enlace al tercero de la fila solo consigue que lo abra, vea «todavía no
      // es tu turno» y lo dé por roto.
      const shouldEmail = signer.status !== 'waiting';
      let emailed = false;

      if (shouldEmail) {
        const result = await this.mail.send({
          to: signer.email,
          tag: 'signature-request',
          email: signatureRequestEmail({
            signerName: signer.full_name,
            signerEmail: signer.email,
            documentName: envelope.name,
            senderName,
            message: envelope.message,
            signUrl: url,
            documentTypeLabel: rule.label,
            requiresRut: signer.require_rut,
            expiresAt,
          }),
        });
        emailed = result.delivered;
      }

      links.push({ signerId: signer.id, email: signer.email, url, emailed });

      await this.audit.record({
        envelopeId: id,
        signerId: signer.id,
        actorType: 'system',
        eventType: 'signer.invited',
        request,
        metadata: {
          email: signer.email,
          order: signer.order_index,
          emailed,
          // Se deja constancia de quién recibió aviso y quién quedó en espera:
          // es lo primero que se pregunta cuando alguien «no recibió nada».
          deferred: !shouldEmail,
        },
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

    await this.notifications.notifyEnvelopeSent({
      envelope: data as EnvelopeRow,
      signers,
      ownerUserId: user.id,
    });

    return { envelope: this.mapEnvelope(data as EnvelopeRow), links };
  }

  /**
   * Traduce las zonas detectadas en el navegador a campos del sobre.
   *
   * Se descarta lo que no cuadre con el documento real —página inexistente, caja
   * fuera de los límites— en vez de confiar en el cliente: son coordenadas que
   * deciden dónde se estampa una firma en un contrato.
   */
  private fieldsFromPlacements(
    placements: DetectedPlacementDto[],
    ctx: { invitedTempId: string; ownerTempId: string; includeSender: boolean; pageCount: number },
  ): FieldInputDto[] {
    const fields: FieldInputDto[] = [];

    for (const placement of placements) {
      if (placement.page > ctx.pageCount) {
        this.logger.warn(
          `Zona descartada: página ${placement.page} de un documento con ${ctx.pageCount}`,
        );
        continue;
      }

      if (placement.x + placement.w > 1.0001 || placement.y + placement.h > 1.0001) {
        this.logger.warn('Zona descartada: se sale de los límites de la página');
        continue;
      }

      // Sin emisor firmante todo va al invitado; con emisor, la segunda columna
      // detectada es la suya.
      const signerTempId =
        ctx.includeSender && placement.partyIndex === 1 ? ctx.ownerTempId : ctx.invitedTempId;

      fields.push({
        signerTempId,
        page: placement.page,
        x: placement.x,
        y: placement.y,
        w: placement.w,
        h: placement.h,
        type: placement.type ?? FieldTypeDto.signature,
        pageWidthPt: placement.pageWidthPt,
        pageHeightPt: placement.pageHeightPt,
        detectionSource: 'heuristic',
        detectionConfidence: placement.confidence,
      });
    }

    // Un sobre sin campos para alguna parte no se puede enviar. Si el detector
    // no encontró nada para el emisor, se le da su propio bloque al pie en vez
    // de dejar el sobre en un estado que `validateBeforeSend` rechazará.
    if (ctx.includeSender && !fields.some((f) => f.signerTempId === ctx.ownerTempId)) {
      return [];
    }

    return fields;
  }

  /**
   * Avisa por correo al firmante que acaba de quedar habilitado.
   *
   * En secuencial el enlace se emite al enviar el sobre, pero no se manda hasta
   * que llega su turno. Sin este aviso, el segundo de la fila tendría que
   * adivinar cuándo le toca.
   */
  async notifyTurn(envelope: EnvelopeRow, signer: EnvelopeSignerRow): Promise<void> {
    const expiresAt =
      envelope.expires_at ??
      new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86_400_000).toISOString();

    try {
      const token = await this.tokens.reissue(signer.id, expiresAt);
      const rule = this.legal.rule(envelope.document_type);
      const senderName = await this.displayNameOf({
        id: envelope.user_id,
        email: '',
        role: 'user',
      });

      await this.mail.send({
        to: signer.email,
        tag: 'signature-request',
        email: signatureRequestEmail({
          signerName: signer.full_name,
          signerEmail: signer.email,
          documentName: envelope.name,
          senderName,
          message: envelope.message,
          signUrl: this.portalUrl(token),
          documentTypeLabel: rule.label,
          requiresRut: signer.require_rut,
          expiresAt,
        }),
      });
    } catch (error) {
      // La firma anterior ya está estampada: que falle este aviso no puede
      // deshacerla. Queda en el log y el firmante siempre puede pedir su enlace.
      this.logger.error(
        `No se pudo avisar del turno a ${signer.email}: ${error instanceof Error ? error.message : 'error desconocido'}`,
      );
    }
  }

  /** Nombre visible del emisor, para firmar el correo de invitación. */
  private async displayNameOf(user: AuthUser): Promise<string> {
    const { data } = await this.supabase.admin
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();

    return ((data?.full_name as string | undefined)?.trim() || user.email || 'SynchroSign').trim();
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

  /**
   * Aplica la caducidad de un sobre cuando se lee.
   *
   * Se resuelve al leer y no con una tarea programada porque el despliegue es
   * serverless: un cron ahí es infraestructura aparte que hay que montar,
   * vigilar y pagar, y el efecto que importa —que nadie pueda firmar un sobre
   * caducado, y que la lista no lo muestre como vivo— se consigue igual en el
   * momento en que alguien lo mira.
   *
   * El enlace ya caducaba por su cuenta (`SignerTokenService` comprueba la
   * fecha del token). Lo que faltaba era que el sobre lo reflejara.
   */
  private async applyExpiry(envelope: EnvelopeRow): Promise<EnvelopeRow> {
    const stillOpen = envelope.status === 'sent' || envelope.status === 'in_progress';
    if (!stillOpen || !envelope.expires_at) return envelope;
    if (new Date(envelope.expires_at).getTime() > Date.now()) return envelope;

    const { error } = await this.supabase.admin
      .from('envelopes')
      .update({ status: 'expired' })
      .eq('id', envelope.id)
      // Solo si nadie lo cambió entretanto: un sobre que se completó justo
      // antes de la lectura no puede pasar a caducado.
      .in('status', ['sent', 'in_progress']);

    if (error) {
      this.logger.error(`No se pudo marcar como caducado el sobre ${envelope.id}`);
      return envelope;
    }

    await this.audit.record({
      envelopeId: envelope.id,
      actorType: 'system',
      eventType: 'envelope.expired',
      metadata: { expiresAt: envelope.expires_at },
    });

    return { ...envelope, status: 'expired' };
  }

  async getBundle(envelopeId: string): Promise<EnvelopeBundle> {
    const { data: envelope, error } = await this.supabase.admin
      .from('envelopes')
      .select('*')
      .eq('id', envelopeId)
      .maybeSingle();

    if (error) throw error;
    if (!envelope) throw new NotFoundException('Sobre no encontrado');

    const current = await this.applyExpiry(envelope as EnvelopeRow);

    const [{ data: signers }, { data: fields }] = await Promise.all([
      this.supabase.admin
        .from('envelope_signers')
        .select('*')
        .eq('envelope_id', envelopeId)
        .order('order_index', { ascending: true }),
      this.supabase.admin.from('signature_fields').select('*').eq('envelope_id', envelopeId),
    ]);

    return {
      envelope: current,
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

  /** Crea un sobre con campos por defecto y lo envía de inmediato. */
  /**
   * Sobre de un solo firmante para que el emisor firme su propio documento.
   *
   * No emite enlace ni manda correo: el firmante es quien está haciendo la
   * petición, ya autenticado. Todo lo demás —consentimiento, método, nivel,
   * cadena de versiones, hoja de certificación— es idéntico al flujo normal,
   * porque una firma propia necesita exactamente la misma prueba.
   */
  async createForSelfSign(
    user: AuthUser,
    documentId: string,
    params: { documentType?: string; placements?: DetectedPlacementDto[]; ownerName: string },
    request?: Request,
  ): Promise<{ envelopeId: string; signerId: string }> {
    const selfTempId = 'signer-self';

    const document = await this.getOwnedDocument(user.id, documentId);
    const originalBytes = await this.download(document.original_pdf_path);
    const pdf = await PDFDocument.load(originalBytes);
    const pageCount = pdf.getPageCount();
    const { width, height } = pdf.getPage(pageCount - 1).getSize();

    const ctx = {
      invitedTempId: selfTempId,
      ownerTempId: selfTempId,
      includeSender: false,
      pageCount,
    };

    const detected = params.placements?.length
      ? this.fieldsFromPlacements(params.placements, ctx)
      : [];

    const bundle = await this.create(
      user,
      {
        documentId,
        mode: SigningModeDto.parallel,
        documentType: params.documentType,
        signers: [
          {
            tempId: selfTempId,
            fullName: params.ownerName,
            email: user.email.trim().toLowerCase(),
            roleLabel: 'Emisor',
          },
        ],
        fields: detected.length > 0 ? detected : blindFallbackFields({ ...ctx, width, height }),
      },
      request,
    );

    // Pasa a `sent` sin emitir token ni correo: el firmante ya está aquí.
    await this.supabase.admin
      .from('envelopes')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', bundle.envelope.id);

    await this.audit.record({
      envelopeId: bundle.envelope.id,
      signerId: bundle.signers[0].id,
      actorType: 'owner',
      eventType: 'envelope.sent',
      request,
      metadata: { selfSign: true, fields: bundle.fields.length },
    });

    return { envelopeId: bundle.envelope.id, signerId: bundle.signers[0].id };
  }

  async createAndSendForSignature(
    user: AuthUser,
    documentId: string,
    params: {
      signerEmail: string;
      message?: string;
      includeSender?: boolean;
      ownerName?: string;
      ownerEmail?: string;
      documentType?: string;
      requiredLevel?: SignatureLevelDto;
      placements?: DetectedPlacementDto[];
      mode?: SigningModeDto;
      senderSignsFirst?: boolean;
    },
    request?: Request,
  ) {
    const invitedTempId = 'signer-invited';
    const ownerTempId = 'signer-owner';
    const email = params.signerEmail.trim().toLowerCase();

    const document = await this.getOwnedDocument(user.id, documentId);
    const originalBytes = await this.download(document.original_pdf_path);
    const pdf = await PDFDocument.load(originalBytes);
    const pageCount = pdf.getPageCount();
    const lastPage = pdf.getPage(pageCount - 1);
    const { width, height } = lastPage.getSize();

    const invited = {
      tempId: invitedTempId,
      fullName: email.split('@')[0],
      email,
      roleLabel: 'Firmante',
    };

    const owner =
      params.includeSender && params.ownerEmail
        ? {
            tempId: ownerTempId,
            fullName: params.ownerName?.trim() || params.ownerEmail.split('@')[0],
            email: params.ownerEmail,
            roleLabel: 'Emisor',
          }
        : null;

    // El orden de la lista es el orden de firma en modo secuencial, así que
    // quién va primero tiene que poder decidirse: en un contrato laboral firma
    // antes el empleador, en una aceptación de presupuesto antes el cliente.
    const signers = !owner
      ? [invited]
      : params.senderSignsFirst
        ? [owner, invited]
        : [invited, owner];

    // Con zonas detectadas se usan esas; sin ellas se cae a una posición fija
    // al pie, que es la que puede tapar contenido. Por eso el cliente analiza
    // el documento antes de enviar.
    const ctx = {
      invitedTempId,
      ownerTempId,
      includeSender: Boolean(params.includeSender),
      pageCount,
    };

    const detected = params.placements?.length
      ? this.fieldsFromPlacements(params.placements, ctx)
      : [];

    // Si el detector no dio nada usable —documento escaneado, o zonas que no
    // cubren a todas las partes— se cae a la posición fija. Quedarse sin enviar
    // sería peor que enviar con una caja que el emisor puede reubicar.
    const fields =
      detected.length > 0 ? detected : blindFallbackFields({ ...ctx, width, height });

    const bundle = await this.create(
      user,
      {
        documentId,
        mode: params.mode ?? SigningModeDto.parallel,
        message: params.message,
        documentType: params.documentType,
        requiredLevel: params.requiredLevel,
        signers,
        fields,
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
      documentType: row.document_type,
      requiredLevel: row.required_level,
      legalFramework: row.legal_framework,
      consentText: row.consent_text,
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
      allowedMethods: row.allowed_methods,
      requireRut: row.require_rut,
      signatureMethod: row.signature_method,
      signatureLevel: row.signature_level,
      authMethod: row.auth_method,
      // El RUT completo solo lo ve el dueño del sobre, que ya lo conoce por el
      // contrato; el resto de las vistas lo enmascaran.
      identityRut: row.identity_rut,
      consentAcceptedAt: row.consent_accepted_at,
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

/**
 * Posición fija al pie, para cuando el documento no se pudo analizar.
 *
 * Es deliberadamente el último recurso: coloca la firma a ciegas y puede caer
 * sobre el texto. Se conserva porque un escaneo sin capa de texto no ofrece
 * nada mejor, y quedarse sin enviar es peor que enviar con una caja que el
 * emisor puede reubicar.
 */
function blindFallbackFields(ctx: {
  invitedTempId: string;
  ownerTempId: string;
  includeSender: boolean;
  pageCount: number;
  width: number;
  height: number;
}): FieldInputDto[] {
  const base = {
    page: ctx.pageCount,
    pageWidthPt: ctx.width,
    pageHeightPt: ctx.height,
    detectionSource: 'fallback' as const,
  };

  const fields: FieldInputDto[] = [
    {
      ...base,
      signerTempId: ctx.invitedTempId,
      x: 0.08,
      y: ctx.includeSender ? 0.86 : 0.82,
      w: 0.31,
      h: 0.058,
      type: FieldTypeDto.signature,
    },
    {
      ...base,
      signerTempId: ctx.invitedTempId,
      x: 0.66,
      y: ctx.includeSender ? 0.86 : 0.82,
      w: 0.24,
      h: 0.05,
      type: FieldTypeDto.date,
    },
  ];

  if (ctx.includeSender) {
    fields.push(
      {
        ...base,
        signerTempId: ctx.ownerTempId,
        x: 0.08,
        y: 0.74,
        w: 0.31,
        h: 0.058,
        type: FieldTypeDto.signature,
      },
      {
        ...base,
        signerTempId: ctx.ownerTempId,
        x: 0.66,
        y: 0.74,
        w: 0.24,
        h: 0.05,
        type: FieldTypeDto.date,
      },
    );
  }

  return fields;
}

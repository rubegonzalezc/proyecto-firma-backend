import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type {
  EnvelopeRow,
  EnvelopeSignerRow,
  SignatureFieldRow,
} from '../../common/types/database.types';
import { sha256Hex } from '../../common/utils/hash';
import { LegalService } from '../legal/legal.service';
import type { SignatureLevel } from '../legal/signature-levels';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { DocumentAuditService } from '../audit/document-audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EnvelopesService } from '../envelopes/envelopes.service';
import {
  canSign,
  deriveEnvelopeStatus,
  nextSignerToActivate,
} from '../envelopes/envelope-state';
import { CertificateService } from './pdf/certificate.service';
import { PdfStampService, type StampInstruction } from './pdf/pdf-stamp.service';
import {
  validateSubmission,
  type SignatureSubmission,
  type ValidatedSubmission,
} from '../signing/signature-submission';

const MAX_CODE_ATTEMPTS = 5;

export class SignerNotActiveError extends ForbiddenException {
  constructor() {
    super({ message: 'Todavía no es el turno de este firmante', code: 'SIGNER_NOT_ACTIVE' });
  }
}

@Injectable()
export class SigningService {
  private readonly logger = new Logger(SigningService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly envelopes: EnvelopesService,
    private readonly stamper: PdfStampService,
    private readonly certificates: CertificateService,
    private readonly audit: AuditService,
    private readonly documentAudit: DocumentAuditService,
    private readonly notifications: NotificationsService,
    private readonly legal: LegalService,
    private readonly config: ConfigService,
  ) {}

  private documentStoragePath(userId: string, documentId: string, filename: string): string {
    return `${userId}/${documentId}/${filename}`;
  }

  /**
   * Traduce los campos del firmante a instrucciones de estampado, según el
   * método con el que decidió firmar.
   *
   * Antes esto solo distinguía "hay imagen" o "no hay imagen", y todo lo demás
   * caía en un `default` que estampaba `value_text`: los campos de RUT, que
   * nunca traen `value_text`, quedaban en blanco sin avisar a nadie. Ahora cada
   * tipo de campo tiene su rama y el RUT declarado se estampa donde toca.
   */
  private instructionsFor(
    fields: SignatureFieldRow[],
    submission: ValidatedSubmission,
    displayName: string,
  ): StampInstruction[] {
    const instructions: StampInstruction[] = [];
    const signaturePng = submission.signatureImage?.toString('base64');

    for (const field of fields) {
      const rect = {
        page: field.page_number,
        x: Number(field.x),
        y: Number(field.y),
        w: Number(field.w),
        h: Number(field.h),
      };

      switch (field.type) {
        case 'signature':
          instructions.push({ rect, value: this.markFor(submission, displayName, signaturePng) });
          break;

        case 'initials':
          // Las iniciales van en cajas pequeñas al pie de cada página: meter ahí
          // la firma completa la deja ilegible, así que el grafismo solo se usa
          // cuando el firmante lo dibujó o lo subió.
          instructions.push(
            signaturePng
              ? { rect, value: { kind: 'signature', pngBase64: signaturePng } }
              : {
                  rect,
                  value: { kind: 'text', text: initialsOf(displayName), align: 'center', bold: true },
                },
          );
          break;

        case 'name':
          instructions.push({ rect, value: { kind: 'text', text: displayName } });
          break;

        case 'rut':
          if (submission.rut) {
            instructions.push({ rect, value: { kind: 'text', text: submission.rut } });
          } else {
            // Un campo de RUT sin RUT es un hueco en el contrato, no una firma
            // fallida: se deja constancia en vez de romper el flujo entero.
            this.logger.warn(`Campo de RUT sin valor declarado en el campo ${field.id}`);
          }
          break;

        case 'date':
          instructions.push({ rect, value: { kind: 'text', text: santiagoDate() } });
          break;

        default:
          if (field.value_text) {
            instructions.push({ rect, value: { kind: 'text', text: field.value_text } });
          }
      }
    }

    return instructions;
  }

  /** La marca de firma propiamente tal, según el método elegido. */
  private markFor(
    submission: ValidatedSubmission,
    displayName: string,
    signaturePng: string | undefined,
  ): StampInstruction['value'] {
    if (signaturePng) return { kind: 'signature', pngBase64: signaturePng };

    if (submission.method === 'type' && submission.typedName) {
      return { kind: 'typed', text: submission.typedName, style: submission.typedStyle };
    }

    return { kind: 'text', text: displayName, align: 'center', bold: true };
  }

  /**
   * Registra la firma de un firmante.
   *
   * El estampado es incremental: cada firmante trabaja sobre la versión que
   * dejó el anterior, de modo que ve las firmas previas y cada paso queda como
   * una versión con su propio hash. Al firmar el último se añade la hoja de
   * certificación y se cierra el sobre.
   */
  async submitSignature(params: {
    envelopeId: string;
    signerId: string;
    fullName: string;
    submission: SignatureSubmission;
    request?: Request;
  }) {
    const { envelopeId, signerId, request } = params;
    const { envelope, signers, fields } = await this.envelopes.getBundle(envelopeId);

    const signer = signers.find((s) => s.id === signerId);
    if (!signer) throw new BadRequestException('Firmante no encontrado');

    if (!canSign(signer, signers, envelope.mode, envelope.status)) {
      throw new SignerNotActiveError();
    }

    const own = fields.filter((f) => f.signer_id === signerId);
    if (own.length === 0) {
      throw new BadRequestException('Este firmante no tiene campos asignados');
    }

    const displayName = params.fullName.trim() || signer.full_name;

    // Todo lo que decide si esta firma vale ocurre antes de tocar el PDF: un
    // documento estampado con una firma que no cumple hay que invalidarlo a
    // mano, y eso ya es un incidente.
    const submission = validateSubmission({
      submission: params.submission,
      displayName,
      requireRut: signer.require_rut || envelope.required_level === 'fes_verificada',
    });

    const achievedLevel = this.legal.assertSignatureSatisfies({
      requiredLevel: envelope.required_level as SignatureLevel,
      method: submission.method,
      allowedMethods: signer.allowed_methods ?? [],
      authMethod: submission.authMethod,
      consentAccepted: params.submission.consentAccepted,
      rutVerified: submission.rut !== null,
    });

    const currentBytes = await this.envelopes.download(envelope.current_pdf_path);
    const shaBefore = sha256Hex(currentBytes);

    const stamped = await this.stamper.stampFields(
      currentBytes,
      this.instructionsFor(own, submission, displayName),
    );

    if (stamped.droppedCharacters.length > 0) {
      this.logger.warn(
        `Caracteres no representables en la firma de ${signer.email}: ${stamped.droppedCharacters.join(' ')}`,
      );
    }

    const nextVersion = envelope.current_version + 1;
    const versionPath = this.envelopes.storagePath(
      envelope.user_id,
      envelopeId,
      `v${nextVersion}.pdf`,
    );
    const shaAfter = sha256Hex(stamped.bytes);

    await this.envelopes.upload(versionPath, stamped.bytes);

    // El índice único (envelope_id, version) es la red de seguridad ante dos
    // firmantes enviando a la vez en modo paralelo: el segundo choca y reintenta.
    const { error: versionError } = await this.supabase.admin.from('envelope_versions').insert({
      envelope_id: envelopeId,
      version: nextVersion,
      pdf_path: versionPath,
      sha256: shaAfter,
      created_by_signer_id: signerId,
    });

    if (versionError) {
      throw new BadRequestException(
        'Otro firmante acaba de firmar este documento. Vuelve a intentarlo.',
      );
    }

    const signatureImagePath = await this.storeSignatureImage({
      userId: envelope.user_id,
      envelopeId,
      signerId,
      image: submission.signatureImage,
    });

    const consentText = envelope.consent_text ?? this.legal.consentText(this.legal.rule(envelope.document_type));
    const signedAt = new Date().toISOString();

    await this.supabase.admin
      .from('envelope_signers')
      .update({
        status: 'signed',
        signed_at: signedAt,
        signed_ip: this.ipOf(request),
        signed_user_agent: request?.headers['user-agent'] ?? null,
        full_name: displayName,
        signature_method: submission.method,
        signature_level: achievedLevel,
        auth_method: submission.authMethod,
        signature_image_path: signatureImagePath,
        identity_rut: submission.rut,
        consent_accepted_at: signedAt,
        consent_sha256: sha256Hex(Buffer.from(consentText, 'utf8')),
      })
      .eq('id', signerId);

    const updatedSigners = signers.map((s) =>
      s.id === signerId
        ? {
            ...s,
            status: 'signed' as const,
            signed_at: signedAt,
            full_name: displayName,
            signature_method: submission.method,
            signature_level: achievedLevel,
            auth_method: submission.authMethod,
            identity_rut: submission.rut,
            consent_accepted_at: signedAt,
          }
        : s,
    );

    // En secuencial, firmar habilita al siguiente de la fila.
    const next = nextSignerToActivate(updatedSigners, envelope.mode);
    if (next) {
      await this.supabase.admin
        .from('envelope_signers')
        .update({ status: 'pending' })
        .eq('id', next.id);

      await this.envelopes.notifyTurn(envelope, next);
    }

    await this.audit.record({
      envelopeId,
      signerId,
      actorType: 'signer',
      eventType: 'signer.signed',
      request,
      metadata: {
        version: nextVersion,
        fields: own.length,
        method: submission.method,
        level: achievedLevel,
        authMethod: submission.authMethod,
        rutDeclared: submission.rut !== null,
        consentSha256: sha256Hex(Buffer.from(consentText, 'utf8')),
      },
      sha256Before: shaBefore,
      sha256After: shaAfter,
    });

    await this.notifications.notifySignerSigned({
      envelope,
      signer: { ...signer, full_name: displayName, status: 'signed' as const },
      ownerUserId: envelope.user_id,
      remaining: updatedSigners.filter((s) => s.status !== 'signed' && s.status !== 'declined')
        .length,
    });

    const nextStatus = deriveEnvelopeStatus(updatedSigners, envelope.status);

    if (nextStatus !== 'completed') {
      await this.supabase.admin
        .from('envelopes')
        .update({
          status: nextStatus === 'draft' ? 'in_progress' : nextStatus,
          current_pdf_path: versionPath,
          current_version: nextVersion,
        })
        .eq('id', envelopeId);

      return { status: nextStatus, completed: false, version: nextVersion };
    }

    await this.finalize({
      envelopeId,
      documentId: envelope.document_id,
      userId: envelope.user_id,
      name: envelope.name,
      originalSha256: envelope.original_sha256,
      envelope,
      signers: updatedSigners,
      stampedBytes: stamped.bytes,
      versionPath,
      version: nextVersion,
      request,
    });

    return { status: 'completed' as const, completed: true, version: nextVersion };
  }

  /** Cierra el sobre: hoja de certificación, código de verificación y hash final. */
  private async finalize(params: {
    envelopeId: string;
    documentId: string;
    userId: string;
    name: string;
    originalSha256: string;
    envelope: EnvelopeRow;
    signers: EnvelopeSignerRow[];
    stampedBytes: Buffer;
    versionPath: string;
    version: number;
    request?: Request;
  }): Promise<void> {
    const verificationCode = await this.assignVerificationCode(params.envelopeId);
    const verifyUrl = `${(this.config.get<string>('app.verifyBaseUrl') ?? '').replace(/\/$/, '')}/verify/${verificationCode}`;

    const rule = this.legal.rule(params.envelope.document_type);

    const finalBytes = await this.certificates.append(params.stampedBytes, {
      documentName: params.name,
      verificationCode,
      verifyUrl,
      originalSha256: params.originalSha256,
      documentTypeLabel: rule.label,
      requiredLevel: params.envelope.required_level,
      legalBasis: rule.legalBasis,
      consentText: params.envelope.consent_text,
      signers: params.signers.map((s) => ({
        fullName: s.full_name,
        email: s.email,
        roleLabel: s.role_label,
        signedAt: s.signed_at,
        ip: s.signed_ip,
        method: s.signature_method,
        level: s.signature_level,
        authMethod: s.auth_method,
        rut: s.identity_rut,
        consentAcceptedAt: s.consent_accepted_at,
      })),
    });

    const finalPath = this.envelopes.storagePath(params.userId, params.envelopeId, 'final.pdf');
    const finalSha256 = sha256Hex(finalBytes);
    await this.envelopes.upload(finalPath, finalBytes);

    const completedAt = new Date().toISOString();

    await this.supabase.admin
      .from('envelopes')
      .update({
        status: 'completed',
        current_pdf_path: params.versionPath,
        current_version: params.version,
        final_pdf_path: finalPath,
        final_sha256: finalSha256,
        completed_at: completedAt,
      })
      .eq('id', params.envelopeId);

    await this.syncDocumentRecord({
      documentId: params.documentId,
      userId: params.userId,
      finalBytes,
      finalSha256,
      verificationCode,
      signers: params.signers,
      completedAt,
      request: params.request,
    });

    await this.audit.record({
      envelopeId: params.envelopeId,
      actorType: 'system',
      eventType: 'envelope.completed',
      request: params.request,
      metadata: { verificationCode, signers: params.signers.length },
      sha256After: finalSha256,
    });

    const { data: envelopeRow } = await this.supabase.admin
      .from('envelopes')
      .select('*')
      .eq('id', params.envelopeId)
      .single();

    if (envelopeRow) {
      await this.notifications.notifyEnvelopeCompleted({
        envelope: envelopeRow as EnvelopeRow,
        signers: params.signers,
        ownerUserId: params.userId,
      });
    }
  }

  /** Copia el PDF final del sobre al registro del documento fuente. */
  private async syncDocumentRecord(params: {
    documentId: string;
    userId: string;
    finalBytes: Buffer;
    finalSha256: string;
    verificationCode: string;
    signers: EnvelopeSignerRow[];
    completedAt: string;
    request?: Request;
  }): Promise<void> {
    const signedPath = this.documentStoragePath(params.userId, params.documentId, 'signed.pdf');

    const { error: uploadError } = await this.supabase.admin.storage
      .from(this.supabase.documentsBucket)
      .upload(signedPath, params.finalBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const signedSigners = params.signers.filter((s) => s.status === 'signed');
    const signerName = signedSigners
      .map((s) => s.full_name?.trim() || s.email)
      .join(', ');

    const { error } = await this.supabase.admin
      .from('documents')
      .update({
        status: 'signed',
        signed_pdf_path: signedPath,
        signed_sha256: params.finalSha256,
        verification_code: params.verificationCode,
        signer_name: signerName || null,
        signer_email: signedSigners[0]?.email ?? null,
        signed_at: params.completedAt,
      })
      .eq('id', params.documentId)
      .eq('user_id', params.userId);

    if (error) throw error;

    await this.documentAudit.record({
      documentId: params.documentId,
      userId: params.userId,
      eventType: 'document.signed',
      request: params.request,
      metadata: {
        signerName,
        signerEmail: signedSigners[0]?.email ?? null,
        verificationCode: params.verificationCode,
        signedSha256: params.finalSha256,
        method: 'envelope',
      },
    });
  }

  /**
   * Asigna el código comprobando colisiones contra el índice único, en vez de
   * confiar en que no se repita.
   */
  private async assignVerificationCode(envelopeId: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = this.envelopes.generateVerificationCode();
      const { error } = await this.supabase.admin
        .from('envelopes')
        .update({ verification_code: code })
        .eq('id', envelopeId);

      if (!error) return code;
      this.logger.warn(`Colisión de código de verificación, reintentando (${attempt + 1})`);
    }

    throw new BadRequestException('No se pudo asignar un código de verificación');
  }

  async decline(params: {
    envelopeId: string;
    signerId: string;
    reason: string;
    request?: Request;
  }) {
    const { envelope, signers } = await this.envelopes.getBundle(params.envelopeId);
    const signer = signers.find((s) => s.id === params.signerId);
    if (!signer) throw new BadRequestException('Firmante no encontrado');

    if (!canSign(signer, signers, envelope.mode, envelope.status)) {
      throw new SignerNotActiveError();
    }

    await this.supabase.admin
      .from('envelope_signers')
      .update({
        status: 'declined',
        declined_at: new Date().toISOString(),
        decline_reason: params.reason,
        signed_ip: this.ipOf(params.request),
      })
      .eq('id', params.signerId);

    await this.supabase.admin
      .from('envelopes')
      .update({ status: 'declined' })
      .eq('id', params.envelopeId);

    await this.audit.record({
      envelopeId: params.envelopeId,
      signerId: params.signerId,
      actorType: 'signer',
      eventType: 'signer.declined',
      request: params.request,
      metadata: { reason: params.reason },
    });

    return { status: 'declined' as const };
  }

  /**
   * Guarda la imagen de la firma junto al sobre.
   *
   * Vale la pena aunque ya esté dentro del PDF: una pericia caligráfica trabaja
   * sobre el trazo original, no sobre el que quedó escalado dentro de la caja
   * del campo.
   */
  private async storeSignatureImage(params: {
    userId: string;
    envelopeId: string;
    signerId: string;
    image: Buffer | null;
  }): Promise<string | null> {
    if (!params.image) return null;

    const path = this.envelopes.storagePath(
      params.userId,
      params.envelopeId,
      `signatures/${params.signerId}.png`,
    );

    try {
      await this.envelopes.uploadBinary(path, params.image, 'image/png');
      return path;
    } catch (error) {
      // La firma ya está estampada en el PDF: perder la copia suelta degrada la
      // evidencia, no invalida el documento, así que no se aborta por esto.
      this.logger.error(`No se pudo guardar la imagen de firma en ${path}`, error as Error);
      return null;
    }
  }

  private ipOf(request?: Request): string | null {
    if (!request) return null;
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return request.ip ?? null;
  }
}

/**
 * Fecha en la zona horaria de Chile continental.
 *
 * El servidor corre en UTC, así que una firma hecha a las 21:30 en Santiago
 * imprimía la fecha del día siguiente. En un contrato la fecha no es un detalle
 * de presentación: determina plazos.
 */
export function santiagoDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);
}

/** Iniciales para las cajas pequeñas: "Ana María Rojas" → "AR". */
export function initialsOf(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 1 || /[A-Za-zÁÉÍÓÚÑ]/.test(part));

  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EnvelopeSignerRow, SignatureFieldRow } from '../../common/types/database.types';
import { sha256Hex } from '../../common/utils/hash';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { EnvelopesService } from '../envelopes/envelopes.service';
import {
  canSign,
  deriveEnvelopeStatus,
  nextSignerToActivate,
} from '../envelopes/envelope-state';
import { CertificateService } from './pdf/certificate.service';
import { PdfStampService, type StampInstruction } from './pdf/pdf-stamp.service';

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
    private readonly config: ConfigService,
  ) {}

  private instructionsFor(
    fields: SignatureFieldRow[],
    signer: EnvelopeSignerRow,
    signatureBase64: string,
    displayName: string,
  ): StampInstruction[] {
    const instructions: StampInstruction[] = [];

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
        case 'initials':
          instructions.push({ rect, value: { kind: 'signature', pngBase64: signatureBase64 } });
          break;
        case 'name':
          instructions.push({ rect, value: { kind: 'text', text: displayName } });
          break;
        case 'date':
          instructions.push({
            rect,
            value: { kind: 'text', text: new Date().toISOString().slice(0, 10) },
          });
          break;
        default:
          if (field.value_text) {
            instructions.push({ rect, value: { kind: 'text', text: field.value_text } });
          }
      }
    }

    return instructions;
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
    signatureBase64: string;
    fullName?: string;
    request?: Request;
  }) {
    const { envelopeId, signerId, signatureBase64, request } = params;
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

    const currentBytes = await this.envelopes.download(envelope.current_pdf_path);
    const shaBefore = sha256Hex(currentBytes);

    const displayName = params.fullName?.trim() || signer.full_name;
    const stamped = await this.stamper.stampFields(
      currentBytes,
      this.instructionsFor(own, signer, signatureBase64, displayName),
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

    const signedAt = new Date().toISOString();
    await this.supabase.admin
      .from('envelope_signers')
      .update({
        status: 'signed',
        signed_at: signedAt,
        signed_ip: this.ipOf(request),
        signed_user_agent: request?.headers['user-agent'] ?? null,
        full_name: displayName,
      })
      .eq('id', signerId);

    const updatedSigners = signers.map((s) =>
      s.id === signerId ? { ...s, status: 'signed' as const, signed_at: signedAt } : s,
    );

    // En secuencial, firmar habilita al siguiente de la fila.
    const next = nextSignerToActivate(updatedSigners, envelope.mode);
    if (next) {
      await this.supabase.admin
        .from('envelope_signers')
        .update({ status: 'pending' })
        .eq('id', next.id);
    }

    await this.audit.record({
      envelopeId,
      signerId,
      actorType: 'signer',
      eventType: 'signer.signed',
      request,
      metadata: { version: nextVersion, fields: own.length },
      sha256Before: shaBefore,
      sha256After: shaAfter,
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
      userId: envelope.user_id,
      name: envelope.name,
      originalSha256: envelope.original_sha256,
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
    userId: string;
    name: string;
    originalSha256: string;
    signers: EnvelopeSignerRow[];
    stampedBytes: Buffer;
    versionPath: string;
    version: number;
    request?: Request;
  }): Promise<void> {
    const verificationCode = await this.assignVerificationCode(params.envelopeId);
    const verifyUrl = `${(this.config.get<string>('app.verifyBaseUrl') ?? '').replace(/\/$/, '')}/verify/${verificationCode}`;

    const finalBytes = await this.certificates.append(params.stampedBytes, {
      documentName: params.name,
      verificationCode,
      verifyUrl,
      originalSha256: params.originalSha256,
      signers: params.signers.map((s) => ({
        fullName: s.full_name,
        email: s.email,
        roleLabel: s.role_label,
        signedAt: s.signed_at,
        ip: s.signed_ip,
      })),
    });

    const finalPath = this.envelopes.storagePath(params.userId, params.envelopeId, 'final.pdf');
    const finalSha256 = sha256Hex(finalBytes);
    await this.envelopes.upload(finalPath, finalBytes);

    await this.supabase.admin
      .from('envelopes')
      .update({
        status: 'completed',
        current_pdf_path: params.versionPath,
        current_version: params.version,
        final_pdf_path: finalPath,
        final_sha256: finalSha256,
        completed_at: new Date().toISOString(),
      })
      .eq('id', params.envelopeId);

    await this.audit.record({
      envelopeId: params.envelopeId,
      actorType: 'system',
      eventType: 'envelope.completed',
      request: params.request,
      metadata: { verificationCode, signers: params.signers.length },
      sha256After: finalSha256,
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

  private ipOf(request?: Request): string | null {
    if (!request) return null;
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return request.ip ?? null;
  }
}

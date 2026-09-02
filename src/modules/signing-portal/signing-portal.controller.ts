import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { EnvelopesService } from '../envelopes/envelopes.service';
import { activeSigners } from '../envelopes/envelope-state';
import { OtpService } from '../signer-access/otp.service';
import { SignerSessionService } from '../signer-access/signer-session.service';
import { SignerTokenService } from '../signer-access/signer-token.service';
import {
  SignerSessionGuard,
  type RequestWithSigner,
} from '../signer-access/guards/signer-session.guard';
import { SigningService } from '../signing/signing.service';
import { DeclineDto, SubmitSignatureDto, VerifyOtpDto } from './dto/portal.dto';

/** Oculta el correo salvo la primera letra: confirma la dirección sin exponerla. */
function maskEmail(email: string): string {
  return email.replace(/^(.).*(@.*)$/, '$1***$2');
}

/**
 * Portal de firma para terceros sin cuenta en la aplicación.
 *
 * Todas las rutas son `@Public()` respecto al guard de sesión de la app: el
 * firmante se identifica con el enlace único que recibió por correo más un
 * código de un solo uso. Los límites de peticiones son deliberadamente
 * estrictos porque son endpoints abiertos a internet.
 */
@ApiTags('portal de firma')
@Controller('sign')
export class SigningPortalController {
  constructor(
    private readonly tokens: SignerTokenService,
    private readonly otp: OtpService,
    private readonly sessions: SignerSessionService,
    private readonly envelopes: EnvelopesService,
    private readonly signing: SigningService,
    private readonly audit: AuditService,
  ) {}

  /** Respuesta neutra: no revela si el sobre existe, solo si el enlace sirve. */
  private notFound(): never {
    throw new NotFoundException('Este enlace de firma no es válido o ha expirado');
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  @ApiOperation({ summary: 'Datos mínimos del enlace, sin exponer el documento' })
  async peek(@Param('token') token: string, @Req() request: Request) {
    const resolved = await this.tokens.resolve(token);
    if (!resolved) this.notFound();

    const { envelope, signers } = await this.envelopes.getBundle(resolved.signer.envelope_id);
    const isActive = activeSigners(signers, envelope.mode).some((s) => s.id === resolved.signer.id);

    await this.audit.record({
      envelopeId: envelope.id,
      signerId: resolved.signer.id,
      actorType: 'signer',
      eventType: 'signer.link_opened',
      request,
    });

    return {
      documentName: envelope.name,
      message: envelope.message,
      mode: envelope.mode,
      envelopeStatus: envelope.status,
      signerName: resolved.signer.full_name,
      signerEmail: maskEmail(resolved.signer.email),
      signerStatus: resolved.signer.status,
      // En secuencial, un firmante puede abrir su enlace antes de su turno.
      yourTurn: isActive,
      totalSigners: signers.length,
      signedCount: signers.filter((s) => s.status === 'signed').length,
    };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @Post(':token/otp/request')
  @ApiOperation({ summary: 'Enviar un código de un solo uso al correo del firmante' })
  async requestOtp(@Param('token') token: string, @Req() request: Request) {
    const resolved = await this.tokens.resolve(token);
    if (!resolved) this.notFound();

    const code = await this.otp.issue(resolved.signer.id);

    await this.audit.record({
      envelopeId: resolved.signer.envelope_id,
      signerId: resolved.signer.id,
      actorType: 'signer',
      eventType: 'signer.otp_requested',
      request,
    });

    // TODO(notificaciones): enviar por correo. Hasta que exista el proveedor,
    // el código se registra en el log del servidor para poder probar el flujo.
    // Nunca se devuelve en la respuesta: eso anularía el segundo factor.
    console.log(`[OTP] ${resolved.signer.email} -> ${code}`);

    return {
      sentTo: maskEmail(resolved.signer.email),
      expiresInMinutes: this.otp.ttlMinutes,
      maxAttempts: this.otp.maxAttempts,
    };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post(':token/otp/verify')
  @ApiOperation({ summary: 'Canjear el código por una sesión de firma' })
  async verifyOtp(
    @Param('token') token: string,
    @Body() dto: VerifyOtpDto,
    @Req() request: Request,
  ) {
    const resolved = await this.tokens.resolve(token);
    if (!resolved) this.notFound();

    const result = await this.otp.verify(resolved.signer.id, dto.code);

    if (!result.ok) {
      await this.audit.record({
        envelopeId: resolved.signer.envelope_id,
        signerId: resolved.signer.id,
        actorType: 'signer',
        eventType: 'signer.otp_failed',
        request,
        metadata: { reason: result.reason },
      });

      throw new UnauthorizedException(
        result.reason === 'exhausted'
          ? 'Se agotaron los intentos. Solicita un código nuevo.'
          : result.reason === 'expired'
            ? 'El código expiró. Solicita uno nuevo.'
            : 'Código incorrecto',
      );
    }

    await this.tokens.markConsumed(resolved.token.id);

    await this.audit.record({
      envelopeId: resolved.signer.envelope_id,
      signerId: resolved.signer.id,
      actorType: 'signer',
      eventType: 'signer.otp_verified',
      request,
    });

    const session = this.sessions.issue({
      signerId: resolved.signer.id,
      envelopeId: resolved.signer.envelope_id,
      tokenId: resolved.token.id,
    });

    return session;
  }

  @Public()
  @UseGuards(SignerSessionGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('session/me')
  @ApiOperation({ summary: 'Sobre y campos propios del firmante autenticado' })
  async session(@Req() request: RequestWithSigner) {
    const { envelope, signers, fields } = await this.envelopes.getBundle(request.signer.envelopeId);
    const me = signers.find((s) => s.id === request.signer.signerId);
    if (!me) this.notFound();

    await this.audit.record({
      envelopeId: envelope.id,
      signerId: me.id,
      actorType: 'signer',
      eventType: 'signer.document_viewed',
      request,
    });

    return {
      envelope: this.envelopes.mapEnvelope(envelope),
      me: this.envelopes.mapSigner(me),
      yourTurn: activeSigners(signers, envelope.mode).some((s) => s.id === me.id),
      // Solo los campos propios: el firmante no necesita ver dónde firman los demás.
      fields: fields.filter((f) => f.signer_id === me.id).map((f) => this.envelopes.mapField(f)),
      otherSigners: signers
        .filter((s) => s.id !== me.id)
        .map((s) => ({
          fullName: s.full_name,
          roleLabel: s.role_label,
          status: s.status,
          orderIndex: s.order_index,
        })),
    };
  }

  @Public()
  @UseGuards(SignerSessionGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('session/document')
  @ApiOperation({ summary: 'URL firmada del documento en su estado actual' })
  async document(@Req() request: RequestWithSigner) {
    const { envelope } = await this.envelopes.getBundle(request.signer.envelopeId);
    const url = await this.envelopes.signedUrl(envelope.current_pdf_path, 300);
    return { url, expiresIn: 300 };
  }

  @Public()
  @UseGuards(SignerSessionGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('session/submit')
  @ApiOperation({ summary: 'Firmar: el servidor estampa los campos del firmante' })
  submit(@Body() dto: SubmitSignatureDto, @Req() request: RequestWithSigner) {
    return this.signing.submitSignature({
      envelopeId: request.signer.envelopeId,
      signerId: request.signer.signerId,
      signatureBase64: dto.signatureImageBase64,
      fullName: dto.fullName,
      request,
    });
  }

  @Public()
  @UseGuards(SignerSessionGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('session/decline')
  @ApiOperation({ summary: 'Rechazar la firma indicando el motivo' })
  decline(@Body() dto: DeclineDto, @Req() request: RequestWithSigner) {
    return this.signing.decline({
      envelopeId: request.signer.envelopeId,
      signerId: request.signer.signerId,
      reason: dto.reason,
      request,
    });
  }
}

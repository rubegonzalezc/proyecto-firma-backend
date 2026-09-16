import {
  Body,
  Controller,
  ForbiddenException,
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
import { CurrentUser, Public } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/types/database.types';
import { AuthService } from '../auth/auth.service';
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
import { LegalService } from '../legal/legal.service';
import { MailService } from '../mail/mail.service';
import { otpEmail } from '../mail/mail.templates';
import type { SignatureMethod } from '../legal/signature-levels';
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
    private readonly authService: AuthService,
    private readonly legal: LegalService,
    private readonly mail: MailService,
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
      ...this.signingRequirements(envelope, resolved.signer),
    };
  }

  /**
   * Resuelve el enlace y comprueba que pertenece a quien lo está usando.
   *
   * Los tres caminos con cuenta —ver, firmar y rechazar— hacían la misma
   * comprobación copiada. Rechazar es un acto con las mismas consecuencias que
   * firmar: no puede depender de que alguien se acuerde de repetirla.
   */
  private async requireOwnLink(token: string, user: AuthUser) {
    const resolved = await this.tokens.resolve(token);
    if (!resolved) this.notFound();

    if (user.email.trim().toLowerCase() !== resolved.signer.email.trim().toLowerCase()) {
      throw new ForbiddenException(
        'Debes iniciar sesión con la cuenta invitada a firmar este documento.',
      );
    }

    return resolved;
  }

  /**
   * Qué firma exige este sobre y con qué puede cumplirla este firmante.
   *
   * Se devuelve en todas las vistas del portal, incluida la previa al acceso:
   * enterarse de que hace falta el RUT y una firma dibujada después de pedir el
   * código al correo es exactamente el momento en que la gente abandona.
   */
  private signingRequirements(
    envelope: { document_type: string; required_level: string; consent_text: string | null },
    signer: { allowed_methods: SignatureMethod[] | null; require_rut: boolean },
  ) {
    const rule = this.legal.rule(envelope.document_type);
    const allowed = signer.allowed_methods?.length ? signer.allowed_methods : undefined;
    const recommendation = this.legal.recommend(envelope.document_type);

    return {
      legal: {
        documentType: rule.id,
        documentTypeLabel: rule.label,
        requiredLevel: envelope.required_level,
        allowedMethods: allowed ?? recommendation.allowedMethods,
        requireRut: signer.require_rut,
        consentText: envelope.consent_text ?? recommendation.consentText,
        obligations: rule.obligations,
        warnings: rule.warnings,
        legalBasis: rule.legalBasis,
        disclaimer: recommendation.disclaimer,
      },
    };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @Post(':token/otp/request')
  @ApiOperation({ summary: 'Enviar un código de un solo uso al correo del firmante' })
  async requestOtp(@Param('token') token: string, @Req() request: Request) {
    const resolved = await this.tokens.resolve(token);
    if (!resolved) this.notFound();

    const { envelope } = await this.envelopes.getBundle(resolved.signer.envelope_id);
    const code = await this.otp.issue(resolved.signer.id);

    // El firmante está mirando la pantalla esperando el código: si el envío
    // falla tiene que enterarse ahora, no quedarse revisando su bandeja.
    // El código nunca vuelve en la respuesta: eso anularía el segundo factor.
    await this.mail.send({
      to: resolved.signer.email,
      critical: true,
      tag: 'otp',
      email: otpEmail({
        code,
        documentName: envelope.name,
        expiresInMinutes: this.otp.ttlMinutes,
      }),
    });

    await this.audit.record({
      envelopeId: resolved.signer.envelope_id,
      signerId: resolved.signer.id,
      actorType: 'signer',
      eventType: 'signer.otp_requested',
      request,
    });

    return {
      sentTo: maskEmail(resolved.signer.email),
      expiresInMinutes: this.otp.ttlMinutes,
      maxAttempts: this.otp.maxAttempts,
      // En desarrollo sin proveedor, el código sale por el log del servidor;
      // avisarlo evita que alguien espere un correo que no va a llegar.
      deliveredByEmail: this.mail.isConfigured,
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
      ...this.signingRequirements(envelope, me),
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
  async submit(@Body() dto: SubmitSignatureDto, @Req() request: RequestWithSigner) {
    const { signers } = await this.envelopes.getBundle(request.signer.envelopeId);
    const me = signers.find((s) => s.id === request.signer.signerId);
    if (!me) this.notFound();

    return this.signing.submitSignature({
      envelopeId: request.signer.envelopeId,
      signerId: request.signer.signerId,
      fullName: me.full_name,
      submission: {
        method: dto.method,
        consentAccepted: dto.consentAccepted,
        // Llegó hasta aquí canjeando un código de un solo uso enviado a su
        // correo: es la identificación más fuerte que produce la plataforma.
        authMethod: 'email_otp',
        signatureImageBase64: dto.signatureImageBase64,
        typedName: dto.typedName,
        typedStyle: dto.typedStyle,
        rut: dto.rut,
      },
      request,
    });
  }

  @Get(':token/account')
  @ApiOperation({ summary: 'Contexto del enlace para un usuario autenticado' })
  async accountContext(@Param('token') token: string, @CurrentUser() user: AuthUser) {
    const resolved = await this.requireOwnLink(token, user);

    const { envelope, signers } = await this.envelopes.getBundle(resolved.signer.envelope_id);
    const profile = await this.authService.getProfile(user);
    const displayName = profile.full_name?.trim() || user.email;

    return {
      documentName: envelope.name,
      message: envelope.message,
      signerName: displayName,
      signerEmail: user.email,
      yourTurn: activeSigners(signers, envelope.mode).some((s) => s.id === resolved.signer.id),
      envelopeStatus: envelope.status,
      ...this.signingRequirements(envelope, resolved.signer),
    };
  }

  @Get(':token/account/document')
  @ApiOperation({ summary: 'PDF actual del sobre para el firmante autenticado' })
  async accountDocument(@Param('token') token: string, @CurrentUser() user: AuthUser) {
    const resolved = await this.requireOwnLink(token, user);
    const { envelope } = await this.envelopes.getBundle(resolved.signer.envelope_id);
    const url = await this.envelopes.signedUrl(envelope.current_pdf_path, 300);
    return { url, expiresIn: 300 };
  }

  @Post(':token/account/submit')
  @ApiOperation({ summary: 'Firmar con la cuenta invitada, eligiendo el método de firma' })
  async accountSubmit(
    @Param('token') token: string,
    @Body() dto: SubmitSignatureDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const resolved = await this.requireOwnLink(token, user);
    const profile = await this.authService.getProfile(user);
    const displayName = profile.full_name?.trim() || user.email;

    return this.signing.submitSignature({
      envelopeId: resolved.signer.envelope_id,
      signerId: resolved.signer.id,
      fullName: displayName,
      submission: {
        method: dto.method,
        consentAccepted: dto.consentAccepted,
        authMethod: 'account_password',
        signatureImageBase64: dto.signatureImageBase64,
        typedName: dto.typedName,
        typedStyle: dto.typedStyle,
        rut: dto.rut,
      },
      request,
    });
  }

  @Post(':token/account/decline')
  @ApiOperation({ summary: 'Rechazar la firma con la cuenta invitada' })
  async accountDecline(
    @Param('token') token: string,
    @Body() dto: DeclineDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    const resolved = await this.requireOwnLink(token, user);

    return this.signing.decline({
      envelopeId: resolved.signer.envelope_id,
      signerId: resolved.signer.id,
      reason: dto.reason,
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

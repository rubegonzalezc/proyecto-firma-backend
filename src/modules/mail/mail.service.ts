import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RenderedEmail } from './mail.templates';

export interface SendMailParams {
  to: string;
  email: RenderedEmail;
  /**
   * Si el usuario está esperando este correo en pantalla —el código de firma—
   * el fallo tiene que llegarle. Para los avisos, no: que no salga un correo de
   * cortesía no puede tumbar una firma que ya se estampó.
   */
  critical?: boolean;
  /** Agrupa los envíos en el panel de Resend. */
  tag?: string;
}

interface ResendErrorBody {
  name?: string;
  message?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Envío de correo a través de Resend.
 *
 * Sin clave configurada cae a un transporte de registro que escribe el correo
 * en el log del servidor. Eso es lo que hacía antes el código de un solo uso, y
 * sigue siendo útil en desarrollo; la diferencia es que ahora es una decisión
 * explícita y visible al arrancar, no el único camino que existía.
 *
 * Se usa `fetch` en vez del SDK de Resend a propósito: este despliegue ya se
 * rompió una vez en Vercel por un paquete solo-ESM, y la API son dos campos y
 * un POST.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string | undefined;
  private readonly from: string;
  private readonly replyTo: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('mail.resendApiKey') || undefined;
    this.from = this.config.get<string>('mail.from') ?? 'SynchroSign <onboarding@resend.dev>';
    this.replyTo = this.config.get<string>('mail.replyTo') || undefined;

    if (!this.apiKey) {
      this.logger.warn(
        'RESEND_API_KEY no está configurada: los correos se escribirán en el log en vez de enviarse. ' +
          'En producción esto deja al firmante externo sin código de acceso.',
      );
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async send(params: SendMailParams): Promise<{ id: string | null; delivered: boolean }> {
    if (!this.apiKey) {
      return this.logInstead(params);
    }

    try {
      const response = await this.post({
        from: this.from,
        to: [params.to],
        subject: params.email.subject,
        html: params.email.html,
        text: params.email.text,
        ...(this.replyTo ? { reply_to: this.replyTo } : {}),
        ...(params.tag ? { tags: [{ name: 'kind', value: params.tag }] } : {}),
      });

      this.logger.log(`Correo "${params.tag ?? 'sin etiqueta'}" enviado a ${mask(params.to)}`);
      return { id: response.id ?? null, delivered: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'error desconocido';
      this.logger.error(`No se pudo enviar el correo a ${mask(params.to)}: ${reason}`);

      if (params.critical) {
        throw new ServiceUnavailableException(
          'No pudimos enviar el correo en este momento. Inténtalo de nuevo en unos minutos.',
        );
      }

      return { id: null, delivered: false };
    }
  }

  private async post(body: Record<string, unknown>): Promise<{ id?: string }> {
    // Sin timeout, un Resend lento deja colgada la petición del firmante que
    // está esperando su código.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as ResendErrorBody | null;
        throw new Error(
          `Resend respondió ${response.status}: ${detail?.message ?? response.statusText}`,
        );
      }

      return (await response.json()) as { id?: string };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Transporte de desarrollo. El cuerpo completo se escribe en el log a
   * propósito: es la única forma de recuperar un código de un solo uso cuando
   * no hay proveedor.
   */
  private logInstead(params: SendMailParams): { id: string | null; delivered: boolean } {
    this.logger.warn(
      [
        '',
        '─── correo no enviado (sin RESEND_API_KEY) ───',
        `Para:    ${params.to}`,
        `Asunto:  ${params.email.subject}`,
        '',
        params.email.text,
        '───────────────────────────────────────────────',
      ].join('\n'),
    );
    return { id: null, delivered: false };
  }
}

/** `ana@empresa.cl` → `a***@empresa.cl`, para no volcar correos en el log. */
function mask(email: string): string {
  return email.replace(/^(.).*(@.*)$/, '$1***$2');
}

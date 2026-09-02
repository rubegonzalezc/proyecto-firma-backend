import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

export type AuditEventType =
  | 'envelope.created'
  | 'envelope.sent'
  | 'envelope.voided'
  | 'envelope.completed'
  | 'envelope.downloaded'
  | 'signer.invited'
  | 'signer.link_opened'
  | 'signer.otp_requested'
  | 'signer.otp_verified'
  | 'signer.otp_failed'
  | 'signer.document_viewed'
  | 'signer.signed'
  | 'signer.declined';

export interface AuditInput {
  envelopeId: string;
  signerId?: string | null;
  actorType: 'owner' | 'signer' | 'system';
  eventType: AuditEventType;
  request?: Request;
  metadata?: Record<string, unknown>;
  sha256Before?: string | null;
  sha256After?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Extrae la IP real del firmante. Requiere `trust proxy` activado en main.ts;
   * sin eso, detrás de un balanceador se registraría la IP del proxy y la
   * evidencia de auditoría no valdría nada.
   */
  private clientIp(request?: Request): string | null {
    if (!request) return null;
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return request.ip ?? null;
  }

  /**
   * La auditoría nunca debe tumbar la operación que la origina: si falla el
   * registro se deja traza en el log del servidor y se sigue adelante.
   */
  async record(input: AuditInput): Promise<void> {
    const { error } = await this.supabase.admin.from('audit_events').insert({
      envelope_id: input.envelopeId,
      signer_id: input.signerId ?? null,
      actor_type: input.actorType,
      event_type: input.eventType,
      ip: this.clientIp(input.request),
      user_agent: input.request?.headers['user-agent'] ?? null,
      metadata: input.metadata ?? {},
      sha256_before: input.sha256Before ?? null,
      sha256_after: input.sha256After ?? null,
    });

    if (error) {
      this.logger.error(`No se pudo registrar ${input.eventType}: ${error.message}`);
    }
  }

  async listForEnvelope(envelopeId: string) {
    const { data, error } = await this.supabase.admin
      .from('audit_events')
      .select('*')
      .eq('envelope_id', envelopeId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data ?? [];
  }
}

import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

export type AuditEventType =
  | 'envelope.created'
  | 'envelope.sent'
  | 'envelope.voided'
  | 'envelope.completed'
  | 'envelope.expired'
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

export interface AuditEventView {
  id: string;
  signerId: string | null;
  actorType: string;
  eventType: string;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  /** Hash del documento antes y después del evento, cuando lo cambió. */
  sha256Before: string | null;
  sha256After: string | null;
  createdAt: string;
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

  /**
   * Traza del sobre, mapeada.
   *
   * Antes devolvía las filas crudas de la tabla: el cliente tenía que conocer
   * los nombres de columna de la base de datos, y cualquier cambio de esquema
   * le llegaba directo. El resto de la API mapea; esta también.
   */
  async listForEnvelope(envelopeId: string): Promise<AuditEventView[]> {
    const { data, error } = await this.supabase.admin
      .from('audit_events')
      .select('*')
      .eq('envelope_id', envelopeId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      signerId: (row.signer_id as string | null) ?? null,
      actorType: row.actor_type as string,
      eventType: row.event_type as string,
      ip: (row.ip as string | null) ?? null,
      userAgent: (row.user_agent as string | null) ?? null,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      sha256Before: (row.sha256_before as string | null) ?? null,
      sha256After: (row.sha256_after as string | null) ?? null,
      createdAt: row.created_at as string,
    }));
  }
}

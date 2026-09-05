import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

export type DocumentAuditEventType =
  | 'document.created'
  | 'document.signed'
  | 'document.downloaded'
  | 'document.verified';

export interface DocumentAuditInput {
  documentId: string;
  userId?: string | null;
  eventType: DocumentAuditEventType;
  request?: Request;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class DocumentAuditService {
  private readonly logger = new Logger(DocumentAuditService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private clientIp(request?: Request): string | null {
    if (!request) return null;
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return request.ip ?? null;
  }

  async record(input: DocumentAuditInput): Promise<void> {
    const { error } = await this.supabase.admin.from('document_audit_events').insert({
      document_id: input.documentId,
      user_id: input.userId ?? null,
      event_type: input.eventType,
      ip: this.clientIp(input.request),
      user_agent: input.request?.headers['user-agent'] ?? null,
      metadata: input.metadata ?? {},
    });

    if (error) {
      this.logger.error(`No se pudo registrar ${input.eventType}: ${error.message}`);
    }
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EnvelopeRow, EnvelopeSignerRow } from '../../common/types/database.types';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

export type NotificationType =
  | 'signature_requested'
  | 'signer_signed'
  | 'envelope_completed';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  envelopeId?: string | null;
  documentId?: string | null;
  actionPath?: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async listForUser(userId: string, unreadOnly = false, limit = 30) {
    let query = this.supabase.admin
      .from('user_notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (unreadOnly) {
      query = query.is('read_at', null);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => this.mapNotification(row));
  }

  async unreadCount(userId: string): Promise<number> {
    const { count, error } = await this.supabase.admin
      .from('user_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);

    if (error) throw error;
    return count ?? 0;
  }

  async markRead(userId: string, id: string) {
    const { data, error } = await this.supabase.admin
      .from('user_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new NotFoundException('Notificación no encontrada');
    return this.mapNotification(data);
  }

  async markAllRead(userId: string) {
    const { error } = await this.supabase.admin
      .from('user_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);

    if (error) throw error;
    return { updated: true };
  }

  async create(input: CreateNotificationInput): Promise<void> {
    const { error } = await this.supabase.admin.from('user_notifications').insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      envelope_id: input.envelopeId ?? null,
      document_id: input.documentId ?? null,
      action_path: input.actionPath ?? null,
    });

    if (error) {
      this.logger.error(`No se pudo crear notificación ${input.type}: ${error.message}`);
    }
  }

  async createMany(inputs: CreateNotificationInput[]): Promise<void> {
    if (inputs.length === 0) return;

    const { error } = await this.supabase.admin.from('user_notifications').insert(
      inputs.map((input) => ({
        user_id: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        envelope_id: input.envelopeId ?? null,
        document_id: input.documentId ?? null,
        action_path: input.actionPath ?? null,
      })),
    );

    if (error) {
      this.logger.error(`No se pudieron crear notificaciones: ${error.message}`);
    }
  }

  private async userIdsByEmails(emails: string[]): Promise<Map<string, string>> {
    const normalized = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (normalized.length === 0) return new Map();

    const map = new Map<string, string>();
    for (const email of normalized) {
      const { data, error } = await this.supabase.admin
        .from('profiles')
        .select('id, email')
        .ilike('email', email)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (data) map.set(email, data.id as string);
    }
    return map;
  }

  async notifyEnvelopeSent(params: {
    envelope: EnvelopeRow;
    signers: EnvelopeSignerRow[];
    ownerUserId: string;
  }): Promise<void> {
    const usersByEmail = await this.userIdsByEmails(params.signers.map((s) => s.email));

    const notifications: CreateNotificationInput[] = [];

    for (const signer of params.signers) {
      const userId = usersByEmail.get(signer.email.trim().toLowerCase());
      if (!userId || userId === params.ownerUserId) continue;

      notifications.push({
        userId,
        type: 'signature_requested',
        title: 'Documento para firmar',
        body: `Te invitaron a firmar «${params.envelope.name}».`,
        envelopeId: params.envelope.id,
        documentId: params.envelope.document_id,
        actionPath: '/documents',
      });
    }

    await this.createMany(notifications);
  }

  async notifySignerSigned(params: {
    envelope: EnvelopeRow;
    signer: EnvelopeSignerRow;
    ownerUserId: string;
  }): Promise<void> {
    const signerName = params.signer.full_name?.trim() || params.signer.email;

    await this.create({
      userId: params.ownerUserId,
      type: 'signer_signed',
      title: 'Nueva firma registrada',
      body: `${signerName} firmó «${params.envelope.name}».`,
      envelopeId: params.envelope.id,
      documentId: params.envelope.document_id,
      actionPath: '/documents',
    });
  }

  async notifyEnvelopeCompleted(params: {
    envelope: EnvelopeRow;
    signers: EnvelopeSignerRow[];
    ownerUserId: string;
  }): Promise<void> {
    const usersByEmail = await this.userIdsByEmails(
      params.signers.map((s) => s.email),
    );

    const recipientIds = new Set<string>([params.ownerUserId]);
    for (const signer of params.signers) {
      const userId = usersByEmail.get(signer.email.trim().toLowerCase());
      if (userId) recipientIds.add(userId);
    }

    await this.createMany(
      [...recipientIds].map((userId) => ({
        userId,
        type: 'envelope_completed' as const,
        title: 'Documento completado',
        body: `El documento «${params.envelope.name}» fue firmado por todos.`,
        envelopeId: params.envelope.id,
        documentId: params.envelope.document_id,
        actionPath: '/documents',
      })),
    );
  }

  private mapNotification(row: Record<string, unknown>) {
    return {
      id: row.id as string,
      type: row.type as NotificationType,
      title: row.title as string,
      body: row.body as string,
      envelopeId: (row.envelope_id as string | null) ?? null,
      documentId: (row.document_id as string | null) ?? null,
      actionPath: (row.action_path as string | null) ?? null,
      readAt: (row.read_at as string | null) ?? null,
      createdAt: row.created_at as string,
    };
  }
}

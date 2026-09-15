import { ConfigService } from '@nestjs/config';
import { SupabaseFake } from '../../testing/supabase-fake';
import { AuditService } from '../audit/audit.service';
import { LegalService } from '../legal/legal.service';
import type { MailService } from '../mail/mail.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SignerTokenService } from '../signer-access/signer-token.service';
import { EnvelopesService } from './envelopes.service';

const HOUR = 3_600_000;

function setup(expiresAt: string | null, status = 'sent') {
  const db = new SupabaseFake();

  db.seed('envelopes', [
    {
      id: 'env-1',
      user_id: 'user-1',
      document_id: 'doc-1',
      name: 'Contrato',
      mode: 'parallel',
      status,
      expires_at: expiresAt,
      current_version: 0,
      original_pdf_path: 'o.pdf',
      current_pdf_path: 'v0.pdf',
      original_sha256: 'a'.repeat(64),
      document_type: 'otro',
      required_level: 'fes',
      consent_text: null,
      created_at: new Date().toISOString(),
    },
  ]);
  db.seed('envelope_signers', [
    { id: 's1', envelope_id: 'env-1', order_index: 0, email: 'a@b.cl', status: 'notified' },
  ]);
  db.seed('signature_fields', []);
  db.seed('audit_events', []);

  const service = new EnvelopesService(
    db.asService(),
    new AuditService(db.asService()),
    {} as SignerTokenService,
    {} as NotificationsService,
    new LegalService(),
    {} as MailService,
    { get: () => '' } as unknown as ConfigService,
  );

  return { db, service };
}

describe('caducidad de sobres', () => {
  const past = () => new Date(Date.now() - HOUR).toISOString();
  const future = () => new Date(Date.now() + HOUR).toISOString();

  it('marca como caducado el sobre cuya fecha ya pasó', async () => {
    const { db, service } = setup(past());

    const { envelope } = await service.getBundle('env-1');

    expect(envelope.status).toBe('expired');
    // Y se persiste: si solo se devolviera, la lista seguiría mostrándolo vivo.
    expect(db.rows('envelopes')[0].status).toBe('expired');
  });

  it('deja en paz el que todavía no ha caducado', async () => {
    const { db, service } = setup(future());

    const { envelope } = await service.getBundle('env-1');

    expect(envelope.status).toBe('sent');
    expect(db.rows('envelopes')[0].status).toBe('sent');
  });

  it('no caduca un sobre sin fecha', async () => {
    const { service } = setup(null);
    expect((await service.getBundle('env-1')).envelope.status).toBe('sent');
  });

  it('no resucita ni toca los sobres ya cerrados', async () => {
    // Un sobre completado con fecha pasada sigue completado: la firma ya
    // ocurrió y caducar el plazo no la deshace.
    for (const status of ['completed', 'declined', 'voided']) {
      const { service } = setup(past(), status);
      expect((await service.getBundle('env-1')).envelope.status).toBe(status);
    }
  });

  it('caduca también los que estaban a medio firmar', async () => {
    const { service } = setup(past(), 'in_progress');
    expect((await service.getBundle('env-1')).envelope.status).toBe('expired');
  });

  it('deja constancia en la traza de auditoría', async () => {
    const { db, service } = setup(past());

    await service.getBundle('env-1');

    const event = db.rows('audit_events').find((e) => e.event_type === 'envelope.expired');
    expect(event).toBeDefined();
    expect(event!.actor_type).toBe('system');
  });

  it('no registra el evento dos veces al leerlo de nuevo', async () => {
    const { db, service } = setup(past());

    await service.getBundle('env-1');
    await service.getBundle('env-1');

    expect(db.rows('audit_events').filter((e) => e.event_type === 'envelope.expired')).toHaveLength(
      1,
    );
  });
});

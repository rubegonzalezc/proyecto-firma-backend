-- Migration 011: notificaciones in-app por usuario
-- Ejecutar después de 010_envelopes_better_auth_user_id.sql

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (
    type IN (
      'signature_requested',
      'signer_signed',
      'envelope_completed'
    )
  ),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  envelope_id UUID REFERENCES public.envelopes(id) ON DELETE SET NULL,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  action_path TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
  ON public.user_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_notifications_unread_idx
  ON public.user_notifications(user_id)
  WHERE read_at IS NULL;

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_notifications FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_notifications TO service_role;

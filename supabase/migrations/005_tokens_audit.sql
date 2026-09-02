-- Migration 005: enlaces de firma, códigos de un solo uso y auditoría
-- Requiere 004_envelopes.sql

-- Enlace único que recibe el firmante por correo. En claro solo viaja en el
-- email: aquí se guarda únicamente su SHA-256.
CREATE TABLE public.signer_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_id UUID NOT NULL REFERENCES public.envelope_signers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  -- Primer canje correcto. El enlace no se invalida al abrirlo (el firmante
  -- puede volver al correo); la barrera de un solo uso está en el OTP.
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX signer_tokens_signer_idx ON public.signer_tokens(signer_id);

CREATE TABLE public.signer_otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_id UUID NOT NULL REFERENCES public.envelope_signers(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX signer_otp_signer_idx
  ON public.signer_otp_challenges(signer_id, created_at DESC);

-- Registro append-only: es la evidencia de qué pasó y cuándo.
CREATE TABLE public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id UUID NOT NULL REFERENCES public.envelopes(id) ON DELETE CASCADE,
  signer_id UUID REFERENCES public.envelope_signers(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('owner', 'signer', 'system')),
  event_type TEXT NOT NULL,
  ip INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sha256_before TEXT,
  sha256_after TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_envelope_idx ON public.audit_events(envelope_id, created_at);

CREATE TABLE public.email_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id UUID REFERENCES public.envelopes(id) ON DELETE CASCADE,
  signer_id UUID REFERENCES public.envelope_signers(id) ON DELETE CASCADE,
  template TEXT NOT NULL,
  to_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  provider_message_id TEXT,
  error TEXT,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX email_deliveries_signer_idx ON public.email_deliveries(signer_id, created_at DESC);

ALTER TABLE public.signer_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signer_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;

-- Tokens y OTP no se exponen a ningún rol de cliente: solo los toca el API con
-- service_role, que no pasa por RLS. Sin políticas = sin acceso.

CREATE POLICY audit_events_select_own ON public.audit_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.envelopes e WHERE e.id = envelope_id AND e.user_id = auth.uid()));

-- La auditoría no se corrige a posteriori: sin políticas de UPDATE/DELETE, y
-- se revocan los permisos de tabla por si se añadiera alguna por descuido.
REVOKE UPDATE, DELETE ON public.audit_events FROM authenticated, anon;

CREATE POLICY email_deliveries_select_own ON public.email_deliveries
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.envelopes e WHERE e.id = envelope_id AND e.user_id = auth.uid()));

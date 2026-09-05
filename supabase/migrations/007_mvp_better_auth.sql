-- Migration 007: BetterAuth + MVP usable (hash, auditoría de documentos)
-- Ejecutar después de 001–006. Desacopla profiles/documents de auth.users.

-- 1. Desacoplar de Supabase Auth
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_user_id_fkey;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 2. Integridad del PDF firmado
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS signed_sha256 TEXT;

-- 3. Reservar código de verificación al crear (nullable hasta firmar sigue siendo
--    válido; el servicio lo genera en draft para estampar el QR antes de firmar)
--    La columna verification_code ya existe; no requiere cambio de esquema.

-- 4. Auditoría mínima del flujo de un firmante (independiente de envelope audit)
CREATE TABLE IF NOT EXISTS public.document_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id UUID,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('document.created', 'document.signed', 'document.downloaded', 'document.verified')
  ),
  ip INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_audit_events_doc_idx
  ON public.document_audit_events(document_id, created_at);

ALTER TABLE public.document_audit_events ENABLE ROW LEVEL SECURITY;

-- Solo el backend (service_role) escribe auditoría de documentos
REVOKE ALL ON public.document_audit_events FROM anon, authenticated;
GRANT SELECT, INSERT ON public.document_audit_events TO service_role;

-- 5. Vista pública con hash para verificación de integridad
CREATE OR REPLACE VIEW public.document_verifications AS
SELECT
  d.verification_code,
  d.name,
  d.signer_name,
  d.signer_email,
  d.signed_at,
  d.signed_pdf_path,
  d.signed_sha256,
  d.status
FROM public.documents d
WHERE d.status = 'signed' AND d.verification_code IS NOT NULL
UNION ALL
SELECT
  e.verification_code,
  e.name,
  (SELECT s.full_name FROM public.envelope_signers s
    WHERE s.envelope_id = e.id ORDER BY s.order_index LIMIT 1),
  NULL,
  e.completed_at,
  e.final_pdf_path,
  e.final_sha256,
  'signed'
FROM public.envelopes e
WHERE e.status = 'completed' AND e.verification_code IS NOT NULL;

GRANT SELECT ON public.document_verifications TO anon, authenticated;

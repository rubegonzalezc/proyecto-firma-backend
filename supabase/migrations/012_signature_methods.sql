-- Migration 012: métodos de firma, nivel legal exigido y evidencia de consentimiento
-- Requiere 004_envelopes.sql y 006_verification_v2.sql

-- ── Sobre: qué documento es y qué firma exige ────────────────────────────────
-- Hasta ahora todos los sobres eran iguales: una firma simple sin declarar. Con
-- el tipo de documento el sistema puede exigir el nivel que la ley pide para
-- ese acto en concreto, en vez de aceptar cualquier cosa y llamarlo firmado.
ALTER TABLE public.envelopes
  ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'otro',
  ADD COLUMN IF NOT EXISTS required_level TEXT NOT NULL DEFAULT 'fes',
  ADD COLUMN IF NOT EXISTS legal_framework TEXT NOT NULL DEFAULT 'CL',
  ADD COLUMN IF NOT EXISTS consent_text TEXT;

ALTER TABLE public.envelopes
  DROP CONSTRAINT IF EXISTS envelopes_required_level_check;
ALTER TABLE public.envelopes
  ADD CONSTRAINT envelopes_required_level_check
  CHECK (required_level IN ('fes', 'fes_verificada', 'fea', 'notarial', 'no_electronica'));

COMMENT ON COLUMN public.envelopes.document_type IS
  'Id del catálogo legal (src/modules/legal/document-types.catalog.ts)';
COMMENT ON COLUMN public.envelopes.required_level IS
  'Nivel mínimo de firma exigido a cada firmante de este sobre';
COMMENT ON COLUMN public.envelopes.consent_text IS
  'Declaración exacta que aceptó cada firmante; se conserva porque el texto del catálogo puede cambiar';

-- ── Firmante: cómo firmó, cómo se identificó y qué consintió ────────────────
ALTER TABLE public.envelope_signers
  ADD COLUMN IF NOT EXISTS allowed_methods TEXT[] NOT NULL DEFAULT ARRAY['draw', 'type', 'upload']::TEXT[],
  ADD COLUMN IF NOT EXISTS signature_method TEXT,
  ADD COLUMN IF NOT EXISTS signature_level TEXT,
  ADD COLUMN IF NOT EXISTS auth_method TEXT,
  ADD COLUMN IF NOT EXISTS signature_image_path TEXT,
  ADD COLUMN IF NOT EXISTS require_rut BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS identity_rut TEXT,
  ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_sha256 TEXT;

ALTER TABLE public.envelope_signers
  DROP CONSTRAINT IF EXISTS envelope_signers_method_check;
ALTER TABLE public.envelope_signers
  ADD CONSTRAINT envelope_signers_method_check
  CHECK (signature_method IS NULL OR signature_method IN ('draw', 'type', 'upload', 'click', 'certificate'));

ALTER TABLE public.envelope_signers
  DROP CONSTRAINT IF EXISTS envelope_signers_level_check;
ALTER TABLE public.envelope_signers
  ADD CONSTRAINT envelope_signers_level_check
  CHECK (signature_level IS NULL OR signature_level IN ('fes', 'fes_verificada', 'fea'));

ALTER TABLE public.envelope_signers
  DROP CONSTRAINT IF EXISTS envelope_signers_auth_check;
ALTER TABLE public.envelope_signers
  ADD CONSTRAINT envelope_signers_auth_check
  CHECK (auth_method IS NULL OR auth_method IN ('link_only', 'email_otp', 'account_password'));

-- Una firma registrada sin constancia de consentimiento no es prueba de nada:
-- la restricción impide que quede una fila en ese estado por un camino nuevo
-- que olvide escribir el consentimiento.
--
-- Se añade NOT VALID a propósito. Las firmas anteriores a esta migración no
-- tienen método ni consentimiento registrados, y rellenarlas con un valor por
-- defecto sería inventar cómo firmó una persona real. Se quedan como están
-- —la verificación pública las marca como heredadas— y la restricción rige
-- para todo lo que se escriba a partir de ahora.
ALTER TABLE public.envelope_signers
  DROP CONSTRAINT IF EXISTS envelope_signers_signed_has_evidence;
ALTER TABLE public.envelope_signers
  ADD CONSTRAINT envelope_signers_signed_has_evidence
  CHECK (
    status <> 'signed'
    OR (signature_method IS NOT NULL AND consent_accepted_at IS NOT NULL)
  ) NOT VALID;

COMMENT ON COLUMN public.envelope_signers.allowed_methods IS
  'Métodos que este firmante puede usar, derivados del tipo de documento';
COMMENT ON COLUMN public.envelope_signers.signature_level IS
  'Nivel realmente alcanzado, calculado al firmar; nunca el nivel declarado por el cliente';
COMMENT ON COLUMN public.envelope_signers.identity_rut IS
  'RUT declarado por el firmante, validado en su dígito verificador. No acredita identidad ante el Registro Civil.';
COMMENT ON COLUMN public.envelope_signers.consent_sha256 IS
  'SHA-256 del texto aceptado: prueba qué se aceptó exactamente, sin duplicar el texto en cada fila';

-- La imagen de firma se guarda aparte del PDF para poder peritarla sin
-- extraerla del documento.
CREATE INDEX IF NOT EXISTS envelope_signers_level_idx
  ON public.envelope_signers(signature_level)
  WHERE signature_level IS NOT NULL;

-- ── Verificación pública: mostrar con qué se firmó ──────────────────────────
-- Un verificador que solo ve "firmado" no puede distinguir un clic de una firma
-- con identidad comprobada. La vista pasa a exponer el método y el nivel, que
-- es justo lo que permite valorar el documento.
-- Se recrea desde cero: `CREATE OR REPLACE VIEW` no admite insertar columnas
-- en medio de las existentes. La vista es derivada, así que perderla un
-- instante no cuesta nada.
DROP VIEW IF EXISTS public.envelope_verifications;

CREATE VIEW public.envelope_verifications AS
SELECT
  e.verification_code,
  e.name AS document_name,
  e.mode,
  e.document_type,
  e.required_level,
  e.legal_framework,
  e.completed_at,
  e.final_pdf_path,
  e.final_sha256,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', s.full_name,
        'email', regexp_replace(s.email, '^(.).*(@.*)$', '\1***\2'),
        'role', s.role_label,
        'order', s.order_index,
        'signedAt', s.signed_at,
        'method', s.signature_method,
        'level', s.signature_level,
        'authMethod', s.auth_method,
        -- El RUT se enmascara: sirve para confirmar uno que ya se conoce, no
        -- para que un tercero lo descubra desde el código de verificación.
        'rut', CASE
          WHEN s.identity_rut IS NULL THEN NULL
          ELSE regexp_replace(s.identity_rut, '^.*(.{4})$', '•••••\1')
        END,
        'consentAcceptedAt', s.consent_accepted_at
      ) ORDER BY s.order_index
    )
    FROM public.envelope_signers s
    WHERE s.envelope_id = e.id
  ) AS signers
FROM public.envelopes e
WHERE e.status = 'completed' AND e.verification_code IS NOT NULL;

GRANT SELECT ON public.envelope_verifications TO anon, authenticated;

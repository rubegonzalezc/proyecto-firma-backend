-- Migration 004: sobres multi-parte, firmantes y campos de firma
-- Requiere 001_initial_schema.sql

-- `documents` pasa a ser el archivo fuente inmutable. Sus columnas de firma
-- quedan como legado del flujo de un solo firmante: se dejan de escribir pero
-- no se eliminan, para no romper los documentos ya firmados.
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS sha256 TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS page_count INT;

COMMENT ON COLUMN public.documents.signer_name IS 'LEGADO: usar envelope_signers';
COMMENT ON COLUMN public.documents.signer_email IS 'LEGADO: usar envelope_signers';
COMMENT ON COLUMN public.documents.verification_code IS 'LEGADO: usar envelopes.verification_code';
COMMENT ON COLUMN public.documents.status IS 'LEGADO: usar envelopes.status';

CREATE TABLE public.envelopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  message TEXT,
  mode TEXT NOT NULL DEFAULT 'sequential'
    CHECK (mode IN ('sequential', 'parallel')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'in_progress', 'completed', 'declined', 'voided', 'expired')),
  verification_code TEXT UNIQUE,
  page_count INT NOT NULL,
  current_version INT NOT NULL DEFAULT 0,
  original_pdf_path TEXT NOT NULL,
  current_pdf_path TEXT NOT NULL,
  final_pdf_path TEXT,
  original_sha256 TEXT NOT NULL,
  final_sha256 TEXT,
  expires_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT envelopes_verification_code_format CHECK (
    verification_code IS NULL OR verification_code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$'
  )
);

CREATE INDEX envelopes_user_id_idx ON public.envelopes(user_id);
CREATE INDEX envelopes_document_id_idx ON public.envelopes(document_id);
CREATE INDEX envelopes_status_idx ON public.envelopes(status);
CREATE UNIQUE INDEX envelopes_verification_code_idx ON public.envelopes(verification_code)
  WHERE verification_code IS NOT NULL;

CREATE TABLE public.envelope_signers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id UUID NOT NULL REFERENCES public.envelopes(id) ON DELETE CASCADE,
  order_index INT NOT NULL DEFAULT 0,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('waiting', 'pending', 'notified', 'viewed', 'signed', 'declined', 'expired')),
  signed_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  decline_reason TEXT,
  signed_ip INET,
  signed_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT envelope_signers_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- Un mismo correo no puede figurar dos veces en el sobre, ni repetirse el orden.
CREATE UNIQUE INDEX envelope_signers_email_idx
  ON public.envelope_signers(envelope_id, lower(email));
CREATE UNIQUE INDEX envelope_signers_order_idx
  ON public.envelope_signers(envelope_id, order_index);

CREATE TABLE public.signature_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id UUID NOT NULL REFERENCES public.envelopes(id) ON DELETE CASCADE,
  signer_id UUID REFERENCES public.envelope_signers(id) ON DELETE CASCADE,
  page_number INT NOT NULL CHECK (page_number >= 1),
  -- Coordenadas normalizadas 0..1 en espacio visual, origen top-left.
  -- Mismo contrato que frontend/src/features/signatures/utils/pdfCoords.ts
  x NUMERIC(9, 8) NOT NULL CHECK (x >= 0 AND x <= 1),
  y NUMERIC(9, 8) NOT NULL CHECK (y >= 0 AND y <= 1),
  w NUMERIC(9, 8) NOT NULL CHECK (w > 0 AND w <= 1),
  h NUMERIC(9, 8) NOT NULL CHECK (h > 0 AND h <= 1),
  type TEXT NOT NULL DEFAULT 'signature'
    CHECK (type IN ('signature', 'initials', 'name', 'rut', 'date', 'text')),
  required BOOLEAN NOT NULL DEFAULT true,
  label TEXT,
  value_text TEXT,
  filled_at TIMESTAMPTZ,
  -- Instantánea de la geometría al definir el campo: permite detectar que el
  -- PDF cambió por debajo y que las coordenadas ya no significan lo mismo.
  page_rotation SMALLINT NOT NULL DEFAULT 0 CHECK (page_rotation IN (0, 90, 180, 270)),
  page_width_pt NUMERIC(10, 4) NOT NULL,
  page_height_pt NUMERIC(10, 4) NOT NULL,
  detection_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (detection_source IN ('heuristic', 'manual', 'fallback')),
  detection_confidence NUMERIC(4, 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT signature_fields_within_page CHECK (x + w <= 1.0001 AND y + h <= 1.0001)
);

CREATE INDEX signature_fields_envelope_idx ON public.signature_fields(envelope_id, page_number);
CREATE INDEX signature_fields_signer_idx ON public.signature_fields(signer_id);

-- Una fila por firma estampada: es la cadena de custodia del documento.
CREATE TABLE public.envelope_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id UUID NOT NULL REFERENCES public.envelopes(id) ON DELETE CASCADE,
  version INT NOT NULL,
  pdf_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_by_signer_id UUID REFERENCES public.envelope_signers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX envelope_versions_unique_idx
  ON public.envelope_versions(envelope_id, version);

CREATE TRIGGER envelopes_set_updated_at
  BEFORE UPDATE ON public.envelopes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envelope_signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envelope_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY envelopes_all_own ON public.envelopes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY envelope_signers_via_envelope ON public.envelope_signers
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.envelopes e WHERE e.id = envelope_id AND e.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.envelopes e WHERE e.id = envelope_id AND e.user_id = auth.uid()));

CREATE POLICY signature_fields_via_envelope ON public.signature_fields
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.envelopes e WHERE e.id = envelope_id AND e.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.envelopes e WHERE e.id = envelope_id AND e.user_id = auth.uid()));

CREATE POLICY envelope_versions_via_envelope ON public.envelope_versions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.envelopes e WHERE e.id = envelope_id AND e.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.envelopes e WHERE e.id = envelope_id AND e.user_id = auth.uid()));

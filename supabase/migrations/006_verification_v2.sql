-- Migration 006: verificación pública multi-firmante
-- Requiere 004_envelopes.sql y 005_tokens_audit.sql

-- Vista pública del sobre completado. No expone user_id y enmascara los
-- correos: quien verifica no tiene por qué ver la dirección completa.
CREATE OR REPLACE VIEW public.envelope_verifications AS
SELECT
  e.verification_code,
  e.name AS document_name,
  e.mode,
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
        'signedAt', s.signed_at
      ) ORDER BY s.order_index
    )
    FROM public.envelope_signers s
    WHERE s.envelope_id = e.id
  ) AS signers
FROM public.envelopes e
WHERE e.status = 'completed' AND e.verification_code IS NOT NULL;

GRANT SELECT ON public.envelope_verifications TO anon, authenticated;

-- La vista antigua sigue respondiendo para los documentos firmados con el
-- flujo de un firmante, y además cubre los sobres nuevos, de modo que ningún
-- código de verificación emitido deja de funcionar.
CREATE OR REPLACE VIEW public.document_verifications AS
SELECT
  d.verification_code,
  d.name,
  d.signer_name,
  d.signer_email,
  d.signed_at,
  d.signed_pdf_path,
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
  'signed'
FROM public.envelopes e
WHERE e.status = 'completed' AND e.verification_code IS NOT NULL;

GRANT SELECT ON public.document_verifications TO anon, authenticated;

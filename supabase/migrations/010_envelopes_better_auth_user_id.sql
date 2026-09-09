-- Migration 010: alinear envelopes.user_id con BetterAuth (TEXT)
-- Ejecutar después de 009_better_auth_user_ids_text.sql

DROP POLICY IF EXISTS envelopes_all_own ON public.envelopes;
DROP POLICY IF EXISTS envelope_signers_via_envelope ON public.envelope_signers;
DROP POLICY IF EXISTS signature_fields_via_envelope ON public.signature_fields;
DROP POLICY IF EXISTS envelope_versions_via_envelope ON public.envelope_versions;
DROP POLICY IF EXISTS email_deliveries_select_own ON public.email_deliveries;
DROP POLICY IF EXISTS audit_events_select_own ON public.audit_events;

ALTER TABLE public.envelopes DROP CONSTRAINT IF EXISTS envelopes_user_id_fkey;

ALTER TABLE public.envelopes
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

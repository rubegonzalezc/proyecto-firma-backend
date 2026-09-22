-- Migration 009: alinear IDs de BetterAuth (TEXT) con profiles/documents
-- Ejecutar después de 008_better_auth_tables.sql

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS documents_select_own ON public.documents;
DROP POLICY IF EXISTS documents_insert_own ON public.documents;
DROP POLICY IF EXISTS documents_update_own ON public.documents;
DROP POLICY IF EXISTS documents_delete_own ON public.documents;

ALTER TABLE public.profiles
  ALTER COLUMN id TYPE TEXT USING id::text;

ALTER TABLE public.documents
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE public.document_audit_events
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

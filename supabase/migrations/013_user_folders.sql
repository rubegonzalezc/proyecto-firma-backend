-- Migration 013: carpetas organizacionales por usuario
-- Requiere 001_initial_schema.sql

CREATE TABLE IF NOT EXISTS public.folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT folders_name_not_blank CHECK (char_length(trim(name)) > 0),
  CONSTRAINT folders_user_name_unique UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS folders_user_id_idx ON public.folders(user_id);

COMMENT ON TABLE public.folders IS
  'Carpetas organizacionales del usuario; los documentos se agrupan por folder_id.';

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS documents_folder_id_idx ON public.documents(folder_id);

COMMENT ON COLUMN public.documents.folder_id IS
  'Carpeta del documento; NULL = sin carpeta (raíz).';

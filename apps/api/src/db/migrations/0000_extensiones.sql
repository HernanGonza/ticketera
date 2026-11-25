-- Extensiones "trusted" (PostgreSQL 13+): las puede crear el dueño de la base.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
--> statement-breakpoint
-- Texto en minúsculas y sin acentos. IMMUTABLE para poder indexarlo.
CREATE OR REPLACE FUNCTION public.eco_normalizar(texto text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS
$$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, texto)) $$;

-- Extensões necessárias. Idempotente.
--
-- pgvector guarda os embeddings da base de conhecimento. No Supabase ele pode
-- já vir instalado no schema `extensions`; o `if not exists` cobre os dois casos.
create extension if not exists vector;

-- Usado pela busca textual para tolerar erro de digitação em nome de norma.
create extension if not exists pg_trgm;

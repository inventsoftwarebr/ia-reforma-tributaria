-- =============================================================================
-- Índices e busca da base de conhecimento. Idempotente (pnpm db:sql).
--
-- Fica em SQL, e não no schema Drizzle, porque é ajuste de banco: tipo de
-- índice vetorial, pesos da busca e fusão de ranking.
-- =============================================================================

-- Coluna de busca textual em português, derivada do conteúdo.
alter table public.kb_chunks
  add column if not exists tsv tsvector
  generated always as (
    to_tsvector('portuguese', coalesce(heading, '') || ' ' || content)
  ) stored;

-- Vetorial: HNSW com distância de cosseno.
create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using hnsw (embedding vector_cosine_ops);

-- Textual.
create index if not exists kb_chunks_tsv_idx
  on public.kb_chunks using gin (tsv);

-- =============================================================================
-- kb_search — busca híbrida (vetorial + textual) com fusão recíproca de rank.
--
-- Por que híbrida: a busca vetorial acha paráfrase ("o que substitui o ICMS")
-- e a textual acha citação exata ("art. 12 da LC 214"). Uma sozinha erra
-- justamente o caso da outra.
--
-- `at_date` filtra por vigência: regra revogada não sustenta resposta, e regra
-- que só entra em vigor depois aparece marcada como futura pelo chamador.
--
-- Nota de escala: o CTE materializa os chunks vigentes, o que impede o uso do
-- índice HNSW. Corpus de alguns milhares de chunks roda em milissegundos; se a
-- base crescer muito, trocar por índices parciais por vigência.
-- =============================================================================
create or replace function public.kb_search(
  query_embedding vector(1536),
  query_text text,
  match_count integer default 8,
  at_date date default current_date
)
returns table (
  chunk_id uuid,
  source_id uuid,
  heading text,
  content text,
  source_title text,
  citation_label text,
  source_kind text,
  authority text,
  source_url text,
  effective_from date,
  score real
)
language sql
stable
as $$
  with vigentes as (
    select c.id, c.source_id, c.heading, c.content, c.embedding, c.tsv,
           s.title, s.citation_label, s.kind::text as kind, s.authority::text as authority,
           s.url, s.effective_from
      from public.kb_chunks c
      join public.kb_sources s on s.id = c.source_id
     where s.status = 'active'
       and c.embedding is not null
       and (s.effective_from is null or s.effective_from <= at_date)
       and (s.effective_to is null or s.effective_to >= at_date)
  ),
  vetorial as (
    select id, row_number() over (order by embedding <=> query_embedding) as rank
      from vigentes
     order by embedding <=> query_embedding
     limit greatest(match_count * 3, 24)
  ),
  textual as (
    select id,
           row_number() over (
             order by ts_rank_cd(tsv, websearch_to_tsquery('portuguese', query_text)) desc
           ) as rank
      from vigentes
     where coalesce(query_text, '') <> ''
       and tsv @@ websearch_to_tsquery('portuguese', query_text)
     limit greatest(match_count * 3, 24)
  ),
  fusao as (
    -- Reciprocal Rank Fusion com k=60: combina as duas listas sem precisar
    -- normalizar escalas de similaridade, que não são comparáveis entre si.
    select coalesce(v.id, t.id) as id,
           (1.0 / (60 + coalesce(v.rank, 1000)))::real
         + (1.0 / (60 + coalesce(t.rank, 1000)))::real as score
      from vetorial v
      full outer join textual t on t.id = v.id
  )
  select g.id, g.source_id, g.heading, g.content, g.title, g.citation_label, g.kind,
         g.authority, g.url, g.effective_from, f.score
    from fusao f
    join vigentes g on g.id = f.id
   order by f.score desc, g.id
   limit match_count;
$$;

comment on function public.kb_search is
  'Busca híbrida na base curada, filtrada por vigência. Única porta de retrieval do agente.';

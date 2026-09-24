-- =============================================================================
-- bootstrap.sql — GERADO por scripts/build-bootstrap-sql.ts. Não edite à mão.
--
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Rode UMA vez, num projeto novo. Depois disso, mudança de schema vai por
-- migration (pnpm db:generate && pnpm db:migrate) e o resto por pnpm db:sql.
-- =============================================================================

-- Trava de segurança: aborta se o banco já tiver sido inicializado.
do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'contacts'
  ) then
    raise exception 'Banco já inicializado. Use migrations para alterações incrementais.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Extensões (db/extensions.sql)
-- -----------------------------------------------------------------------------
-- Extensões necessárias. Idempotente.
--
-- pgvector guarda os embeddings da base de conhecimento. No Supabase ele pode
-- já vir instalado no schema `extensions`; o `if not exists` cobre os dois casos.
create extension if not exists vector;

-- Usado pela busca textual para tolerar erro de digitação em nome de norma.
create extension if not exists pg_trgm;

-- Controle de migrations do drizzle.
create schema if not exists "drizzle";
create table if not exists "drizzle"."__drizzle_migrations" (
  id serial primary key,
  hash text not null,
  created_at bigint
);

-- -----------------------------------------------------------------------------
-- migration 0000_thankful_logan
-- -----------------------------------------------------------------------------
CREATE TYPE "public"."app_role" AS ENUM('admin', 'agent');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'idle', 'handoff', 'closed');--> statement-breakpoint
CREATE TYPE "public"."kb_authority" AS ENUM('oficial', 'invent', 'secundaria');--> statement-breakpoint
CREATE TYPE "public"."kb_kind" AS ENUM('emenda', 'lei_complementar', 'lei', 'instrucao_normativa', 'nota_tecnica', 'faq', 'material_invent', 'imprensa');--> statement-breakpoint
CREATE TYPE "public"."kb_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('text', 'quoted_text', 'button', 'list', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('received', 'queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"cited_chunk_ids" uuid[],
	"retrieved_count" integer DEFAULT 0 NOT NULL,
	"refused" boolean DEFAULT false NOT NULL,
	"refusal_reason" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_jid" text NOT NULL,
	"phone_e164" varchar(20) NOT NULL,
	"push_name" text,
	"consent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opt_out_at" timestamp with time zone,
	"hubspot_contact_id" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_wa_jid_unique" UNIQUE("wa_jid")
);
--> statement-breakpoint
CREATE TABLE "conversation_state" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"simulator_offered_at" timestamp with time zone,
	"simulator_offer_count" integer DEFAULT 0 NOT NULL,
	"simulator_accepted_at" timestamp with time zone,
	"simulator_declined_at" timestamp with time zone,
	"handoff_requested_at" timestamp with time zone,
	"last_topic" text,
	"lead_signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"assigned_to" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hubspot_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"error" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"ord" integer NOT NULL,
	"heading" text,
	"content" text NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_chunks_source_ord_unique" UNIQUE("source_id","ord")
);
--> statement-breakpoint
CREATE TABLE "kb_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"citation_label" text NOT NULL,
	"kind" "kb_kind" NOT NULL,
	"authority" "kb_authority" NOT NULL,
	"url" text,
	"publisher" text,
	"effective_from" date,
	"effective_to" date,
	"version" text,
	"checksum" text NOT NULL,
	"status" "kb_status" DEFAULT 'active' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"provider" text DEFAULT 'evolution' NOT NULL,
	"provider_message_id" text,
	"kind" "message_kind" NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"media" jsonb,
	"raw" jsonb,
	"status" "message_status" DEFAULT 'received' NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_provider_message_unique" UNIQUE("provider","provider_message_id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"full_name" text,
	"role" "app_role" DEFAULT 'agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" text NOT NULL,
	"content" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_key_version_unique" UNIQUE("key","version")
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"contact_id" uuid NOT NULL,
	"day" date NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_contact_id_day_pk" PRIMARY KEY("contact_id","day")
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_state" ADD CONSTRAINT "conversation_state_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hubspot_outbox" ADD CONSTRAINT "hubspot_outbox_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_source_id_kb_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."kb_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_conversation_idx" ON "ai_runs" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_created_idx" ON "ai_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("phone_e164");--> statement-breakpoint
CREATE INDEX "conversations_contact_idx" ON "conversations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "conversations" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE INDEX "hubspot_outbox_pending_idx" ON "hubspot_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "job_failures_open_idx" ON "job_failures" USING btree ("resolved_at","created_at");--> statement-breakpoint
CREATE INDEX "kb_chunks_source_idx" ON "kb_chunks" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "kb_sources_status_idx" ON "kb_sources" USING btree ("status","authority");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_pending_idx" ON "messages" USING btree ("conversation_id","processed_at");

insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
values ('5808e605b3f016586b3723611a5e94a3cab7c7ad0e9693e25c21131f8c7d9cb2', 1790272891210);

-- -----------------------------------------------------------------------------
-- db/functions.sql — idempotente, roda de novo com pnpm db:sql
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- db/rls.sql — idempotente, roda de novo com pnpm db:sql
-- -----------------------------------------------------------------------------
-- =============================================================================
-- Segurança de linha (RLS): default deny em todas as tabelas. Idempotente.
--
-- Conversa e contato são dados pessoais: leitura só para quem trabalha no
-- atendimento. O pipeline (webhook, worker, ingestão) roda com a service role,
-- que ignora RLS por ser BYPASSRLS no Supabase — essa chave nunca vai para o
-- navegador.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Perfis e papéis
-- -----------------------------------------------------------------------------

-- Toda criação em auth.users precisa gerar um profile, senão o login funciona
-- e o console não sabe quem é a pessoa.
create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

do $$
begin
  -- auth.users só existe no Supabase; em banco local/CI a trigger é ignorada.
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'auth' and table_name = 'users'
  ) then
    drop trigger if exists on_auth_user_created on auth.users;
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;

-- Id do usuário autenticado sem depender do schema `auth`: é o mesmo que o
-- auth.uid() do Supabase lê, mas o arquivo continua aplicável em Postgres
-- comum (banco local, CI), onde aquele schema não existe.
create or replace function public.auth_uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid;
$$;

create or replace function public.app_role() returns text
language sql stable as $$
  select coalesce(
    (select p.role::text from public.profiles p where p.id = public.auth_uid()),
    'anon'
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable as $$
  select public.app_role() = 'admin';
$$;

create or replace function public.is_agent() returns boolean
language sql stable as $$
  select public.app_role() in ('admin', 'agent');
$$;

-- -----------------------------------------------------------------------------
-- Habilitar e forçar RLS
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'contacts', 'conversations', 'messages', 'conversation_state',
    'kb_sources', 'kb_chunks', 'prompt_versions', 'ai_runs', 'usage_counters',
    'job_failures', 'hubspot_outbox'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Políticas
-- -----------------------------------------------------------------------------

drop policy if exists "profiles_select_self_or_agent" on public.profiles;
create policy "profiles_select_self_or_agent" on public.profiles
  for select using (id = public.auth_uid() or public.is_agent());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (id = public.auth_uid()) with check (id = public.auth_uid());

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- Dado pessoal de quem conversa com o bot: leitura para o atendimento,
-- escrita só admin (o pipeline usa service role).
do $$
declare
  t text;
begin
  foreach t in array array['contacts', 'conversations', 'messages', 'conversation_state']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_agent', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_agent())',
      t || '_select_agent', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t
    );
  end loop;
end $$;

-- Atendente pode assumir e devolver uma conversa (handoff).
drop policy if exists "conversations_update_agent" on public.conversations;
create policy "conversations_update_agent" on public.conversations
  for update using (public.is_agent()) with check (public.is_agent());

-- Base de conhecimento e prompt: leitura para o atendimento, curadoria é admin.
do $$
declare
  t text;
begin
  foreach t in array array['kb_sources', 'kb_chunks', 'prompt_versions']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_agent', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_agent())',
      t || '_select_agent', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_write', t
    );
  end loop;
end $$;

-- Telemetria e operação: admin apenas.
do $$
declare
  t text;
begin
  foreach t in array array['ai_runs', 'usage_counters', 'job_failures', 'hubspot_outbox']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t
    );
  end loop;
end $$;

-- Atendente enxerga a telemetria da conversa que está atendendo, para saber o
-- que o bot respondeu antes de assumir.
drop policy if exists "ai_runs_select_agent" on public.ai_runs;
create policy "ai_runs_select_agent" on public.ai_runs
  for select using (public.is_agent());

-- -----------------------------------------------------------------------------
-- Retenção (LGPD)
--
-- Anonimiza o conteúdo de conversas antigas preservando a métrica agregada.
-- Agendar via pg_cron depois de definir o prazo com o jurídico.
-- -----------------------------------------------------------------------------
create or replace function public.anonymize_old_messages(older_than interval)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.messages
     set body = '', media = null, raw = null
   where created_at < now() - older_than
     and (body <> '' or media is not null or raw is not null);
  get diagnostics affected = row_count;
  return affected;
end $$;

revoke all on function public.anonymize_old_messages(interval) from public;

-- anon e authenticated existem no Supabase, mas não num Postgres qualquer
-- (banco local, CI): revoga só o que existe.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format(
        'revoke all on function public.anonymize_old_messages(interval) from %I',
        role_name
      );
    end if;
  end loop;
end $$;

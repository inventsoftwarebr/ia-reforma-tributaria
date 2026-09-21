-- =============================================================================
-- bootstrap.sql — GERADO por scripts/build-bootstrap-sql.ts. Não edite à mão.
--
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Rode UMA vez, num projeto novo. Depois disso, mudanças de schema vão por
-- migration (pnpm db:generate && pnpm db:migrate) e o RLS por pnpm db:rls.
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

-- Controle de migrations do drizzle.
create schema if not exists "drizzle";
create table if not exists "drizzle"."__drizzle_migrations" (
  id serial primary key,
  hash text not null,
  created_at bigint
);

-- -----------------------------------------------------------------------------
-- migration 0000_brief_chimera
-- -----------------------------------------------------------------------------
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'idle', 'handoff', 'closed');--> statement-breakpoint
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
	"retrieved_chunk_ids" uuid[],
	"refused" boolean DEFAULT false NOT NULL,
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
	"last_topic" text,
	"handoff_requested_at" timestamp with time zone,
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
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_conversation_idx" ON "ai_runs" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("phone_e164");--> statement-breakpoint
CREATE INDEX "conversations_contact_idx" ON "conversations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "conversations" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE INDEX "hubspot_outbox_pending_idx" ON "hubspot_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "job_failures_open_idx" ON "job_failures" USING btree ("resolved_at","created_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_pending_idx" ON "messages" USING btree ("conversation_id","processed_at");

insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
values ('6abc8433501e692cddaf2fd02b2f9696fd60ab938d38a4ce9e1babe8102202c0', 1790002623447);

-- -----------------------------------------------------------------------------
-- Políticas RLS (db/rls.sql) — idempotente, pode rodar de novo quando mudar.
-- -----------------------------------------------------------------------------
-- =============================================================================
-- RLS — default deny em todas as tabelas. CLAUDE.md §10.
--
-- Conversa e contato são dados pessoais: leitura só para admin e atendente.
-- O worker (inbound e turno) roda com service role, que ignora RLS por ser
-- BYPASSRLS no Supabase — nunca expor essa chave ao browser.
--
-- Idempotente: pode rodar quantas vezes precisar (pnpm db:rls).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create or replace function public.current_app_role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role_app', ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb -> 'user_metadata' ->> 'role', ''),
    'anon'
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable as $$
  select public.current_app_role() = 'admin';
$$;

create or replace function public.is_agent() returns boolean
language sql stable as $$
  select public.current_app_role() in ('admin', 'agent');
$$;

-- -----------------------------------------------------------------------------
-- Habilitar e forçar RLS
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'contacts',
    'conversations',
    'messages',
    'conversation_state',
    'ai_runs',
    'usage_counters',
    'job_failures',
    'hubspot_outbox'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Políticas
--
-- Leitura de dado pessoal: atendente e admin.
-- Escrita: só admin via console; o pipeline escreve com service role.
-- -----------------------------------------------------------------------------

drop policy if exists "contacts_read_agent" on public.contacts;
create policy "contacts_read_agent" on public.contacts
  for select using (public.is_agent());

drop policy if exists "contacts_write_admin" on public.contacts;
create policy "contacts_write_admin" on public.contacts
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "conversations_read_agent" on public.conversations;
create policy "conversations_read_agent" on public.conversations
  for select using (public.is_agent());

-- Atendente pode assumir e encerrar conversa (handoff); demais colunas ficam
-- por conta do console admin.
drop policy if exists "conversations_update_agent" on public.conversations;
create policy "conversations_update_agent" on public.conversations
  for update using (public.is_agent()) with check (public.is_agent());

drop policy if exists "conversations_write_admin" on public.conversations;
create policy "conversations_write_admin" on public.conversations
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "messages_read_agent" on public.messages;
create policy "messages_read_agent" on public.messages
  for select using (public.is_agent());

drop policy if exists "messages_write_admin" on public.messages;
create policy "messages_write_admin" on public.messages
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "conversation_state_read_agent" on public.conversation_state;
create policy "conversation_state_read_agent" on public.conversation_state
  for select using (public.is_agent());

drop policy if exists "conversation_state_write_admin" on public.conversation_state;
create policy "conversation_state_write_admin" on public.conversation_state
  for all using (public.is_admin()) with check (public.is_admin());

-- Telemetria e operação: admin apenas.
drop policy if exists "ai_runs_admin" on public.ai_runs;
create policy "ai_runs_admin" on public.ai_runs
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "usage_counters_admin" on public.usage_counters;
create policy "usage_counters_admin" on public.usage_counters
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "job_failures_admin" on public.job_failures;
create policy "job_failures_admin" on public.job_failures
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "hubspot_outbox_admin" on public.hubspot_outbox;
create policy "hubspot_outbox_admin" on public.hubspot_outbox
  for all using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Retenção (LGPD, CLAUDE.md §13)
--
-- Anonimiza o conteúdo de conversas antigas mantendo a métrica agregada.
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
-- (banco local, CI): revoga só o que existe, para o arquivo rodar em qualquer um.
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

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

revoke all on function public.anonymize_old_messages(interval) from public, anon, authenticated;

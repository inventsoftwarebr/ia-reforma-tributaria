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

-- =============================================================================
-- Verifica que o banco criado por db/bootstrap.sql está como o código espera.
-- Roda no CI contra um Postgres descartável (ver .github/workflows/ci.yml) e
-- pode rodar contra qualquer banco recém-criado.
--
-- Falha com `raise exception` no primeiro problema encontrado.
-- =============================================================================

\set ON_ERROR_STOP on

do $$
declare
  esperado text[] := array[
    'contacts', 'conversations', 'messages', 'conversation_state',
    'ai_runs', 'usage_counters', 'job_failures', 'hubspot_outbox'
  ];
  nome text;
  total integer;
begin
  -- 1. Todas as tabelas existem, com RLS habilitado E forçado (CLAUDE.md §10).
  foreach nome in array esperado
  loop
    if not exists (
      select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = nome and c.relkind = 'r'
    ) then
      raise exception 'tabela ausente: %', nome;
    end if;

    if not (
      select c.relrowsecurity and c.relforcerowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = nome
    ) then
      raise exception 'RLS não habilitado/forçado em %', nome;
    end if;

    select count(*) into total from pg_policies
     where schemaname = 'public' and tablename = nome;
    if total = 0 then
      raise exception 'nenhuma política RLS em % (default deny sem política = tabela inútil)', nome;
    end if;
  end loop;

  -- 2. Helpers de RLS existem.
  foreach nome in array array['is_admin', 'is_agent', 'current_app_role', 'anonymize_old_messages']
  loop
    if not exists (
      select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = nome
    ) then
      raise exception 'função ausente: %', nome;
    end if;
  end loop;

  -- 3. Controle de migrations preenchido, para pnpm db:migrate não reaplicar.
  select count(*) into total from drizzle.__drizzle_migrations;
  if total = 0 then
    raise exception 'drizzle.__drizzle_migrations vazio: db:migrate tentaria reaplicar a migration';
  end if;
end $$;

-- 4. Idempotência de mensagem: o mesmo provider_message_id não entra duas vezes.
--    É a garantia de que reentrega de webhook não gera segunda resposta.
insert into contacts (wa_jid, phone_e164) values ('5562999998888@s.whatsapp.net', '+5562999998888');

insert into conversations (contact_id)
select id from contacts where wa_jid = '5562999998888@s.whatsapp.net';

insert into messages (conversation_id, contact_id, direction, provider, provider_message_id, kind, body)
select c.id, c.contact_id, 'inbound', 'evolution', 'DUP-1', 'text', 'primeira'
  from conversations c
on conflict (provider, provider_message_id) do nothing;

insert into messages (conversation_id, contact_id, direction, provider, provider_message_id, kind, body)
select c.id, c.contact_id, 'inbound', 'evolution', 'DUP-1', 'text', 'reentrega'
  from conversations c
on conflict (provider, provider_message_id) do nothing;

do $$
declare
  total integer;
begin
  select count(*) into total from messages where provider_message_id = 'DUP-1';
  if total <> 1 then
    raise exception 'idempotência furada: % linhas para o mesmo provider_message_id', total;
  end if;
end $$;

-- 5. Saída pode repetir provider_message_id nulo (várias mensagens enviadas).
insert into messages (conversation_id, contact_id, direction, provider, kind, body)
select c.id, c.contact_id, 'outbound', 'evolution', 'text', 'bloco 1' from conversations c;
insert into messages (conversation_id, contact_id, direction, provider, kind, body)
select c.id, c.contact_id, 'outbound', 'evolution', 'text', 'bloco 2' from conversations c;

do $$
declare
  total integer;
begin
  select count(*) into total from messages where direction = 'outbound';
  if total <> 2 then
    raise exception 'esperava 2 mensagens de saída, veio %', total;
  end if;
end $$;

-- 6. Contador diário é único por contato/dia.
insert into usage_counters (contact_id, day, messages)
select id, current_date, 1 from contacts
on conflict (contact_id, day) do update set messages = usage_counters.messages + 1;
insert into usage_counters (contact_id, day, messages)
select id, current_date, 1 from contacts
on conflict (contact_id, day) do update set messages = usage_counters.messages + 1;

do $$
declare
  total integer;
begin
  select messages into total from usage_counters limit 1;
  if total <> 2 then
    raise exception 'contador diário não acumulou: %', total;
  end if;
end $$;

-- Limpa o que foi inserido para o banco ficar vazio no fim da verificação.
delete from contacts where wa_jid = '5562999998888@s.whatsapp.net';

select 'bootstrap verificado' as resultado;

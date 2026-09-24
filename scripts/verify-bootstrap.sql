-- =============================================================================
-- Verifica que o banco criado por db/bootstrap.sql está como o código espera.
-- Roda no CI contra um Postgres com pgvector (ver .github/workflows/ci.yml).
-- Falha com `raise exception` no primeiro problema.
-- =============================================================================

\set ON_ERROR_STOP on

do $$
declare
  esperado text[] := array[
    'profiles', 'contacts', 'conversations', 'messages', 'conversation_state',
    'kb_sources', 'kb_chunks', 'prompt_versions', 'ai_runs', 'usage_counters',
    'job_failures', 'hubspot_outbox'
  ];
  nome text;
  total integer;
begin
  -- 1. Tabelas existem, com RLS habilitado E forçado, e com política.
  foreach nome in array esperado
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = nome and c.relkind = 'r'
    ) then
      raise exception 'tabela ausente: %', nome;
    end if;

    if not (
      select c.relrowsecurity and c.relforcerowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = nome
    ) then
      raise exception 'RLS não habilitado/forçado em %', nome;
    end if;

    select count(*) into total from pg_policies
     where schemaname = 'public' and tablename = nome;
    if total = 0 then
      raise exception 'nenhuma política em % (default deny sem política = tabela inútil)', nome;
    end if;
  end loop;

  -- 2. Funções de apoio existem.
  foreach nome in array array[
    'is_admin', 'is_agent', 'app_role', 'auth_uid', 'handle_new_user',
    'anonymize_old_messages', 'kb_search'
  ]
  loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = nome
    ) then
      raise exception 'função ausente: %', nome;
    end if;
  end loop;

  -- 3. Índices da base de conhecimento (vetorial e textual).
  if not exists (select 1 from pg_indexes where indexname = 'kb_chunks_embedding_idx') then
    raise exception 'índice vetorial kb_chunks_embedding_idx ausente';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'kb_chunks_tsv_idx') then
    raise exception 'índice textual kb_chunks_tsv_idx ausente';
  end if;

  -- 4. Controle de migration preenchido, para db:migrate não reaplicar.
  select count(*) into total from drizzle.__drizzle_migrations;
  if total = 0 then
    raise exception 'drizzle.__drizzle_migrations vazio: db:migrate reaplicaria a migration';
  end if;
end $$;

-- 5. Idempotência: o mesmo provider_message_id não entra duas vezes.
insert into contacts (wa_jid, phone_e164) values ('5562999998888@s.whatsapp.net', '+5562999998888');
insert into conversations (contact_id) select id from contacts where wa_jid = '5562999998888@s.whatsapp.net';

insert into messages (conversation_id, contact_id, direction, provider, provider_message_id, kind, body)
select c.id, c.contact_id, 'inbound', 'evolution', 'DUP-1', 'text', 'primeira' from conversations c
on conflict (provider, provider_message_id) do nothing;

insert into messages (conversation_id, contact_id, direction, provider, provider_message_id, kind, body)
select c.id, c.contact_id, 'inbound', 'evolution', 'DUP-1', 'text', 'reentrega' from conversations c
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

-- 6. Busca na base: com vigência aberta acha; fora da vigência não acha.
insert into kb_sources (slug, title, citation_label, kind, authority, checksum, effective_from)
values ('teste-vigente', 'Norma de teste', 'LC 999/2025', 'lei_complementar', 'oficial', 'abc', '2025-01-01');

insert into kb_sources (slug, title, citation_label, kind, authority, checksum, effective_from, effective_to)
values ('teste-revogado', 'Norma revogada', 'LC 998/2020', 'lei_complementar', 'oficial', 'def', '2020-01-01', '2024-12-31');

insert into kb_chunks (source_id, ord, heading, content, embedding)
select id, 0, 'art. 1º', 'A CBS substitui a contribuição sobre receita.',
       array_fill(0.01::real, array[1536])::vector
  from kb_sources where slug = 'teste-vigente';

insert into kb_chunks (source_id, ord, heading, content, embedding)
select id, 0, 'art. 1º', 'A CBS substitui a contribuição sobre receita.',
       array_fill(0.01::real, array[1536])::vector
  from kb_sources where slug = 'teste-revogado';

do $$
declare
  total integer;
  rotulo text;
begin
  select count(*) into total
    from public.kb_search(array_fill(0.01::real, array[1536])::vector, 'CBS contribuição', 8, '2026-01-01'::date);
  if total <> 1 then
    raise exception 'kb_search devolveu % trechos; esperava 1 (o revogado tem que ficar fora)', total;
  end if;

  select citation_label into rotulo
    from public.kb_search(array_fill(0.01::real, array[1536])::vector, 'CBS contribuição', 8, '2026-01-01'::date);
  if rotulo <> 'LC 999/2025' then
    raise exception 'kb_search devolveu a fonte errada: %', rotulo;
  end if;

  -- Busca só textual, sem match vetorial útil, ainda tem que achar pelo termo.
  select count(*) into total
    from public.kb_search(array_fill(0.99::real, array[1536])::vector, 'substitui contribuição receita', 8, '2026-01-01'::date);
  if total < 1 then
    raise exception 'busca textual não achou o trecho';
  end if;
end $$;

-- Limpa o que foi inserido.
delete from contacts where wa_jid = '5562999998888@s.whatsapp.net';
delete from kb_sources where slug in ('teste-vigente', 'teste-revogado');

select 'bootstrap verificado' as resultado;

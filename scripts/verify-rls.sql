-- =============================================================================
-- Exercita as políticas de RLS de verdade, não só a existência delas.
--
-- Simula o que o Supabase faz numa requisição pela API: troca para um papel
-- sem BYPASSRLS e injeta o JWT em request.jwt.claims. Pré-requisito: o banco
-- foi criado com um schema `auth.users` presente (o CI cria um falso), para o
-- gatilho de perfil existir.
-- =============================================================================

\set ON_ERROR_STOP on

-- Papel equivalente ao `authenticated` do Supabase: sem BYPASSRLS, sem ser dono.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'rls_probe') then
    create role rls_probe nologin nobypassrls;
  end if;
end $$;
grant usage on schema public to rls_probe;
grant select, insert, update, delete on all tables in schema public to rls_probe;
grant execute on all functions in schema public to rls_probe;

-- 1. Login gera perfil, com papel padrão `agent`.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@teste.invent', '{"full_name":"Admin Teste"}'),
  ('00000000-0000-0000-0000-00000000000b', 'atendente@teste.invent', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'curioso@teste.invent', '{}');

do $$
declare
  papel text;
  nome text;
begin
  select role::text, full_name into papel, nome
    from public.profiles where id = '00000000-0000-0000-0000-00000000000a';
  if papel is distinct from 'agent' then
    raise exception 'gatilho não criou o perfil com papel agent (veio %)', papel;
  end if;
  if nome is distinct from 'Admin Teste' then
    raise exception 'gatilho não copiou o nome do metadata (veio %)', nome;
  end if;
end $$;

update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000a';
-- O "curioso" não tem perfil de atendimento: removemos para simular conta
-- autenticada sem acesso ao console.
delete from public.profiles where id = '00000000-0000-0000-0000-00000000000c';

-- Dado pessoal que só o atendimento pode ver.
insert into public.contacts (wa_jid, phone_e164) values ('5562988887777@s.whatsapp.net', '+5562988887777');

-- 2. Sem JWT (anônimo): não vê nada, não grava nada.
set role rls_probe;
select set_config('request.jwt.claims', '', false);

do $$
declare
  total integer;
begin
  select count(*) into total from public.contacts;
  if total <> 0 then
    raise exception 'anônimo enxergou % contato(s): RLS furado', total;
  end if;

  begin
    insert into public.contacts (wa_jid, phone_e164) values ('5562900000000@s.whatsapp.net', '+5562900000000');
    raise exception 'anônimo conseguiu gravar contato: RLS furado';
  exception when insufficient_privilege then
    null; -- esperado: violação de política
  end;
end $$;

-- 3. Autenticado sem perfil de atendimento: também não vê.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', false);

do $$
declare
  total integer;
begin
  select count(*) into total from public.contacts;
  if total <> 0 then
    raise exception 'usuário sem perfil enxergou % contato(s)', total;
  end if;
end $$;

-- 4. Atendente: lê, mas não altera a base de conhecimento.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b"}', false);

do $$
declare
  total integer;
begin
  select count(*) into total from public.contacts;
  if total <> 1 then
    raise exception 'atendente deveria ver 1 contato, viu %', total;
  end if;

  begin
    insert into public.kb_sources (slug, title, citation_label, kind, authority, checksum)
    values ('nao-pode', 'x', 'LC 1/2000', 'lei', 'oficial', 'x');
    raise exception 'atendente conseguiu alterar a base de conhecimento';
  exception when insufficient_privilege then
    null; -- esperado: curadoria é só admin
  end;

  -- Atendente vê só o próprio perfil e o dos colegas, não altera papel de ninguém.
  update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000b';
  if (select role::text from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'admin' then
    raise exception 'atendente conseguiu se promover a admin';
  end if;
end $$;

-- 5. Admin: lê e faz curadoria.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', false);

do $$
declare
  total integer;
begin
  select count(*) into total from public.contacts;
  if total <> 1 then
    raise exception 'admin deveria ver 1 contato, viu %', total;
  end if;

  insert into public.kb_sources (slug, title, citation_label, kind, authority, checksum)
  values ('admin-pode', 'x', 'LC 1/2000', 'lei', 'oficial', 'x');
end $$;

reset role;
select set_config('request.jwt.claims', '', false);

-- Limpeza.
delete from public.kb_sources where slug = 'admin-pode';
delete from public.contacts where wa_jid = '5562988887777@s.whatsapp.net';
delete from auth.users where email like '%@teste.invent';
delete from public.profiles where email like '%@teste.invent';

select 'rls verificado' as resultado;

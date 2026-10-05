-- =============================================================================
-- Conferência do banco, para rodar no SQL Editor do Supabase depois do
-- bootstrap.sql. Só leitura: não grava nada.
--
-- Toda linha deve sair com ok = sim. Qualquer "NÃO" diz exatamente o que faltou.
-- =============================================================================

with
esperadas(nome) as (
  values ('profiles'), ('contacts'), ('conversations'), ('messages'),
         ('conversation_state'), ('kb_sources'), ('kb_chunks'), ('prompt_versions'),
         ('ai_runs'), ('usage_counters'), ('job_failures'), ('hubspot_outbox')
),
tabelas as (
  select e.nome, c.relrowsecurity as rls, c.relforcerowsecurity as forcado,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = e.nome) as politicas
    from esperadas e
    left join pg_class c
      on c.relname = e.nome
     and c.relkind = 'r'
     and c.relnamespace = 'public'::regnamespace
),
funcoes(nome) as (
  values ('kb_search'), ('is_admin'), ('is_agent'), ('app_role'), ('auth_uid'),
         ('handle_new_user'), ('anonymize_old_messages')
),
checagens(ordem, verificacao, resultado, ok) as (
  select 1, 'tabelas criadas',
         (select count(*) from tabelas where rls is not null) || ' de 12',
         (select count(*) from tabelas where rls is not null) = 12

  union all
  select 2, 'segurança de linha (RLS) ligada e forçada',
         (select count(*) from tabelas where rls and forcado) || ' de 12',
         (select count(*) from tabelas where rls and forcado) = 12

  union all
  select 3, 'tabelas sem política de acesso',
         coalesce((select string_agg(nome, ', ') from tabelas where politicas = 0), 'nenhuma'),
         not exists (select 1 from tabelas where politicas = 0)

  union all
  select 4, 'pgvector (busca na base)',
         coalesce((select 'versão ' || extversion from pg_extension where extname = 'vector'),
                  'não instalado'),
         exists (select 1 from pg_extension where extname = 'vector')

  union all
  select 5, 'funções do banco',
         (select count(*) from funcoes f
           where exists (select 1 from pg_proc p
                          where p.proname = f.nome
                            and p.pronamespace = 'public'::regnamespace)) || ' de 7',
         (select count(*) from funcoes f
           where exists (select 1 from pg_proc p
                          where p.proname = f.nome
                            and p.pronamespace = 'public'::regnamespace)) = 7

  union all
  select 6, 'índices da base (vetorial e textual)',
         (select count(*) from pg_indexes
           where indexname in ('kb_chunks_embedding_idx', 'kb_chunks_tsv_idx')) || ' de 2',
         (select count(*) from pg_indexes
           where indexname in ('kb_chunks_embedding_idx', 'kb_chunks_tsv_idx')) = 2

  union all
  select 7, 'perfil criado no primeiro login',
         case when exists (select 1 from pg_trigger where tgname = 'on_auth_user_created')
              then 'gatilho presente' else 'gatilho ausente' end,
         exists (select 1 from pg_trigger where tgname = 'on_auth_user_created')

  union all
  select 8, 'migration registrada',
         coalesce((select count(*)::text from drizzle.__drizzle_migrations), '0'),
         coalesce((select count(*) from drizzle.__drizzle_migrations), 0) >= 1

  -- A aplicação conecta como este mesmo papel. Sem BYPASSRLS, com RLS forçado,
  -- toda leitura do pipeline volta vazia e toda escrita é recusada.
  union all
  select 9, 'papel da conexão (' || current_user || ') atravessa o RLS',
         case when (select rolbypassrls or rolsuper from pg_roles where rolname = current_user)
              then 'sim' else 'não' end,
         (select rolbypassrls or rolsuper from pg_roles where rolname = current_user)
)
select verificacao,
       resultado,
       case when ok then 'sim' else 'NÃO' end as ok
  from checagens
 order by ordem;

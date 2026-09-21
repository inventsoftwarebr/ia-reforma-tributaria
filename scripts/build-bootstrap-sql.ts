import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Gera db/bootstrap.sql: um único arquivo para colar no SQL Editor do Supabase
 * e deixar o banco pronto, sem precisar de Node na máquina de quem aplica.
 *
 * Inclui a linha de controle do drizzle (schema `drizzle`, tabela
 * `__drizzle_migrations`) com o MESMO hash e timestamp que o `drizzle-kit`
 * usaria, para que `pnpm db:migrate` depois não tente reaplicar a migration.
 * O hash é sha256 do conteúdo do arquivo .sql — ver drizzle-orm/migrator.js.
 *
 * Rode `pnpm db:bootstrap-sql` sempre que gerar uma migration nova.
 */

interface Journal {
  entries: { tag: string; when: number; breakpoints: boolean }[];
}

const journal = JSON.parse(
  readFileSync("db/migrations/meta/_journal.json", "utf8"),
) as Journal;

const parts: string[] = [
  `-- =============================================================================
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
);`,
];

for (const entry of journal.entries) {
  const file = `db/migrations/${entry.tag}.sql`;
  const query = readFileSync(file, "utf8");
  const hash = createHash("sha256").update(query).digest("hex");

  parts.push(`-- -----------------------------------------------------------------------------
-- migration ${entry.tag}
-- -----------------------------------------------------------------------------
${query.trim()}

insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
values ('${hash}', ${entry.when});`);
}

parts.push(`-- -----------------------------------------------------------------------------
-- Políticas RLS (db/rls.sql) — idempotente, pode rodar de novo quando mudar.
-- -----------------------------------------------------------------------------
${readFileSync("db/rls.sql", "utf8").trim()}`);

writeFileSync("db/bootstrap.sql", `${parts.join("\n\n")}\n`);

process.stdout.write(
  `db/bootstrap.sql gerado com ${journal.entries.length} migration(s).\n`,
);

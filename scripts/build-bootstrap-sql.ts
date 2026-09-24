import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Gera db/bootstrap.sql: um arquivo para colar no SQL Editor do Supabase e
 * deixar o banco pronto, sem precisar de Node na máquina de quem aplica.
 *
 * Ordem: extensões → migration → controle do drizzle → funções e índices →
 * políticas de segurança.
 *
 * A linha de controle usa o MESMO hash e timestamp que o `drizzle-kit` usaria
 * (sha256 do conteúdo do .sql — ver drizzle-orm/migrator.js), para que
 * `pnpm db:migrate` depois não tente reaplicar a migration.
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
end $$;`,

  `-- -----------------------------------------------------------------------------
-- Extensões (db/extensions.sql)
-- -----------------------------------------------------------------------------
${readFileSync("db/extensions.sql", "utf8").trim()}`,

  `-- Controle de migrations do drizzle.
create schema if not exists "drizzle";
create table if not exists "drizzle"."__drizzle_migrations" (
  id serial primary key,
  hash text not null,
  created_at bigint
);`,
];

for (const entry of journal.entries) {
  const query = readFileSync(`db/migrations/${entry.tag}.sql`, "utf8");
  const hash = createHash("sha256").update(query).digest("hex");

  parts.push(`-- -----------------------------------------------------------------------------
-- migration ${entry.tag}
-- -----------------------------------------------------------------------------
${query.trim()}

insert into "drizzle"."__drizzle_migrations" ("hash", "created_at")
values ('${hash}', ${entry.when});`);
}

for (const file of ["functions.sql", "rls.sql"] as const) {
  parts.push(`-- -----------------------------------------------------------------------------
-- db/${file} — idempotente, roda de novo com pnpm db:sql
-- -----------------------------------------------------------------------------
${readFileSync(`db/${file}`, "utf8").trim()}`);
}

writeFileSync("db/bootstrap.sql", `${parts.join("\n\n")}\n`);

process.stdout.write(`db/bootstrap.sql gerado com ${journal.entries.length} migration(s).\n`);

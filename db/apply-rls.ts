import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

/**
 * Aplica db/rls.sql. Idempotente — rodar depois de toda migration.
 * Regra: política no mesmo commit que cria ou altera tabela. CLAUDE.md §10.
 */
async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL (ou DATABASE_URL) não está setado.");

  const sql = readFileSync(new URL("./rls.sql", import.meta.url), "utf8");
  const client = postgres(url, { max: 1 });
  await client.unsafe(sql);
  await client.end();
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  throw error;
});

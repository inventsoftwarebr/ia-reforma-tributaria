import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

/**
 * Aplica os arquivos SQL idempotentes, na ordem que importa:
 * extensões → funções e índices → políticas de segurança.
 *
 * Rodar depois de toda migration. Roda fora de serverless, então usa DIRECT_URL.
 */
const FILES = ["extensions.sql", "functions.sql", "rls.sql"] as const;

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL (ou DATABASE_URL) não está setado.");

  const client = postgres(url, { max: 1 });
  try {
    for (const file of FILES) {
      const sql = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      await client.unsafe(sql);
      process.stdout.write(`aplicado: db/${file}\n`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  throw error;
});

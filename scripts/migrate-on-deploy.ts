import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Aplica as migrations pendentes no build da Vercel, antes do `next build`.
 *
 * Sem isso, toda mudança de schema exigiria alguém colar SQL no Supabase antes
 * do deploy — e o código novo subiria contra um banco antigo. Aqui, se a
 * migration falhar, o build falha e a versão anterior continua no ar.
 *
 * Só altera schema de forma aditiva (colunas novas, tabelas novas): migration
 * destrutiva precisa de plano próprio, não deste passo automático.
 *
 * Fora da Vercel (máquina local, CI) não faz nada.
 */
async function main() {
  if (process.env.VERCEL !== "1") {
    process.stdout.write("migrate-on-deploy: fora da Vercel, nada a fazer\n");
    return;
  }

  // DIRECT_URL (sessão, 5432) se existir; senão o pooler em transaction mode,
  // que aceita DDL dentro de uma transação desde que sem prepared statements.
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não está configurada na Vercel.");

  const client = postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 15,
    onnotice: () => undefined,
  });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./db/migrations" });
    process.stdout.write("migrate-on-deploy: banco em dia com as migrations\n");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `migrate-on-deploy: falhou — ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

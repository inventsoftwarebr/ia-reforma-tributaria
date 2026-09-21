import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Aplica as migrations. Roda fora de serverless, então usa DIRECT_URL (5432).
 */
async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL (ou DATABASE_URL) não está setado.");

  const client = postgres(url, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder: "./db/migrations" });
  await client.end();
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  throw error;
});

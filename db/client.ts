import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

/**
 * Drizzle client para código server-side. Conecta via Supavisor TRANSACTION
 * mode (porta 6543) — nunca 5432 em serverless. Ver CLAUDE.md §9.
 *
 * - max: 1         → uma conexão por instância serverless
 * - prepare: false → PgBouncer em transaction mode não suporta prepared statements
 *
 * Lazy: só conecta no primeiro query, para o build não quebrar sem DATABASE_URL.
 */

type DB = PostgresJsDatabase<typeof schema>;

let client: Sql | undefined;
let database: DB | undefined;

function getDb(): DB {
  if (database) return database;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL não está setado. Use a URL do pooler Supabase (porta 6543).",
    );
  }
  client = postgres(url, { max: 1, prepare: false });
  database = drizzle(client, { schema });
  return database;
}

export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const real = getDb();
    const value = real[prop as keyof DB];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export type { DB };

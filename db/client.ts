import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { validateDatabaseUrl } from "../lib/db-url";
import * as schema from "./schema";

/**
 * Drizzle client para código server-side. Conecta via Supavisor TRANSACTION
 * mode (porta 6543) — nunca 5432 em serverless. Ver CLAUDE.md §9.
 *
 * - max: 1         → uma conexão por instância serverless
 * - prepare: false → PgBouncer em transaction mode não suporta prepared statements
 * - max_pipeline: 0 → uma consulta por vez na conexão. Por padrão o postgres-js
 *   envia várias juntas (pipelining) quando a página consulta em paralelo, e o
 *   Supavisor em transaction mode pode nunca responder — o painel ficava
 *   "carregando" para sempre enquanto as mesmas consultas, uma a uma, levavam
 *   1,5s. Ver CONNECTION_OPTIONS e lib/admin/diagnose.ts.
 *
 * Lazy: só conecta no primeiro query, para o build não quebrar sem DATABASE_URL.
 */

type DB = PostgresJsDatabase<typeof schema>;

export const CONNECTION_OPTIONS = {
  max: 1,
  prepare: false,
  max_pipeline: 0,
  connect_timeout: 10,
} as const;

let client: Sql | undefined;
let database: DB | undefined;

function getDb(): DB {
  if (database) return database;
  const url = process.env.DATABASE_URL;
  const problem = validateDatabaseUrl(url);
  if (problem || !url) throw new Error(problem ?? "DATABASE_URL ausente.");
  // connect_timeout: banco inalcançável vira erro visível em 10s. O padrão do
  // postgres-js é 30s, e somado a retentativas parecia uma tela travada.
  client = postgres(url, CONNECTION_OPTIONS);
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

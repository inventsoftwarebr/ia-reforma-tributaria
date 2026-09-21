import { defineConfig } from "drizzle-kit";
import "dotenv/config";

/**
 * drizzle-kit roda fora de serverless, então usa DIRECT_URL (porta 5432).
 * O runtime da aplicação usa DATABASE_URL (pooler, 6543). Ver CLAUDE.md §9.
 */
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DIRECT_URL ?? "" },
  strict: true,
  verbose: true,
});

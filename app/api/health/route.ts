import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { serverEnv } from "@/lib/env";
import { checkAuth, describeDatabaseError } from "@/lib/health";
import { logError } from "@/lib/observability/logger";
import { withTimeout } from "@/lib/timeout";

/**
 * Diagnóstico para quem configura o sistema: abrir no navegador e ler.
 * Não expõe valor de variável nem mensagem crua de erro — só o que falta e a
 * causa provável.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let variaveis = "ok";
  try {
    serverEnv();
  } catch (error) {
    variaveis = error instanceof Error ? error.message.replace(/^Variáveis de ambiente inválidas — /, "") : "inválidas";
  }

  const login = checkAuth(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  let banco = "ok";
  let tabelas = "ok";
  try {
    await withTimeout(db.execute(sql`select 1`), 12_000, "banco");
    try {
      await withTimeout(db.execute(sql`select 1 from public.profiles limit 1`), 12_000, "banco");
    } catch (error) {
      tabelas = describeDatabaseError(error);
    }
  } catch (error) {
    logError("health.database", error);
    banco = describeDatabaseError(error);
    tabelas = "não verificado";
  }

  const auth = await login;
  const ok = variaveis === "ok" && banco === "ok" && tabelas === "ok" && auth === "ok";
  // Versão publicada: confirma se a Vercel já está rodando a última correção.
  const versao = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";
  return NextResponse.json(
    { ok, versao, variaveis, banco, tabelas, login: auth },
    { status: ok ? 200 : 503 },
  );
}

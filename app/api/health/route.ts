import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { diagnoseSession } from "@/lib/admin/diagnose";
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
// Com sessão, refaz o caminho do painel (até ~1 min no pior caso).
export const maxDuration = 90;

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
  let bancoMs = 0;
  try {
    const inicio = Date.now();
    await withTimeout(db.execute(sql`select 1`), 12_000, "banco");
    bancoMs = Date.now() - inicio;
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
  // Região da função: longe da região do Supabase, cada consulta paga a viagem.
  const regiao = process.env.VERCEL_REGION ?? "local";

  let sessao: Record<string, string> = { usuario: "não verificado — o banco ou as variáveis falharam" };
  if (ok) {
    try {
      sessao = await diagnoseSession();
    } catch (error) {
      logError("health.session", error);
      sessao = { usuario: describeDatabaseError(error) };
    }
  }

  return NextResponse.json(
    {
      ok,
      versao,
      regiao,
      variaveis,
      banco: banco === "ok" ? `ok (${bancoMs} ms)` : banco,
      tabelas,
      login: auth,
      sessao,
    },
    { status: ok ? 200 : 503 },
  );
}

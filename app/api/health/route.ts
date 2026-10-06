import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { serverEnv } from "@/lib/env";
import { describeDatabaseError } from "@/lib/health";
import { logError } from "@/lib/observability/logger";

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

  let banco = "ok";
  let tabelas = "ok";
  try {
    await db.execute(sql`select 1`);
    try {
      await db.execute(sql`select 1 from public.profiles limit 1`);
    } catch (error) {
      tabelas = describeDatabaseError(error);
    }
  } catch (error) {
    logError("health.database", error);
    banco = describeDatabaseError(error);
    tabelas = "não verificado";
  }

  const ok = variaveis === "ok" && banco === "ok" && tabelas === "ok";
  return NextResponse.json({ ok, variaveis, banco, tabelas }, { status: ok ? 200 : 503 });
}

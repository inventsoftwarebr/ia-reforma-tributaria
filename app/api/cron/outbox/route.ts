import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { serverEnv } from "@/lib/env";
import { checkAuth } from "@/lib/health";
import { drainHubspotOutbox } from "@/lib/hubspot/outbox";
import { EmbeddingBusyError, embedPending } from "@/lib/kb/ingest";
import { checkOfficialSources } from "@/lib/kb/official";
import { logError } from "@/lib/observability/logger";

/**
 * Drena o outbox do HubSpot. Chamado pelo cron da Vercel (ver vercel.json),
 * que envia `Authorization: Bearer $CRON_SECRET`.
 *
 * Sem CRON_SECRET configurado a rota fica fechada: melhor não drenar do que
 * deixar um endpoint que qualquer um dispara.
 *
 * Também é a rotina diária da base de conhecimento: confere os sites oficiais
 * das fontes com atualização automática e termina indexações pendentes.
 *
 * E mantém o Supabase acordado: o plano gratuito pausa o projeto após
 * ~7 dias sem uso, e aí o login do console para de funcionar. Por isso toca o
 * banco e o Auth todo dia, mesmo com o HubSpot desligado.
 */

export const runtime = "nodejs";
// Conferir os sites oficiais e indexar o que mudou pode levar alguns minutos.
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const supabase = await checkAuth(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  const startedAt = Date.now();
  try {
    await db.execute(sql`select 1`);
    const hubspot = await drainHubspotOutbox();

    const fontes = await checkOfficialSources().catch((error: unknown) => {
      logError("cron.kb_check_failed", error);
      return [];
    });

    // O que sobrar de tempo vai para trechos ainda sem embedding.
    let indexacao: { embedded: number; remaining: number } | string;
    try {
      indexacao = await embedPending({ deadline: startedAt + 240_000 });
    } catch (error) {
      indexacao =
        error instanceof EmbeddingBusyError
          ? "limite do Gemini; continua amanhã"
          : "falhou";
      if (!(error instanceof EmbeddingBusyError)) logError("cron.kb_embed_failed", error);
    }

    return NextResponse.json({ ok: true, supabase, ...hubspot, fontes, indexacao });
  } catch (error) {
    logError("cron.outbox.failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// O cron da Vercel usa GET.
export async function GET(request: Request): Promise<Response> {
  return POST(request);
}

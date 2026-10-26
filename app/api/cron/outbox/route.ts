import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { serverEnv } from "@/lib/env";
import { checkAuth } from "@/lib/health";
import { drainHubspotOutbox } from "@/lib/hubspot/outbox";
import { logError } from "@/lib/observability/logger";

/**
 * Drena o outbox do HubSpot. Chamado pelo cron da Vercel (ver vercel.json),
 * que envia `Authorization: Bearer $CRON_SECRET`.
 *
 * Sem CRON_SECRET configurado a rota fica fechada: melhor não drenar do que
 * deixar um endpoint que qualquer um dispara.
 *
 * Também mantém o Supabase acordado: o plano gratuito pausa o projeto após
 * ~7 dias sem uso, e aí o login do console para de funcionar. Por isso toca o
 * banco e o Auth todo dia, mesmo com o HubSpot desligado.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

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

  try {
    await db.execute(sql`select 1`);
    const result = await drainHubspotOutbox();
    return NextResponse.json({ ok: true, supabase, ...result });
  } catch (error) {
    logError("cron.outbox.failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// O cron da Vercel usa GET.
export async function GET(request: Request): Promise<Response> {
  return POST(request);
}

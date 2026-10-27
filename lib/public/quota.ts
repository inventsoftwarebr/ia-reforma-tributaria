import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { serverEnv } from "@/lib/env";
import { brazilDay } from "@/lib/time";

/**
 * Limite de uso do chat público. Página aberta na internet sem limite vira
 * conta do Gemini sem teto: um robô repetindo pergunta gasta o mês em horas.
 */

/** IP do visitante como a Vercel informa (primeiro da lista). */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "desconhecido";
}

/**
 * Chave do visitante: hash do IP com o dia e um segredo do servidor. Não
 * guarda IP e muda todo dia — dá para limitar sem conseguir seguir a pessoa.
 */
export function visitorKey(ip: string, day: string, secret: string): string {
  return createHash("sha256").update(`${secret}:${day}:${ip}`).digest("hex").slice(0, 32);
}

async function increment(key: string, day: string): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    insert into public.web_usage (key, day, count) values (${key}, ${day}::date, 1)
    on conflict (key, day) do update set count = public.web_usage.count + 1
    returning count
  `);
  return Number(Array.from(rows)[0]?.count ?? 0);
}

export type QuotaResult = { ok: true } | { ok: false; reason: "visitante" | "total" };

/** Conta um uso e diz se ainda está dentro do limite do visitante e do dia. */
export async function consumeQuota(
  headers: Headers,
  kind: "pergunta" | "contato",
): Promise<QuotaResult> {
  const env = serverEnv();
  const day = brazilDay();
  const visitor = visitorKey(clientIp(headers), day, env.EVOLUTION_WEBHOOK_SECRET);

  const perVisitor = kind === "pergunta" ? env.PUBLIC_CHAT_VISITOR_DAILY : 5;
  const used = await increment(`${kind}:${visitor}`, day);
  if (used > perVisitor) return { ok: false, reason: "visitante" };

  if (kind === "pergunta") {
    const total = await increment("pergunta:__total__", day);
    if (total > env.PUBLIC_CHAT_DAILY_LIMIT) return { ok: false, reason: "total" };
  }
  return { ok: true };
}

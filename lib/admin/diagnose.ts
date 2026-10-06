import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { overview, refusalsByReason } from "@/lib/admin/queries";
import { describeDatabaseError } from "@/lib/health";
import { outboxSummary } from "@/lib/hubspot/outbox";
import { createClient } from "@/lib/supabase/server";
import { TimeoutError, withTimeout } from "@/lib/timeout";

/**
 * Refaz, com cronômetro, o caminho que o servidor percorre para abrir o painel
 * (app/admin/layout.tsx + page.tsx), usando a sessão de quem abriu o
 * /api/health. Mostra só etapa, tempo e se deu certo — nenhum dado do painel.
 */

export type StepResult =
  { ok: true; ms: number; value: unknown } | { ok: false; ms: number; erro: string };

export async function timedStep<T>(
  run: () => PromiseLike<T>,
  limitMs: number,
  label: string,
): Promise<StepResult> {
  const start = Date.now();
  try {
    const value = await withTimeout(run(), limitMs, label);
    return { ok: true, ms: Date.now() - start, value };
  } catch (error) {
    const erro =
      error instanceof TimeoutError
        ? `não respondeu em ${limitMs / 1000}s`
        : describeDatabaseError(error);
    return { ok: false, ms: Date.now() - start, erro };
  }
}

export function formatStep(step: StepResult, okText = "ok"): string {
  return step.ok ? `${okText} (${step.ms} ms)` : `${step.erro} (${step.ms} ms)`;
}

export async function diagnoseSession(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const usuario = await timedStep(() => supabase.auth.getUser(), 8_000, "auth");
  if (!usuario.ok) return { usuario: formatStep(usuario) };

  const user = (usuario.value as Awaited<ReturnType<typeof supabase.auth.getUser>>).data
    .user;
  if (!user) {
    return {
      usuario:
        "sem sessão — entre em /entrar nesta mesma janela e abra o /api/health de novo",
    };
  }

  const resultado: Record<string, string> = { usuario: formatStep(usuario, "logado") };

  const perfil = await timedStep(
    () =>
      db
        .select({ role: profiles.role })
        .from(profiles)
        .where(eq(profiles.id, user.id))
        .limit(1),
    12_000,
    "banco",
  );
  if (!perfil.ok) return { ...resultado, perfil: formatStep(perfil) };
  const [linha] = perfil.value as { role: string }[];
  resultado.perfil = formatStep(perfil, linha ? linha.role : "não encontrado");
  if (!linha) return resultado;

  // Em sequência, não em paralelo: o objetivo é saber qual etapa demora.
  resultado.painel_resumo = formatStep(
    await timedStep(() => overview(), 15_000, "banco"),
  );
  resultado.painel_recusas = formatStep(
    await timedStep(() => refusalsByReason(), 15_000, "banco"),
  );
  resultado.painel_hubspot = formatStep(
    await timedStep(() => outboxSummary(), 15_000, "banco"),
  );
  return resultado;
}

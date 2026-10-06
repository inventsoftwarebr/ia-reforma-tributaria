"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations, jobFailures, kbSources, promptVersions } from "@/db/schema";
import { appUrl, serverEnv } from "@/lib/env";
import { logInfo } from "@/lib/observability/logger";
import { configProblem, configureWebhook, webhookCheck } from "@/lib/whatsapp/evolution-admin";
import { evolutionConfig, webhookTarget } from "@/lib/whatsapp/status";
import { requireAdmin, requireAgent } from "./auth";

/**
 * Server Actions do console. Cada uma revalida o papel: o guard da página não
 * protege a action, que é um endpoint próprio.
 */

/** Pausa o bot na conversa (humano assumiu) ou devolve o atendimento a ele. */
export async function setConversationStatus(
  conversationId: string,
  status: "active" | "handoff" | "closed",
): Promise<void> {
  const user = await requireAgent();

  await db
    .update(conversations)
    .set({
      status,
      assignedTo: status === "handoff" ? user.id : null,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));

  logInfo("admin.conversation_status", { conversationId, status, by: user.id });
  revalidatePath(`/admin/conversas/${conversationId}`);
  revalidatePath("/admin/conversas");
}

/** Ativa uma versão do prompt e desativa as outras da mesma chave. */
export async function activatePromptVersion(id: string): Promise<void> {
  const user = await requireAdmin();

  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ key: promptVersions.key, version: promptVersions.version })
      .from(promptVersions)
      .where(eq(promptVersions.id, id))
      .limit(1);

    if (!target) throw new Error("versão de prompt não encontrada");

    await tx
      .update(promptVersions)
      .set({ active: false })
      .where(eq(promptVersions.key, target.key));

    await tx.update(promptVersions).set({ active: true }).where(eq(promptVersions.id, id));

    logInfo("admin.prompt_activated", {
      key: target.key,
      version: target.version,
      by: user.id,
    });
  });

  revalidatePath("/admin/prompt");
}

/** Arquiva uma fonte: sai do retrieval sem perder o histórico do que citou. */
export async function setSourceStatus(
  id: string,
  status: "active" | "archived",
): Promise<void> {
  const user = await requireAdmin();

  await db
    .update(kbSources)
    .set({ status, updatedAt: new Date() })
    .where(eq(kbSources.id, id));

  logInfo("admin.source_status", { id, status, by: user.id });
  revalidatePath("/admin/base");
}

/** Marca a fonte como revisada pelo time fiscal. */
export async function markSourceReviewed(id: string, reviewer: string): Promise<void> {
  const user = await requireAdmin();
  const name = reviewer.trim();
  if (!name) throw new Error("informe quem revisou");

  await db
    .update(kbSources)
    .set({ reviewedBy: name, reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(kbSources.id, id));

  logInfo("admin.source_reviewed", { id, reviewer: name, by: user.id });
  revalidatePath("/admin/base");
}

export async function resolveJobFailure(id: string): Promise<void> {
  const user = await requireAdmin();

  await db
    .update(jobFailures)
    .set({ resolvedAt: new Date() })
    .where(eq(jobFailures.id, id));

  logInfo("admin.failure_resolved", { id, by: user.id });
  revalidatePath("/admin");
}

/**
 * Aponta o webhook da instância Evolution para este site, com o segredo. Volta
 * para a página com o resultado na URL (sem segredo nenhum).
 */
export async function configureWhatsAppWebhook(formData: FormData): Promise<never> {
  const user = await requireAdmin();
  const destino = webhookTarget();

  let resultado: { ok: boolean; text: string };
  // Confirmação conferida no servidor: a troca desliga o destino anterior (o
  // n8n, no número oficial) e não pode acontecer por clique acidental.
  if (formData.get("confirmo") !== "sim") {
    resultado = { ok: false, text: "marque a confirmação antes de configurar" };
  } else if (!destino.ok || !destino.url) {
    resultado = destino;
  } else {
    const config = evolutionConfig();
    const problema = configProblem(config);
    if (problema) {
      resultado = { ok: false, text: problema };
    } else {
      const gravado = await configureWebhook(config, destino.url);
      // Relê do servidor: confirma que a Evolution guardou o que foi enviado.
      resultado = gravado.ok
        ? await webhookCheck(config, appUrl(), serverEnv().EVOLUTION_WEBHOOK_SECRET)
        : gravado;
    }
  }

  logInfo("admin.whatsapp_webhook", { ok: resultado.ok, by: user.id });
  const query = new URLSearchParams({ resultado: resultado.ok ? "ok" : "erro", msg: resultado.text });
  redirect(`/admin/whatsapp?${query.toString()}`);
}

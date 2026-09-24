import { and, asc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, conversationState, conversations, hubspotOutbox } from "@/db/schema";
import { hubspotEnabled } from "@/lib/env";
import { describeError, logInfo, logWarn } from "@/lib/observability/logger";
import { createDeal, upsertContact } from "./client";

/**
 * Drenagem do outbox.
 *
 * O lead é gravado no banco durante a conversa e enviado depois: se o HubSpot
 * estiver fora, ou o token vencer, nada é perdido — a linha fica pendente e a
 * próxima execução tenta de novo.
 */

const MAX_ATTEMPTS = 5;

export interface DrainResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: boolean;
}

export async function drainHubspotOutbox(limit = 20): Promise<DrainResult> {
  if (!hubspotEnabled()) {
    logWarn("hubspot.disabled", { motivo: "HUBSPOT_PRIVATE_APP_TOKEN ausente" });
    return { processed: 0, sent: 0, failed: 0, skipped: true };
  }

  const pending = await db
    .select({
      id: hubspotOutbox.id,
      conversationId: hubspotOutbox.conversationId,
      eventType: hubspotOutbox.eventType,
      payload: hubspotOutbox.payload,
      attempts: hubspotOutbox.attempts,
    })
    .from(hubspotOutbox)
    .where(
      and(eq(hubspotOutbox.status, "pending"), lt(hubspotOutbox.attempts, MAX_ATTEMPTS)),
    )
    .orderBy(asc(hubspotOutbox.createdAt))
    .limit(limit);

  let sent = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      await deliver(row.conversationId, row.eventType, row.payload as Record<string, unknown>);
      await db
        .update(hubspotOutbox)
        .set({ status: "sent", sentAt: new Date(), attempts: row.attempts + 1 })
        .where(eq(hubspotOutbox.id, row.id));
      sent += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      await db
        .update(hubspotOutbox)
        .set({
          attempts,
          lastError: describeError(error),
          // Esgotadas as tentativas, para de tentar e fica visível no console.
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        })
        .where(eq(hubspotOutbox.id, row.id));
      failed += 1;
      logWarn("hubspot.delivery_failed", { id: row.id, attempts, erro: describeError(error) });
    }
  }

  logInfo("hubspot.drained", { processed: pending.length, sent, failed });
  return { processed: pending.length, sent, failed, skipped: false };
}

async function deliver(
  conversationId: string | null,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!conversationId) throw new Error("evento sem conversa associada");

  const [row] = await db
    .select({
      phoneE164: contacts.phoneE164,
      pushName: contacts.pushName,
      contactRowId: contacts.id,
      hubspotContactId: contacts.hubspotContactId,
      leadSignals: conversationState.leadSignals,
    })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(conversationState, eq(conversationState.conversationId, conversations.id))
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!row) throw new Error(`conversa ${conversationId} não encontrada`);

  const signals = (row.leadSignals ?? {}) as Record<string, string | undefined>;
  const company = typeof payload.empresa === "string" ? payload.empresa : signals.empresa;
  const motivo = typeof payload.motivo === "string" ? payload.motivo : undefined;

  const contactId = await upsertContact({
    phoneE164: row.phoneE164,
    firstName: row.pushName ?? undefined,
    company,
  });

  if (contactId !== row.hubspotContactId) {
    await db
      .update(contacts)
      .set({ hubspotContactId: contactId, updatedAt: new Date() })
      .where(eq(contacts.id, row.contactRowId));
  }

  if (eventType === "handoff_requested") {
    const description = [
      motivo ? `Pedido: ${motivo}` : null,
      signals.segmento ? `Segmento: ${signals.segmento}` : null,
      signals.erp ? `ERP: ${signals.erp}` : null,
      "Origem: IA da Reforma Tributária (WhatsApp)",
    ]
      .filter(Boolean)
      .join("\n");

    await createDeal({
      name: `Reforma Tributária — ${company ?? row.pushName ?? row.phoneE164}`,
      contactId,
      description,
    });
  }
}

/** Resumo do outbox para o console. */
export async function outboxSummary(): Promise<{ pending: number; failed: number }> {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${hubspotOutbox.status} = 'pending')`,
      failed: sql<number>`count(*) filter (where ${hubspotOutbox.status} = 'failed')`,
    })
    .from(hubspotOutbox);

  return { pending: Number(row?.pending ?? 0), failed: Number(row?.failed ?? 0) };
}

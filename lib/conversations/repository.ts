import { and, asc, desc, eq, inArray, isNull, not, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  aiRuns,
  contacts,
  conversationState,
  conversations,
  hubspotOutbox,
  jobFailures,
  messages,
  usageCounters,
} from "@/db/schema";
import { brazilDay } from "@/lib/time";
import type { InboundMessage, MessageKind } from "@/lib/whatsapp/types";

/**
 * Acesso a dados do pipeline. Idempotência e controle de concorrência vivem
 * aqui — é o que garante que reentrega de webhook não vire segunda resposta e
 * que dois workers não respondam a mesma coisa.
 */

export interface IngestResult {
  contactId: string;
  conversationId: string;
  /** false = reentrega do mesmo provider_message_id; nada a fazer. */
  stored: boolean;
  optedOut: boolean;
  messagesToday: number;
}

export async function ingestInboundMessage(inbound: InboundMessage): Promise<IngestResult> {
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .insert(contacts)
      .values({
        waJid: inbound.waJid,
        phoneE164: inbound.phoneE164,
        pushName: inbound.pushName,
        lastSeenAt: new Date(),
        // Base legal do primeiro contato: a pessoa escreveu para um número
        // publicado da Invent. O aviso de IA vai na primeira resposta.
        consent: { canal: "whatsapp_inbound", registradoEm: new Date().toISOString() },
      })
      .onConflictDoUpdate({
        target: contacts.waJid,
        set: {
          lastSeenAt: new Date(),
          updatedAt: new Date(),
          pushName: sql`coalesce(${inbound.pushName ?? null}, ${contacts.pushName})`,
        },
      })
      .returning({ id: contacts.id, optOutAt: contacts.optOutAt });

    if (!contact) throw new Error("falha ao gravar contato");

    const [open] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(eq(conversations.contactId, contact.id), not(eq(conversations.status, "closed"))),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);

    let conversationId = open?.id;

    if (!conversationId) {
      const [created] = await tx
        .insert(conversations)
        .values({ contactId: contact.id, channel: "whatsapp" })
        .returning({ id: conversations.id });
      if (!created) throw new Error("falha ao abrir conversa");
      conversationId = created.id;
      await tx
        .insert(conversationState)
        .values({ conversationId })
        .onConflictDoNothing({ target: conversationState.conversationId });
    } else {
      await tx
        .update(conversations)
        .set({ lastMessageAt: new Date(), updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    }

    const inserted = await tx
      .insert(messages)
      .values({
        conversationId,
        contactId: contact.id,
        direction: "inbound",
        provider: inbound.provider,
        providerMessageId: inbound.providerMessageId,
        kind: inbound.kind,
        body: inbound.text,
        media: inbound.media,
        raw: inbound.raw,
        status: "received",
        createdAt: inbound.sentAt,
      })
      .onConflictDoNothing({ target: [messages.provider, messages.providerMessageId] })
      .returning({ id: messages.id });

    const stored = inserted.length > 0;
    let messagesToday = 0;

    if (stored) {
      const [counter] = await tx
        .insert(usageCounters)
        .values({ contactId: contact.id, day: brazilDay(), messages: 1 })
        .onConflictDoUpdate({
          target: [usageCounters.contactId, usageCounters.day],
          set: { messages: sql`${usageCounters.messages} + 1`, updatedAt: new Date() },
        })
        .returning({ messages: usageCounters.messages });
      messagesToday = counter?.messages ?? 0;
    }

    return {
      contactId: contact.id,
      conversationId,
      stored,
      optedOut: contact.optOutAt !== null,
      messagesToday,
    };
  });
}

export interface PendingMessage {
  id: string;
  kind: MessageKind;
  body: string;
  createdAt: Date;
}

/**
 * Pega as mensagens pendentes e marca como processadas na mesma transação, com
 * `for update skip locked`: dois workers concorrentes não respondem o mesmo.
 */
export async function claimPendingMessages(conversationId: string): Promise<PendingMessage[]> {
  return db.transaction(async (tx) => {
    const pending = await tx
      .select({
        id: messages.id,
        kind: messages.kind,
        body: messages.body,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "inbound"),
          isNull(messages.processedAt),
        ),
      )
      .orderBy(asc(messages.createdAt))
      .for("update", { skipLocked: true });

    if (pending.length === 0) return [];

    await tx
      .update(messages)
      .set({ processedAt: new Date() })
      .where(
        inArray(
          messages.id,
          pending.map((message) => message.id),
        ),
      );

    return pending;
  });
}

export async function recentHistory(
  conversationId: string,
  options: { limit?: number; excludeIds?: string[] } = {},
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { limit = 20, excludeIds = [] } = options;
  const conditions = [eq(messages.conversationId, conversationId), sql`${messages.body} <> ''`];
  if (excludeIds.length > 0) conditions.push(not(inArray(messages.id, excludeIds)));

  const rows = await db
    .select({ direction: messages.direction, body: messages.body })
    .from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows.reverse().map((row) => ({
    role: row.direction === "inbound" ? ("user" as const) : ("assistant" as const),
    content: row.body,
  }));
}

export async function recordOutboundMessage(input: {
  conversationId: string;
  contactId: string;
  body: string;
  providerMessageId: string | null;
  provider: string;
  failed?: boolean;
}): Promise<string | null> {
  const [row] = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      contactId: input.contactId,
      direction: "outbound",
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      kind: "text",
      body: input.body,
      status: input.failed ? "failed" : "sent",
      processedAt: new Date(),
    })
    .returning({ id: messages.id });
  return row?.id ?? null;
}

export async function recordAiRun(input: {
  conversationId: string;
  messageId: string | null;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  retrievedCount: number;
  citedChunkIds: string[];
  refused: boolean;
  refusalReason?: string | null;
  error?: string | null;
}): Promise<void> {
  await db.insert(aiRuns).values({
    conversationId: input.conversationId,
    messageId: input.messageId,
    model: input.model,
    promptVersion: input.promptVersion,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    latencyMs: input.latencyMs,
    retrievedCount: input.retrievedCount,
    citedChunkIds: input.citedChunkIds.length > 0 ? input.citedChunkIds : null,
    refused: input.refused,
    refusalReason: input.refusalReason ?? null,
    error: input.error ?? null,
  });
}

export interface ConversationSnapshot {
  contactId: string;
  status: "active" | "idle" | "handoff" | "closed";
  optedOut: boolean;
  waJid: string;
  isFirstInteraction: boolean;
  simulatorOfferedAt: Date | null;
  simulatorAcceptedAt: Date | null;
  simulatorDeclinedAt: Date | null;
  handoffRequestedAt: Date | null;
}

export async function conversationSnapshot(
  conversationId: string,
): Promise<ConversationSnapshot | null> {
  const [row] = await db
    .select({
      contactId: conversations.contactId,
      status: conversations.status,
      waJid: contacts.waJid,
      optOutAt: contacts.optOutAt,
      simulatorOfferedAt: conversationState.simulatorOfferedAt,
      simulatorAcceptedAt: conversationState.simulatorAcceptedAt,
      simulatorDeclinedAt: conversationState.simulatorDeclinedAt,
      handoffRequestedAt: conversationState.handoffRequestedAt,
      outboundCount: sql<number>`(
        select count(*) from ${messages}
         where ${messages.conversationId} = ${conversations.id}
           and ${messages.direction} = 'outbound'
      )`,
    })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(conversationState, eq(conversationState.conversationId, conversations.id))
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!row) return null;

  return {
    contactId: row.contactId,
    status: row.status,
    optedOut: row.optOutAt !== null,
    waJid: row.waJid,
    isFirstInteraction: Number(row.outboundCount) === 0,
    simulatorOfferedAt: row.simulatorOfferedAt,
    simulatorAcceptedAt: row.simulatorAcceptedAt,
    simulatorDeclinedAt: row.simulatorDeclinedAt,
    handoffRequestedAt: row.handoffRequestedAt,
  };
}

export async function markOptOut(contactId: string): Promise<void> {
  await db
    .update(contacts)
    .set({ optOutAt: new Date(), updatedAt: new Date() })
    .where(and(eq(contacts.id, contactId), isNull(contacts.optOutAt)));
}

export async function registerSimulatorOffer(conversationId: string): Promise<void> {
  await db
    .update(conversationState)
    .set({
      simulatorOfferedAt: new Date(),
      simulatorOfferCount: sql`${conversationState.simulatorOfferCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(conversationState.conversationId, conversationId));
}

export async function registerSimulatorAccepted(conversationId: string): Promise<void> {
  await db
    .update(conversationState)
    .set({ simulatorAcceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(conversationState.conversationId, conversationId));
}

export async function registerSimulatorDeclined(conversationId: string): Promise<void> {
  await db
    .update(conversationState)
    .set({ simulatorDeclinedAt: new Date(), updatedAt: new Date() })
    .where(eq(conversationState.conversationId, conversationId));
}

export interface LeadSignals {
  motivo?: string;
  empresa?: string;
  segmento?: string;
  erp?: string;
}

/** Marca handoff e silencia o bot na conversa. */
export async function registerHandoff(
  conversationId: string,
  signals: LeadSignals = {},
): Promise<void> {
  const clean = Object.fromEntries(
    Object.entries(signals).filter(([, value]) => value !== undefined && value !== ""),
  );

  await db.transaction(async (tx) => {
    await tx
      .update(conversationState)
      .set({
        handoffRequestedAt: new Date(),
        leadSignals: sql`${conversationState.leadSignals} || ${JSON.stringify(clean)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(conversationState.conversationId, conversationId));

    await tx
      .update(conversations)
      .set({ status: "handoff", updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  });
}

export async function enqueueHubspotEvent(input: {
  conversationId: string;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await db.insert(hubspotOutbox).values({
    conversationId: input.conversationId,
    eventType: input.eventType,
    payload: input.payload,
  });
}

/** Fila morta: registra o que falhou para investigação e reprocessamento. */
export async function recordJobFailure(input: {
  kind: string;
  payload: Record<string, unknown>;
  error: string;
  attempts?: number;
}): Promise<void> {
  await db.insert(jobFailures).values({
    kind: input.kind,
    payload: input.payload,
    error: input.error,
    attempts: input.attempts ?? 1,
  });
}

import { and, asc, desc, eq, inArray, isNull, not, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  aiRuns,
  contacts,
  conversationState,
  conversations,
  jobFailures,
  messages,
  usageCounters,
} from "@/db/schema";
import type { InboundMessage, MessageKind } from "@/lib/whatsapp/types";

/**
 * Acesso a dados da conversa. Toda a idempotência e o controle de concorrência
 * do pipeline vivem aqui. Ver CLAUDE.md §5 e §7.
 */

export interface IngestResult {
  contactId: string;
  conversationId: string;
  /** false = reentrega do mesmo provider_message_id; nada a fazer. */
  stored: boolean;
  optedOut: boolean;
  messagesToday: number;
}

/** Hoje em America/Sao_Paulo, para o contador diário bater com o dia do usuário. */
export function brazilDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Grava a mensagem recebida de forma idempotente e devolve o estado necessário
 * para decidir se o turno deve ser enfileirado.
 */
export async function ingestInboundMessage(
  inbound: InboundMessage,
): Promise<IngestResult> {
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .insert(contacts)
      .values({
        waJid: inbound.waJid,
        phoneE164: inbound.phoneE164,
        pushName: inbound.pushName,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: contacts.waJid,
        set: {
          lastSeenAt: new Date(),
          updatedAt: new Date(),
          // pushName muda quando a pessoa troca o nome no WhatsApp.
          pushName: sql`coalesce(${inbound.pushName ?? null}, ${contacts.pushName})`,
        },
      })
      .returning({ id: contacts.id, optOutAt: contacts.optOutAt });

    if (!contact) throw new Error("falha ao gravar contato");

    const [openConversation] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.contactId, contact.id),
          sql`${conversations.status} <> 'closed'`,
        ),
      )
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);

    let conversationId = openConversation?.id;

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

    // Idempotência: reentrega do mesmo evento não insere segunda linha.
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
      .onConflictDoNothing({
        target: [messages.provider, messages.providerMessageId],
      })
      .returning({ id: messages.id });

    const stored = inserted.length > 0;
    let messagesToday = 0;

    if (stored) {
      const [counter] = await tx
        .insert(usageCounters)
        .values({ contactId: contact.id, day: brazilDay(), messages: 1 })
        .onConflictDoUpdate({
          target: [usageCounters.contactId, usageCounters.day],
          set: {
            messages: sql`${usageCounters.messages} + 1`,
            updatedAt: new Date(),
          },
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
 * Pega as mensagens ainda não processadas da conversa e as marca como
 * processadas na mesma transação, com `for update skip locked` — dois workers
 * concorrentes não respondem a mesma coisa duas vezes. CLAUDE.md §7.
 */
export async function claimPendingMessages(
  conversationId: string,
): Promise<PendingMessage[]> {
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

/** Histórico recente para dar contexto ao modelo, mais antigo primeiro. */
export async function recentHistory(
  conversationId: string,
  options: { limit?: number; excludeIds?: string[] } = {},
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { limit = 20, excludeIds = [] } = options;
  const conditions = [
    eq(messages.conversationId, conversationId),
    sql`${messages.body} <> ''`,
  ];
  if (excludeIds.length > 0) {
    conditions.push(not(inArray(messages.id, excludeIds)));
  }

  const rows = await db
    .select({
      direction: messages.direction,
      body: messages.body,
      createdAt: messages.createdAt,
    })
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
  refused: boolean;
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
    refused: input.refused,
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

/**
 * Marca handoff e silencia o bot na conversa. O envio ao HubSpot entra na
 * fase 3 (outbox); o silenciamento não espera por ela, porque o pior resultado
 * é a pessoa pedir humano e o bot seguir respondendo sozinho. CLAUDE.md §7.
 */
export async function registerHandoff(conversationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(conversationState)
      .set({ handoffRequestedAt: new Date(), updatedAt: new Date() })
      .where(eq(conversationState.conversationId, conversationId));
    await tx
      .update(conversations)
      .set({ status: "handoff", updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  });
}

/** Fila morta: registra o que falhou para reprocessamento manual. */
export async function recordJobFailure(input: {
  kind: string;
  payload: unknown;
  error: string;
  attempts?: number;
}): Promise<void> {
  await db.insert(jobFailures).values({
    kind: input.kind,
    payload: input.payload as never,
    error: input.error,
    attempts: input.attempts ?? 1,
  });
}

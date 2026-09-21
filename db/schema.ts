/**
 * Schema Drizzle — single source of truth do banco da IA da Reforma Tributária.
 *
 * Convenções:
 * - id uuid + createdAt/updatedAt em todas as tabelas de entidade.
 * - RLS habilitado e forçado em TODAS as tabelas; políticas em db/rls.sql.
 * - timestamptz sempre (UTC no banco, render em America/Sao_Paulo). CLAUDE.md §12.
 *
 * Tabelas de base de conhecimento (kb_sources, kb_chunks) entram na fase 2.
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// =============================================================================
// Enums
// =============================================================================

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "idle",
  "handoff",
  "closed",
]);

export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);

/**
 * Tipos de mensagem que o gateway sabe normalizar. `unsupported` cobre o que
 * chega sem texto aproveitável (áudio, documento, sticker, localização) e que
 * recebe resposta pedindo texto — nunca chega vazio ao modelo. CLAUDE.md §6.
 */
export const messageKindEnum = pgEnum("message_kind", [
  "text",
  "quoted_text",
  "button",
  "list",
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "location",
  "unsupported",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "received",
  "queued",
  "sent",
  "failed",
]);

export const outboxStatusEnum = pgEnum("outbox_status", ["pending", "sent", "failed"]);

// =============================================================================
// Contatos e conversas
// =============================================================================

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** JID completo do WhatsApp, ex.: 5562999998888@s.whatsapp.net */
    waJid: text("wa_jid").notNull(),
    phoneE164: varchar("phone_e164", { length: 20 }).notNull(),
    pushName: text("push_name"),
    /** Consentimento granular por finalidade. CLAUDE.md §13. */
    consent: jsonb("consent").notNull().default({}),
    optOutAt: timestamp("opt_out_at", { withTimezone: true }),
    hubspotContactId: text("hubspot_contact_id"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("contacts_wa_jid_unique").on(t.waJid),
    index("contacts_phone_idx").on(t.phoneE164),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("whatsapp"),
    status: conversationStatusEnum("status").notNull().default("active"),
    /** profiles.id do atendente que assumiu, quando status = handoff. */
    assignedTo: uuid("assigned_to"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversations_contact_idx").on(t.contactId),
    index("conversations_status_idx").on(t.status, t.lastMessageAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    provider: text("provider").notNull().default("evolution"),
    /** id da mensagem no provider. Base da idempotência. CLAUDE.md §5. */
    providerMessageId: text("provider_message_id"),
    kind: messageKindEnum("kind").notNull(),
    body: text("body").notNull().default(""),
    media: jsonb("media"),
    /** Payload cru do webhook, para auditoria e depuração. */
    raw: jsonb("raw"),
    status: messageStatusEnum("status").notNull().default("received"),
    /** Preenchido quando a mensagem já foi consumida por um turno. */
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Reentrega do mesmo evento não gera segunda resposta.
    unique("messages_provider_message_unique").on(t.provider, t.providerMessageId),
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    index("messages_pending_idx").on(t.conversationId, t.processedAt),
  ],
);

/**
 * Estado de negócio da conversa. Existe para que o prompt NÃO precise pedir ao
 * modelo que "mantenha um marcador interno" — LLM não tem estado. CLAUDE.md §4.
 */
export const conversationState = pgTable("conversation_state", {
  conversationId: uuid("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  simulatorOfferedAt: timestamp("simulator_offered_at", { withTimezone: true }),
  simulatorOfferCount: integer("simulator_offer_count").notNull().default(0),
  simulatorAcceptedAt: timestamp("simulator_accepted_at", { withTimezone: true }),
  simulatorDeclinedAt: timestamp("simulator_declined_at", { withTimezone: true }),
  lastTopic: text("last_topic"),
  handoffRequestedAt: timestamp("handoff_requested_at", { withTimezone: true }),
  flags: jsonb("flags").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================================================
// Telemetria de IA
// =============================================================================

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** Mensagem de saída gerada por este run, quando houve envio. */
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    latencyMs: integer("latency_ms").notNull().default(0),
    /** Chunks citados (fase 2). Refusal alto = lacuna de curadoria. */
    retrievedChunkIds: uuid("retrieved_chunk_ids").array(),
    refused: boolean("refused").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_runs_conversation_idx").on(t.conversationId, t.createdAt)],
);

/** Rate limit e teto de custo por contato/dia. CLAUDE.md §5 e §8. */
export const usageCounters = pgTable(
  "usage_counters",
  {
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    messages: integer("messages").notNull().default(0),
    tokens: integer("tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.day] })],
);

// =============================================================================
// Confiabilidade
// =============================================================================

/** Fila morta: silêncio nunca é resultado aceitável. CLAUDE.md §8. */
export const jobFailures = pgTable(
  "job_failures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    error: text("error").notNull(),
    attempts: integer("attempts").notNull().default(0),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_failures_open_idx").on(t.resolvedAt, t.createdAt)],
);

/** Outbox do HubSpot: integração falha sem perder lead (fase 3). */
export const hubspotOutbox = pgTable(
  "hubspot_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: outboxStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("hubspot_outbox_pending_idx").on(t.status, t.createdAt)],
);

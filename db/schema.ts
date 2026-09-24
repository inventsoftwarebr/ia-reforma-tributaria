/**
 * Schema Drizzle — single source of truth do banco.
 *
 * Convenções:
 * - id uuid + createdAt/updatedAt nas tabelas de entidade.
 * - RLS habilitado e forçado em TODAS as tabelas; políticas em db/rls.sql.
 * - timestamptz sempre: UTC no banco, render em America/Sao_Paulo.
 *
 * O índice HNSW do embedding, a coluna tsvector e a função de busca híbrida
 * vivem em db/functions.sql, porque são ajuste de banco, não de aplicação.
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
  vector,
} from "drizzle-orm/pg-core";

// =============================================================================
// Enums
// =============================================================================

export const appRoleEnum = pgEnum("app_role", ["admin", "agent"]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "idle",
  "handoff",
  "closed",
]);

export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);

/** Tipos que o gateway sabe normalizar. Nada chega vazio ao modelo. */
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

/** Camadas de autoridade da base: norma > material da Invent > imprensa. */
export const kbAuthorityEnum = pgEnum("kb_authority", ["oficial", "invent", "secundaria"]);

export const kbKindEnum = pgEnum("kb_kind", [
  "emenda",
  "lei_complementar",
  "lei",
  "instrucao_normativa",
  "nota_tecnica",
  "faq",
  "material_invent",
  "imprensa",
]);

export const kbStatusEnum = pgEnum("kb_status", ["active", "archived"]);

export const outboxStatusEnum = pgEnum("outbox_status", ["pending", "sent", "failed"]);

// =============================================================================
// Identidade (console admin)
// =============================================================================

/** Estende auth.users 1:1. Criado pela trigger handle_new_user() em rls.sql. */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email"),
  fullName: text("full_name"),
  role: appRoleEnum("role").notNull().default("agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================================================
// Contatos e conversas
// =============================================================================

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** JID completo, ex.: 5562999998888@s.whatsapp.net */
    waJid: text("wa_jid").notNull(),
    phoneE164: varchar("phone_e164", { length: 20 }).notNull(),
    pushName: text("push_name"),
    /** Consentimento granular por finalidade (LGPD). */
    consent: jsonb("consent").notNull().default({}),
    optOutAt: timestamp("opt_out_at", { withTimezone: true }),
    hubspotContactId: text("hubspot_contact_id"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
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
    assignedTo: uuid("assigned_to").references(() => profiles.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
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
    /** id no provider: base da idempotência contra reentrega de webhook. */
    providerMessageId: text("provider_message_id"),
    kind: messageKindEnum("kind").notNull(),
    body: text("body").notNull().default(""),
    media: jsonb("media"),
    raw: jsonb("raw"),
    status: messageStatusEnum("status").notNull().default("received"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("messages_provider_message_unique").on(t.provider, t.providerMessageId),
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    index("messages_pending_idx").on(t.conversationId, t.processedAt),
  ],
);

/** Estado de negócio da conversa — o prompt lê daqui, não da memória do modelo. */
export const conversationState = pgTable("conversation_state", {
  conversationId: uuid("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  simulatorOfferedAt: timestamp("simulator_offered_at", { withTimezone: true }),
  simulatorOfferCount: integer("simulator_offer_count").notNull().default(0),
  simulatorAcceptedAt: timestamp("simulator_accepted_at", { withTimezone: true }),
  simulatorDeclinedAt: timestamp("simulator_declined_at", { withTimezone: true }),
  handoffRequestedAt: timestamp("handoff_requested_at", { withTimezone: true }),
  lastTopic: text("last_topic"),
  /** Sinais extraídos da conversa para qualificar o lead. */
  leadSignals: jsonb("lead_signals").notNull().default({}),
  flags: jsonb("flags").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================================================
// Base de conhecimento (RAG)
// =============================================================================

export const kbSources = pgTable(
  "kb_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Chave estável para reingestão: slug do documento. */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** Como a fonte é citada na resposta: "LC 214/2025", "EC 132/2023". */
    citationLabel: text("citation_label").notNull(),
    kind: kbKindEnum("kind").notNull(),
    authority: kbAuthorityEnum("authority").notNull(),
    url: text("url"),
    publisher: text("publisher"),
    /** Vigência: o retrieval filtra o que valia na data da pergunta. */
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    version: text("version"),
    /** sha256 do conteúdo: reingestão só reprocessa o que mudou. */
    checksum: text("checksum").notNull(),
    status: kbStatusEnum("status").notNull().default("active"),
    /** Quem revisou e quando — base sem dono é base que envelhece. */
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("kb_sources_slug_unique").on(t.slug),
    index("kb_sources_status_idx").on(t.status, t.authority),
  ],
);

export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => kbSources.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    /** Dispositivo citável: "art. 12, §3º" ou o título da seção. */
    heading: text("heading"),
    content: text("content").notNull(),
    tokens: integer("tokens").notNull().default(0),
    embedding: vector("embedding", { dimensions: 1536 }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("kb_chunks_source_ord_unique").on(t.sourceId, t.ord),
    index("kb_chunks_source_idx").on(t.sourceId),
  ],
);

// =============================================================================
// Prompt, telemetria e limites
// =============================================================================

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    version: text("version").notNull(),
    content: text("content").notNull(),
    active: boolean("active").notNull().default(false),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("prompt_versions_key_version_unique").on(t.key, t.version)],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    latencyMs: integer("latency_ms").notNull().default(0),
    /** Chunks que sustentaram a resposta. Refusal alto = lacuna de curadoria. */
    citedChunkIds: uuid("cited_chunk_ids").array(),
    retrievedCount: integer("retrieved_count").notNull().default(0),
    refused: boolean("refused").notNull().default(false),
    refusalReason: text("refusal_reason"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_runs_conversation_idx").on(t.conversationId, t.createdAt),
    index("ai_runs_created_idx").on(t.createdAt),
  ],
);

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
// Confiabilidade e integração
// =============================================================================

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

/** Outbox do HubSpot: integração pode falhar sem perder lead. */
export const hubspotOutbox = pgTable(
  "hubspot_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
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

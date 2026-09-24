import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  aiRuns,
  contacts,
  conversationState,
  conversations,
  jobFailures,
  kbChunks,
  kbSources,
  messages,
  promptVersions,
} from "@/db/schema";
import { brazilDay } from "@/lib/time";

/** Leituras do console. Toda página chama requireAgent() antes de usar isto. */

export interface Overview {
  conversas7d: number;
  respostas7d: number;
  recusas7d: number;
  taxaRecusa: number;
  tokens7d: number;
  latenciaMediaMs: number;
  simuladorOfertado: number;
  simuladorAceito: number;
  handoffs: number;
  fontesAtivas: number;
  trechos: number;
  fontesVencidas: number;
  falhasAbertas: number;
}

function sevenDaysAgo(): Date {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

export async function overview(): Promise<Overview> {
  const since = sevenDaysAgo();
  const hoje = brazilDay();

  const [runs] = await db
    .select({
      respostas: sql<number>`count(*)`,
      recusas: sql<number>`count(*) filter (where ${aiRuns.refused})`,
      tokens: sql<number>`coalesce(sum(${aiRuns.inputTokens} + ${aiRuns.outputTokens}), 0)`,
      latencia: sql<number>`coalesce(round(avg(${aiRuns.latencyMs})), 0)`,
    })
    .from(aiRuns)
    .where(gte(aiRuns.createdAt, since));

  const [convs] = await db
    .select({ total: sql<number>`count(*)` })
    .from(conversations)
    .where(gte(conversations.startedAt, since));

  const [estado] = await db
    .select({
      ofertado: sql<number>`count(*) filter (where ${conversationState.simulatorOfferedAt} is not null)`,
      aceito: sql<number>`count(*) filter (where ${conversationState.simulatorAcceptedAt} is not null)`,
      handoff: sql<number>`count(*) filter (where ${conversationState.handoffRequestedAt} is not null)`,
    })
    .from(conversationState);

  const [base] = await db
    .select({
      fontes: sql<number>`count(*) filter (where ${kbSources.status} = 'active')`,
      vencidas: sql<number>`count(*) filter (where ${kbSources.effectiveTo} is not null and ${kbSources.effectiveTo} < ${hoje}::date)`,
    })
    .from(kbSources);

  const [chunks] = await db.select({ total: sql<number>`count(*)` }).from(kbChunks);

  const [falhas] = await db
    .select({ total: sql<number>`count(*)` })
    .from(jobFailures)
    .where(isNull(jobFailures.resolvedAt));

  const respostas = Number(runs?.respostas ?? 0);
  const recusas = Number(runs?.recusas ?? 0);

  return {
    conversas7d: Number(convs?.total ?? 0),
    respostas7d: respostas,
    recusas7d: recusas,
    taxaRecusa: respostas === 0 ? 0 : Math.round((recusas / respostas) * 100),
    tokens7d: Number(runs?.tokens ?? 0),
    latenciaMediaMs: Number(runs?.latencia ?? 0),
    simuladorOfertado: Number(estado?.ofertado ?? 0),
    simuladorAceito: Number(estado?.aceito ?? 0),
    handoffs: Number(estado?.handoff ?? 0),
    fontesAtivas: Number(base?.fontes ?? 0),
    trechos: Number(chunks?.total ?? 0),
    fontesVencidas: Number(base?.vencidas ?? 0),
    falhasAbertas: Number(falhas?.total ?? 0),
  };
}

/**
 * Recusas por motivo: é o indicador de curadoria. Muita recusa por falta de
 * respaldo significa lacuna na base, não defeito do modelo.
 */
export async function refusalsByReason(): Promise<{ reason: string; total: number }[]> {
  const rows = await db
    .select({
      reason: sql<string>`coalesce(${aiRuns.refusalReason}, 'sem_motivo')`,
      total: sql<number>`count(*)`,
    })
    .from(aiRuns)
    .where(and(gte(aiRuns.createdAt, sevenDaysAgo()), eq(aiRuns.refused, true)))
    .groupBy(sql`coalesce(${aiRuns.refusalReason}, 'sem_motivo')`)
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({ reason: row.reason, total: Number(row.total) }));
}

export interface ConversationRow {
  id: string;
  phoneE164: string;
  pushName: string | null;
  status: "active" | "idle" | "handoff" | "closed";
  lastMessageAt: Date;
  mensagens: number;
  optedOut: boolean;
  handoff: boolean;
}

export async function listConversations(limit = 50): Promise<ConversationRow[]> {
  const rows = await db
    .select({
      id: conversations.id,
      phoneE164: contacts.phoneE164,
      pushName: contacts.pushName,
      status: conversations.status,
      lastMessageAt: conversations.lastMessageAt,
      optOutAt: contacts.optOutAt,
      handoffRequestedAt: conversationState.handoffRequestedAt,
      mensagens: sql<number>`(
        select count(*) from ${messages}
         where ${messages.conversationId} = ${conversations.id}
      )`,
    })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(conversationState, eq(conversationState.conversationId, conversations.id))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    phoneE164: row.phoneE164,
    pushName: row.pushName,
    status: row.status,
    lastMessageAt: row.lastMessageAt,
    mensagens: Number(row.mensagens),
    optedOut: row.optOutAt !== null,
    handoff: row.handoffRequestedAt !== null,
  }));
}

export interface TranscriptMessage {
  id: string;
  direction: "inbound" | "outbound";
  kind: string;
  body: string;
  createdAt: Date;
  status: string;
}

export interface ConversationDetail {
  id: string;
  status: "active" | "idle" | "handoff" | "closed";
  phoneE164: string;
  pushName: string | null;
  optedOut: boolean;
  leadSignals: Record<string, unknown>;
  simulatorAcceptedAt: Date | null;
  handoffRequestedAt: Date | null;
  transcript: TranscriptMessage[];
  runs: {
    id: string;
    model: string;
    promptVersion: string;
    refused: boolean;
    refusalReason: string | null;
    retrievedCount: number;
    latencyMs: number;
    createdAt: Date;
  }[];
}

export async function conversationDetail(id: string): Promise<ConversationDetail | null> {
  const [head] = await db
    .select({
      id: conversations.id,
      status: conversations.status,
      phoneE164: contacts.phoneE164,
      pushName: contacts.pushName,
      optOutAt: contacts.optOutAt,
      leadSignals: conversationState.leadSignals,
      simulatorAcceptedAt: conversationState.simulatorAcceptedAt,
      handoffRequestedAt: conversationState.handoffRequestedAt,
    })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(conversationState, eq(conversationState.conversationId, conversations.id))
    .where(eq(conversations.id, id))
    .limit(1);

  if (!head) return null;

  const transcript = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      kind: messages.kind,
      body: messages.body,
      createdAt: messages.createdAt,
      status: messages.status,
    })
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);

  const runs = await db
    .select({
      id: aiRuns.id,
      model: aiRuns.model,
      promptVersion: aiRuns.promptVersion,
      refused: aiRuns.refused,
      refusalReason: aiRuns.refusalReason,
      retrievedCount: aiRuns.retrievedCount,
      latencyMs: aiRuns.latencyMs,
      createdAt: aiRuns.createdAt,
    })
    .from(aiRuns)
    .where(eq(aiRuns.conversationId, id))
    .orderBy(desc(aiRuns.createdAt))
    .limit(20);

  return {
    id: head.id,
    status: head.status,
    phoneE164: head.phoneE164,
    pushName: head.pushName,
    optedOut: head.optOutAt !== null,
    leadSignals: (head.leadSignals ?? {}) as Record<string, unknown>,
    simulatorAcceptedAt: head.simulatorAcceptedAt,
    handoffRequestedAt: head.handoffRequestedAt,
    transcript,
    runs,
  };
}

export interface SourceRow {
  id: string;
  slug: string;
  title: string;
  citationLabel: string;
  kind: string;
  authority: string;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  chunks: number;
}

export async function listSources(): Promise<SourceRow[]> {
  const rows = await db
    .select({
      id: kbSources.id,
      slug: kbSources.slug,
      title: kbSources.title,
      citationLabel: kbSources.citationLabel,
      kind: kbSources.kind,
      authority: kbSources.authority,
      status: kbSources.status,
      effectiveFrom: kbSources.effectiveFrom,
      effectiveTo: kbSources.effectiveTo,
      reviewedBy: kbSources.reviewedBy,
      reviewedAt: kbSources.reviewedAt,
      chunks: sql<number>`(
        select count(*) from ${kbChunks} where ${kbChunks.sourceId} = ${kbSources.id}
      )`,
    })
    .from(kbSources)
    .orderBy(kbSources.authority, kbSources.title);

  return rows.map((row) => ({ ...row, chunks: Number(row.chunks) }));
}

export async function listPromptVersions() {
  return db
    .select({
      id: promptVersions.id,
      key: promptVersions.key,
      version: promptVersions.version,
      active: promptVersions.active,
      notes: promptVersions.notes,
      createdAt: promptVersions.createdAt,
      content: promptVersions.content,
    })
    .from(promptVersions)
    .orderBy(desc(promptVersions.createdAt));
}

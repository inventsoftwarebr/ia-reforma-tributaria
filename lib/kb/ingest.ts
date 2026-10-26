import { createHash } from "node:crypto";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { kbChunks, kbSources } from "@/db/schema";
import { logInfo } from "@/lib/observability/logger";
import { chunkDocument, type DocumentShape } from "./chunk";
import { embedTexts, toVectorLiteral } from "./embed";

/**
 * Ingestão da base curada, em duas etapas:
 *
 * 1. `prepareSource` grava a fonte e os trechos (sem embedding) numa transação.
 *    Trecho com texto idêntico ao da versão anterior herda o embedding dela —
 *    quando a lei muda num artigo, só aquele artigo é reprocessado, e a fonte
 *    não "some" da busca durante a atualização.
 * 2. `embedPending` gera os embeddings que faltam, em lotes, até um prazo.
 *
 * Separar as etapas é o que permite indexar a LC 214 inteira dentro do limite
 * de tempo de uma função da Vercel e da cota por minuto do Gemini: o console e
 * o cron chamam a segunda etapa quantas vezes for preciso. A busca
 * (`kb_search`) ignora trecho sem embedding, então nada aparece pela metade.
 */

export const KB_KINDS = [
  "emenda",
  "lei_complementar",
  "lei",
  "instrucao_normativa",
  "nota_tecnica",
  "faq",
  "material_invent",
  "imprensa",
] as const;

export type KbKind = (typeof KB_KINDS)[number];
export type KbAuthority = "oficial" | "invent" | "secundaria";

export interface SourceInput {
  slug: string;
  title: string;
  citationLabel: string;
  kind: KbKind;
  authority: KbAuthority;
  shape: DocumentShape;
  url?: string;
  publisher?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  version?: string;
  reviewedBy?: string;
  /** Conferida todo dia no site de origem (só fontes importadas por link). */
  autoUpdate?: boolean;
  text: string;
}

export interface PrepareOutcome {
  sourceId: string;
  status: "unchanged" | "prepared";
  chunks: number;
  /** Trechos que ainda precisam de embedding. */
  pending: number;
  /** Trechos que herdaram o embedding da versão anterior. */
  reused: number;
}

export function checksumOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const INSERT_BATCH = 400;

export async function prepareSource(
  input: SourceInput,
  options: { force?: boolean } = {},
): Promise<PrepareOutcome> {
  const checksum = checksumOf(input.text);

  const [existing] = await db
    .select({ id: kbSources.id, checksum: kbSources.checksum })
    .from(kbSources)
    .where(eq(kbSources.slug, input.slug));

  if (existing && existing.checksum === checksum && !options.force) {
    const progress = await sourceProgress(existing.id);
    return {
      sourceId: existing.id,
      status: "unchanged",
      chunks: progress.total,
      pending: progress.total - progress.embedded,
      reused: 0,
    };
  }

  const chunks = chunkDocument(input.text, input.shape);
  if (chunks.length === 0) {
    throw new Error("o documento não gerou nenhum trecho de texto — ele está vazio?");
  }

  const fields = {
    title: input.title,
    citationLabel: input.citationLabel,
    kind: input.kind,
    authority: input.authority,
    url: input.url ?? null,
    publisher: input.publisher ?? null,
    effectiveFrom: input.effectiveFrom ?? null,
    effectiveTo: input.effectiveTo ?? null,
    version: input.version ?? null,
    checksum,
    autoUpdate: input.autoUpdate ?? false,
    // Conteúdo novo derruba a revisão anterior: o time fiscal confere de novo.
    reviewedBy: input.reviewedBy ?? null,
    reviewedAt: input.reviewedBy ? new Date() : null,
  };

  const { sourceId, reused } = await db.transaction(async (tx) => {
    const [source] = await tx
      .insert(kbSources)
      .values({ slug: input.slug, ...fields })
      .onConflictDoUpdate({
        target: kbSources.slug,
        set: { ...fields, status: "active", updatedAt: new Date() },
      })
      .returning({ id: kbSources.id });
    if (!source) throw new Error(`falha ao gravar a fonte ${input.slug}`);

    // Embeddings da versão anterior, para reaproveitar o que não mudou.
    await tx.execute(sql`
      create temporary table kb_old_chunks on commit drop as
      select coalesce(heading, '') as heading, content, embedding
        from public.kb_chunks
       where source_id = ${source.id} and embedding is not null
    `);
    await tx.delete(kbChunks).where(eq(kbChunks.sourceId, source.id));

    for (let start = 0; start < chunks.length; start += INSERT_BATCH) {
      await tx.insert(kbChunks).values(
        chunks.slice(start, start + INSERT_BATCH).map((chunk) => ({
          sourceId: source.id,
          ord: chunk.ord,
          heading: chunk.heading,
          content: chunk.content,
          tokens: chunk.tokens,
          metadata: { shape: input.shape },
        })),
      );
    }

    const copied = await tx.execute(sql`
      update public.kb_chunks c
         set embedding = o.embedding
        from kb_old_chunks o
       where c.source_id = ${source.id}
         and c.embedding is null
         and coalesce(c.heading, '') = o.heading
         and c.content = o.content
    `);

    return { sourceId: source.id, reused: copied.count ?? 0 };
  });

  const pending = chunks.length - reused;
  logInfo("kb.prepared", { slug: input.slug, chunks: chunks.length, reused, pending });
  return { sourceId, status: "prepared", chunks: chunks.length, pending, reused };
}

export async function sourceProgress(
  sourceId: string,
): Promise<{ total: number; embedded: number }> {
  const [row] = await db
    .select({
      total: count(),
      embedded: sql<number>`count(${kbChunks.embedding})`,
    })
    .from(kbChunks)
    .where(eq(kbChunks.sourceId, sourceId));
  return { total: Number(row?.total ?? 0), embedded: Number(row?.embedded ?? 0) };
}

/**
 * Gemini pediu pausa: cota por minuto esgotada ou serviço instável (503,
 * "overloaded"). Esperar e continuar — falhar faria a pessoa recomeçar à mão.
 */
export class EmbeddingBusyError extends Error {
  constructor() {
    super(
      "o Gemini pediu uma pausa (limite de uso ou instabilidade); continua em instantes",
    );
    this.name = "EmbeddingBusyError";
  }
}

const TEMPORARY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const TEMPORARY_MESSAGE =
  /\b(408|429|500|502|503|504)\b|quota|rate.?limit|resource.?exhausted|unavailable|overloaded|try again|timed? ?out|ECONNRESET|socket hang up/i;

/**
 * Falha que passa sozinha. Percorre `cause` e `lastError` (o AI SDK embrulha a
 * última tentativa em "Failed after 3 attempts").
 */
export function isTemporaryFailure(error: unknown): boolean {
  const queue: unknown[] = [error];
  for (let seen = 0; seen < 8 && queue.length > 0; seen += 1) {
    const current = queue.shift();
    if (!current) continue;
    if (typeof current === "object") {
      const record = current as {
        statusCode?: unknown;
        cause?: unknown;
        lastError?: unknown;
      };
      if (
        typeof record.statusCode === "number" &&
        TEMPORARY_STATUS.has(record.statusCode)
      ) {
        return true;
      }
      queue.push(record.cause, record.lastError);
    }
    const message = current instanceof Error ? current.message : String(current);
    if (TEMPORARY_MESSAGE.test(message)) return true;
  }
  return false;
}

/** Literal de array do Postgres: `{a,b}` para uuid, `{"[..]","[..]"}` para texto. */
export function pgArray(values: string[], quote: boolean): string {
  return `{${values.map((value) => (quote ? `"${value}"` : value)).join(",")}}`;
}

export interface EmbedOutcome {
  embedded: number;
  remaining: number;
}

/**
 * Gera embeddings pendentes (de uma fonte ou de todas) até acabar ou até o
 * prazo. Lote pequeno de propósito: ~32 trechos ≈ 12 mil tokens, abaixo da
 * cota por minuto do plano gratuito do Gemini.
 */
export async function embedPending(
  options: { sourceId?: string; batchSize?: number; deadline?: number } = {},
): Promise<EmbedOutcome> {
  const batchSize = options.batchSize ?? 32;
  const deadline = options.deadline ?? Date.now() + 40_000;
  const scope = options.sourceId
    ? and(isNull(kbChunks.embedding), eq(kbChunks.sourceId, options.sourceId))
    : isNull(kbChunks.embedding);

  let embedded = 0;
  while (Date.now() < deadline) {
    const batch = await db
      .select({ id: kbChunks.id, heading: kbChunks.heading, content: kbChunks.content })
      .from(kbChunks)
      .where(scope)
      .orderBy(asc(kbChunks.sourceId), asc(kbChunks.ord))
      .limit(batchSize);
    if (batch.length === 0) break;

    let vectors: number[][];
    try {
      vectors = await embedTexts(
        batch.map((chunk) =>
          chunk.heading ? `${chunk.heading}\n${chunk.content}` : chunk.content,
        ),
      );
    } catch (error) {
      if (isTemporaryFailure(error)) {
        if (embedded > 0) break;
        throw new EmbeddingBusyError();
      }
      throw error;
    }

    await db.execute(sql`
      update public.kb_chunks c
         set embedding = v.embedding::vector
        from unnest(
          ${pgArray(
            batch.map((chunk) => chunk.id),
            false,
          )}::uuid[],
          ${pgArray(vectors.map(toVectorLiteral), true)}::text[]
        ) as v(id, embedding)
       where c.id = v.id
    `);
    embedded += batch.length;
  }

  const [left] = await db.select({ total: count() }).from(kbChunks).where(scope);
  return { embedded, remaining: Number(left?.total ?? 0) };
}

export type IngestOutcome =
  | { slug: string; status: "unchanged" }
  | { slug: string; status: "ingested"; chunks: number };

/** Ingestão completa de uma vez, para o script de linha de comando. */
export async function ingestSource(
  input: SourceInput,
  options: { force?: boolean } = {},
): Promise<IngestOutcome> {
  const prepared = await prepareSource(input, options);
  let remaining = prepared.pending;
  while (remaining > 0) {
    try {
      ({ remaining } = await embedPending({
        sourceId: prepared.sourceId,
        deadline: Date.now() + 60_000,
      }));
    } catch (error) {
      if (!(error instanceof EmbeddingBusyError)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }
  return prepared.status === "unchanged" && prepared.pending === 0
    ? { slug: input.slug, status: "unchanged" }
    : { slug: input.slug, status: "ingested", chunks: prepared.chunks };
}

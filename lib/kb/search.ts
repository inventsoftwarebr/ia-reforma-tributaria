import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { serverEnv } from "@/lib/env";
import { brazilDay } from "@/lib/time";
import { isDailyQuota, isTemporaryFailure } from "@/lib/ai/errors";
import { describeError, logWarn } from "@/lib/observability/logger";
import { embedQuery, toVectorLiteral } from "./embed";

/**
 * Retrieval: única porta pela qual o agente consulta a base curada.
 *
 * Filtra por vigência na data da pergunta, porque norma revogada não sustenta
 * resposta, e combina busca vetorial com textual (ver db/functions.sql).
 */

export interface RetrievedChunk {
  chunkId: string;
  sourceId: string;
  heading: string | null;
  content: string;
  sourceTitle: string;
  citationLabel: string;
  sourceKind: string;
  authority: "oficial" | "invent" | "secundaria";
  sourceUrl: string | null;
  effectiveFrom: string | null;
  score: number;
}

interface SearchRow extends Record<string, unknown> {
  chunk_id: string;
  source_id: string;
  heading: string | null;
  content: string;
  source_title: string;
  citation_label: string;
  source_kind: string;
  authority: string;
  source_url: string | null;
  effective_from: string | null;
  score: number;
}

export async function searchKb(
  query: string,
  options: { matchCount?: number; atDate?: string } = {},
): Promise<RetrievedChunk[]> {
  const text = query.trim();
  if (!text) return [];

  const matchCount = options.matchCount ?? serverEnv().KB_MATCH_COUNT;
  const atDate = options.atDate ?? brazilDay();

  let rows: Iterable<SearchRow>;
  try {
    const embedding = await embedQuery(text);
    rows = await db.execute<SearchRow>(sql`
      select * from public.kb_search(
        ${toVectorLiteral(embedding)}::vector,
        ${text},
        ${matchCount}::integer,
        ${atDate}::date
      )
    `);
  } catch (error) {
    // Sem embedding (cota do Gemini, instabilidade), a busca por palavras ainda
    // acha o que importa — melhor que deixar o cliente sem resposta.
    if (!isTemporaryFailure(error) && !isDailyQuota(error)) throw error;
    logWarn("kb.search_text_only", { reason: describeError(error).slice(0, 200) });
    rows = await textOnlySearch(text, matchCount, atDate);
  }

  return Array.from(rows).map((row) => ({
    chunkId: row.chunk_id,
    sourceId: row.source_id,
    heading: row.heading,
    content: row.content,
    sourceTitle: row.source_title,
    citationLabel: row.citation_label,
    sourceKind: row.source_kind,
    authority: row.authority as RetrievedChunk["authority"],
    sourceUrl: row.source_url,
    effectiveFrom: row.effective_from,
    score: Number(row.score),
  }));
}

/**
 * Termos da pergunta ligados por "or": a busca por palavras em AND ("o que é a
 * CBS e o IBS") quase nunca acha um trecho com todas.
 */
export function textQueryTerms(question: string): string {
  const words = question
    .toLowerCase()
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3);
  return [...new Set(words)].slice(0, 12).join(" or ");
}

async function textOnlySearch(
  question: string,
  matchCount: number,
  atDate: string,
): Promise<Iterable<SearchRow>> {
  const terms = textQueryTerms(question);
  if (!terms) return [];
  return db.execute<SearchRow>(sql`
    select c.id as chunk_id, c.source_id, c.heading, c.content,
           s.title as source_title, s.citation_label, s.kind::text as source_kind,
           s.authority::text as authority, s.url as source_url, s.effective_from,
           ts_rank_cd(c.tsv, websearch_to_tsquery('portuguese', ${terms}))::real as score
      from public.kb_chunks c
      join public.kb_sources s on s.id = c.source_id
     where s.status = 'active'
       and (s.effective_from is null or s.effective_from <= ${atDate}::date)
       and (s.effective_to is null or s.effective_to >= ${atDate}::date)
       and c.tsv @@ websearch_to_tsquery('portuguese', ${terms})
     order by score desc
     limit ${matchCount}
  `);
}

let knownCache: { at: number; labels: string[] } | null = null;

/**
 * Rótulos de citação das fontes ativas da base ("LC 214/2025", "EC 132/2023").
 * No modo de orientação geral, a IA pode mencionar essas normas mesmo quando
 * nenhum trecho delas veio na busca: existem e foram curadas. Norma que não
 * está na base continua bloqueada como invenção.
 */
export async function activeCitationLabels(): Promise<string[]> {
  if (knownCache && Date.now() - knownCache.at < 5 * 60_000) return knownCache.labels;
  try {
    const rows = await db.execute<{ citation_label: string }>(sql`
      select distinct citation_label from public.kb_sources where status = 'active'
    `);
    knownCache = {
      at: Date.now(),
      labels: Array.from(rows).map((row) => row.citation_label),
    };
  } catch {
    knownCache = { at: Date.now(), labels: knownCache?.labels ?? [] };
  }
  return knownCache.labels;
}

/** Citação curta, do jeito que o agente é instruído a escrever. */
export function formatCitation(chunk: RetrievedChunk): string {
  return chunk.heading ? `${chunk.citationLabel}, ${chunk.heading}` : chunk.citationLabel;
}

/**
 * Monta o contexto entregue ao modelo. A autoridade vai explícita em cada
 * trecho: imprensa é contexto, não norma, e o modelo precisa enxergar isso.
 */
export function buildContextBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "Nenhum trecho da base cobre esta pergunta.";

  return chunks
    .map((chunk, index) => {
      const authority =
        chunk.authority === "oficial"
          ? "NORMA"
          : chunk.authority === "invent"
            ? "MATERIAL INVENT"
            : "FONTE SECUNDÁRIA (contexto, nunca citar como norma)";

      const vigencia = chunk.effectiveFrom
        ? ` · vigente desde ${chunk.effectiveFrom}`
        : "";

      return [
        `[${index + 1}] ${authority} · ${formatCitation(chunk)}${vigencia}`,
        chunk.content.trim(),
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

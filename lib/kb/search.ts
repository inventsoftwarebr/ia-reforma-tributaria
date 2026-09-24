import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { serverEnv } from "@/lib/env";
import { brazilDay } from "@/lib/time";
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
  const embedding = await embedQuery(text);

  const rows = await db.execute<SearchRow>(sql`
    select * from public.kb_search(
      ${toVectorLiteral(embedding)}::vector,
      ${text},
      ${matchCount}::integer,
      ${atDate}::date
    )
  `);

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

      const vigencia = chunk.effectiveFrom ? ` · vigente desde ${chunk.effectiveFrom}` : "";

      return [
        `[${index + 1}] ${authority} · ${formatCitation(chunk)}${vigencia}`,
        chunk.content.trim(),
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

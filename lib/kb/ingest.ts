import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { kbChunks, kbSources } from "@/db/schema";
import { logInfo } from "@/lib/observability/logger";
import { chunkDocument, type DocumentShape } from "./chunk";
import { embedTexts, toVectorLiteral } from "./embed";

/**
 * Ingestão da base curada.
 *
 * Idempotente por checksum: reprocessar a base inteira só gasta embedding no
 * que mudou. Uma fonte alterada tem os trechos antigos apagados e reescritos —
 * evita conviver com duas versões do mesmo artigo, que é como o agente acaba
 * citando regra revogada.
 */

export interface SourceInput {
  slug: string;
  title: string;
  citationLabel: string;
  kind:
    | "emenda"
    | "lei_complementar"
    | "lei"
    | "instrucao_normativa"
    | "nota_tecnica"
    | "faq"
    | "material_invent"
    | "imprensa";
  authority: "oficial" | "invent" | "secundaria";
  shape: DocumentShape;
  url?: string;
  publisher?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  version?: string;
  reviewedBy?: string;
  text: string;
}

export type IngestOutcome =
  | { slug: string; status: "unchanged" }
  | { slug: string; status: "ingested"; chunks: number };

export function checksumOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function ingestSource(
  input: SourceInput,
  options: { force?: boolean } = {},
): Promise<IngestOutcome> {
  const checksum = checksumOf(input.text);

  const [existing] = await db
    .select({ id: kbSources.id, checksum: kbSources.checksum })
    .from(kbSources)
    .where(eq(kbSources.slug, input.slug));

  if (existing && existing.checksum === checksum && !options.force) {
    return { slug: input.slug, status: "unchanged" };
  }

  const chunks = chunkDocument(input.text, input.shape);
  if (chunks.length === 0) {
    throw new Error(`fonte ${input.slug} não gerou nenhum trecho`);
  }

  const embeddings = await embedTexts(
    chunks.map((chunk) => (chunk.heading ? `${chunk.heading}\n${chunk.content}` : chunk.content)),
  );

  if (embeddings.length !== chunks.length) {
    throw new Error(
      `fonte ${input.slug}: ${chunks.length} trechos e ${embeddings.length} embeddings`,
    );
  }

  await db.transaction(async (tx) => {
    const [source] = await tx
      .insert(kbSources)
      .values({
        slug: input.slug,
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
        reviewedBy: input.reviewedBy ?? null,
        reviewedAt: input.reviewedBy ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: kbSources.slug,
        set: {
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
          status: "active",
          reviewedBy: input.reviewedBy ?? null,
          reviewedAt: input.reviewedBy ? new Date() : null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: kbSources.id });

    if (!source) throw new Error(`falha ao gravar a fonte ${input.slug}`);

    await tx.delete(kbChunks).where(eq(kbChunks.sourceId, source.id));

    for (const [index, chunk] of chunks.entries()) {
      await tx.insert(kbChunks).values({
        sourceId: source.id,
        ord: chunk.ord,
        heading: chunk.heading,
        content: chunk.content,
        tokens: chunk.tokens,
        embedding: sql`${toVectorLiteral(embeddings[index]!)}::vector`,
        metadata: { shape: input.shape },
      });
    }
  });

  logInfo("kb.ingested", { slug: input.slug, chunks: chunks.length });
  return { slug: input.slug, status: "ingested", chunks: chunks.length };
}

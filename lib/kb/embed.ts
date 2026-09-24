import { openai } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";
import { serverEnv } from "@/lib/env";

/**
 * Embeddings da base de conhecimento.
 *
 * A dimensão do vetor está fixa em 1536 no schema (kb_chunks.embedding). Trocar
 * de modelo muda a dimensão e exige migration + reingestão completa — por isso
 * o modelo é configuração, mas não é troca trivial.
 */

function embeddingModel() {
  const env = serverEnv();
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY não está setado: sem ele não há embedding e a busca na base não funciona.",
    );
  }
  return openai.embedding(env.AI_EMBEDDING_MODEL);
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel(), value: text });
  return embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({ model: embeddingModel(), values: texts });
  return embeddings;
}

/** pgvector aceita o literal JSON `[1,2,3]`. */
export function toVectorLiteral(embedding: number[]): string {
  return JSON.stringify(embedding);
}

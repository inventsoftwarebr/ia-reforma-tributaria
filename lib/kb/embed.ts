import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";
import { serverEnv } from "@/lib/env";
import { EMBEDDING_DIMENSIONS } from "./dimensions";

/**
 * Embeddings da base de conhecimento.
 *
 * O documento e a pergunta são embutidos de jeitos diferentes: o Gemini
 * otimiza o vetor para busca assimétrica quando sabe se o texto é o que vai ser
 * achado (RETRIEVAL_DOCUMENT) ou o que procura (RETRIEVAL_QUERY).
 */

export type EmbeddingPurpose = "document" | "query";

type EmbeddingProvider = "google" | "openai";

type EmbeddingCallOptions = Record<string, Record<string, string | number>>;

/** Opções da chamada por provedor. Exportado para teste. */
export function embeddingCallOptions(
  provider: EmbeddingProvider,
  purpose: EmbeddingPurpose,
): EmbeddingCallOptions {
  if (provider === "google") {
    return {
      google: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
        taskType: purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
      },
    };
  }
  return { openai: { dimensions: EMBEDDING_DIMENSIONS } };
}

/**
 * Vetor com tamanho diferente do da coluna faria o insert falhar, ou pior, a
 * busca comparar coisas incomparáveis. Falha cedo, com mensagem que diz o que
 * fazer.
 */
export function assertDimensions(vectors: number[][]): void {
  for (const vector of vectors) {
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `embedding com ${vector.length} dimensões; o banco espera ${EMBEDDING_DIMENSIONS}. ` +
          "O modelo de embedding mudou? Ver lib/kb/dimensions.ts.",
      );
    }
  }
}

function embeddingModel() {
  const env = serverEnv();
  return env.EMBEDDING_PROVIDER === "openai"
    ? openai.embedding(env.AI_EMBEDDING_MODEL)
    : google.embedding(env.AI_EMBEDDING_MODEL);
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel(),
    value: text,
    providerOptions: embeddingCallOptions(serverEnv().EMBEDDING_PROVIDER, "query"),
  });
  assertDimensions([embedding]);
  return embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model: embeddingModel(),
    values: texts,
    providerOptions: embeddingCallOptions(serverEnv().EMBEDDING_PROVIDER, "document"),
  });
  assertDimensions(embeddings);
  return embeddings;
}

/** pgvector aceita o literal JSON `[1,2,3]`. */
export function toVectorLiteral(embedding: number[]): string {
  return JSON.stringify(embedding);
}

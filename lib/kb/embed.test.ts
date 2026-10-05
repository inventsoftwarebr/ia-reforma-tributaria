import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS } from "./dimensions";
import { assertDimensions, embeddingCallOptions } from "./embed";

describe("opções de embedding", () => {
  it("Gemini: documento e pergunta usam task types diferentes", () => {
    expect(embeddingCallOptions("google", "document")).toEqual({
      google: { outputDimensionality: 1536, taskType: "RETRIEVAL_DOCUMENT" },
    });
    expect(embeddingCallOptions("google", "query")).toEqual({
      google: { outputDimensionality: 1536, taskType: "RETRIEVAL_QUERY" },
    });
  });

  it("OpenAI: pede o mesmo tamanho de vetor", () => {
    expect(embeddingCallOptions("openai", "query")).toEqual({ openai: { dimensions: 1536 } });
  });

  it("o tamanho pedido é o mesmo da coluna do banco", () => {
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
  });
});

describe("trava de dimensão", () => {
  it("aceita vetor do tamanho da coluna", () => {
    expect(() => assertDimensions([new Array(1536).fill(0)])).not.toThrow();
  });

  it("recusa vetor de outro tamanho, com mensagem que diz o que fazer", () => {
    // 3072 é o padrão do gemini-embedding-2 quando outputDimensionality não vai.
    expect(() => assertDimensions([new Array(3072).fill(0)])).toThrow(/3072 dimensões.*1536/);
  });

  it("confere todos os vetores do lote", () => {
    expect(() =>
      assertDimensions([new Array(1536).fill(0), new Array(768).fill(0)]),
    ).toThrow(/768/);
  });
});

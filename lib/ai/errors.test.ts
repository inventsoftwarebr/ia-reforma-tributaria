import { describe, expect, it } from "vitest";
import { isDailyQuota, isTemporaryFailure } from "./errors";

// Texto real do erro em produção (Simulador, 26/10/2026).
const DIARIA = Object.assign(
  new Error(
    "You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/embed_content_free_tier_requests, limit: 1000, model: gemini-embedding-2, description: Embed content requests per day limit exceeded on Free Tier",
  ),
  { statusCode: 429 },
);
const embrulhado = (lastError: Error) =>
  Object.assign(new Error(`Failed after 3 attempts. Last error: ${lastError.message}`), {
    lastError,
  });

describe("isDailyQuota", () => {
  it("reconhece a cota diária do plano gratuito, mesmo embrulhada", () => {
    expect(isDailyQuota(embrulhado(DIARIA))).toBe(true);
  });

  it("limite por minuto não é cota diária", () => {
    const porMinuto = Object.assign(
      new Error("Quota exceeded for metric: embed_content_requests per minute"),
      { statusCode: 429 },
    );
    expect(isDailyQuota(porMinuto)).toBe(false);
    expect(isTemporaryFailure(porMinuto)).toBe(true);
  });
});

describe("isTemporaryFailure", () => {
  it("instabilidade (503) depois das tentativas do AI SDK", () => {
    const api = Object.assign(new Error("The service is currently unavailable"), {
      statusCode: 503,
    });
    expect(isTemporaryFailure(embrulhado(api))).toBe(true);
  });

  it("chave inválida não é temporária", () => {
    expect(
      isTemporaryFailure(
        Object.assign(new Error("API key not valid"), { statusCode: 400 }),
      ),
    ).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {} }));
const { textQueryTerms } = await import("./search");

describe("textQueryTerms", () => {
  it("liga as palavras relevantes com 'or' e ignora as curtas", () => {
    expect(textQueryTerms("O que é a CBS e o IBS?")).toBe("que or cbs or ibs");
  });

  it("mantém acentos e não repete", () => {
    expect(textQueryTerms("Crédito, crédito presumido; não cumulatividade")).toBe(
      "crédito or presumido or não or cumulatividade",
    );
  });

  it("pergunta sem palavra útil", () => {
    expect(textQueryTerms("é a?")).toBe("");
  });
});

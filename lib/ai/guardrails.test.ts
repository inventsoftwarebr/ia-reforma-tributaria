import { describe, expect, it } from "vitest";
import {
  REFUSAL_TEXT,
  applyGuardrails,
  extractNormReferences,
  hasNumericClaim,
  isOptOutRequest,
  normalizeNormReference,
  stripDisallowedLinks,
} from "./guardrails";

const BASE = { usedScheduleTool: false, availableNorms: [] as string[] };

describe("afirmação numérica", () => {
  it("reconhece percentual, valor e fração", () => {
    expect(hasNumericClaim("a CBS fica em 0,9% em 2026")).toBe(true);
    expect(hasNumericClaim("crédito de R$ 1.000")).toBe(true);
    expect(hasNumericClaim("reduz 9/10 das alíquotas de 2028")).toBe(true);
  });

  it("não acusa texto sem número relevante", () => {
    expect(hasNumericClaim("o IBS substitui ICMS e ISS")).toBe(false);
    expect(hasNumericClaim("a transição termina em 2033")).toBe(false);
  });
});

describe("referência de norma", () => {
  it("normaliza formatos diferentes da mesma norma", () => {
    expect(normalizeNormReference("LC 214/2025, art. 12")).toBe("lc 214/2025");
    expect(normalizeNormReference("Lei Complementar nº 214/2025")).toBe("lc 214/2025");
    expect(normalizeNormReference("EC 132/2023")).toBe("ec 132/2023");
    expect(normalizeNormReference("Emenda Constitucional 132/2023")).toBe("ec 132/2023");
    expect(normalizeNormReference("IN RFB 2.161/2023")).toBe("in 2161/2023");
  });

  it("devolve null quando não há norma", () => {
    expect(normalizeNormReference("segundo a base de conhecimento")).toBeNull();
  });

  it("extrai todas as normas de um texto, sem repetir", () => {
    const texto = "Ver (*LC 214/2025, art. 12*) e (*EC 132/2023*); a LC 214/2025 também trata disso.";
    expect(extractNormReferences(texto).sort()).toEqual(["ec 132/2023", "lc 214/2025"]);
  });
});

describe("links", () => {
  it("mantém domínio da Invent e do governo", () => {
    const invent = "https://lp.inventsoftware.com.br/simulador?utm_source=a+b";
    expect(stripDisallowedLinks(`veja ${invent}`).text).toContain(invent);
    expect(stripDisallowedLinks("https://www.planalto.gov.br/x").removed).toEqual([]);
  });

  it("remove domínio não autorizado e o que só imita o da Invent", () => {
    expect(stripDisallowedLinks("olha https://blogaleatorio.com/reforma").removed).toHaveLength(1);
    expect(stripDisallowedLinks("https://inventsoftware.com.br.fake.io/x").removed).toHaveLength(1);
  });
});

describe("guard-rails da resposta", () => {
  it("recusa número sem respaldo nenhum", () => {
    const verdict = applyGuardrails({ ...BASE, text: "A alíquota total vai ficar em 27,5%." });
    expect(verdict.ok).toBe(false);
    expect(verdict.text).toBe(REFUSAL_TEXT);
  });

  it("aceita número vindo do cronograma", () => {
    expect(
      applyGuardrails({ ...BASE, text: "Em 2026 a CBS fica em 0,9%.", usedScheduleTool: true }).ok,
    ).toBe(true);
  });

  it("aceita número citando norma que foi recuperada", () => {
    const verdict = applyGuardrails({
      text: "Em 2026 a CBS fica em 0,9% (*LC 214/2025, art. 12*).",
      usedScheduleTool: false,
      availableNorms: ["lc 214/2025"],
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.citedNorms).toEqual(["lc 214/2025"]);
  });

  it("recusa citação de norma que não foi recuperada", () => {
    const verdict = applyGuardrails({
      text: "Isso está na (*LC 999/2030, art. 4º*).",
      usedScheduleTool: true,
      availableNorms: ["lc 214/2025"],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe("fabricated_citation");
  });

  it("recusa citação inventada mesmo em resposta sem número", () => {
    const verdict = applyGuardrails({
      ...BASE,
      text: "O regime está previsto na Lei Complementar nº 300/2029.",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe("fabricated_citation");
  });

  it("aceita resposta sem número e sem citação", () => {
    expect(applyGuardrails({ ...BASE, text: "O IBS substitui ICMS e ISS." }).ok).toBe(true);
  });

  it("resposta vazia cai na recusa", () => {
    const verdict = applyGuardrails({ ...BASE, text: "   ", usedScheduleTool: true });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe("empty_answer");
  });

  it("remove link proibido antes de validar", () => {
    const verdict = applyGuardrails({ ...BASE, text: "Veja em https://naoautorizado.com/x" });
    expect(verdict.ok).toBe(true);
    expect(verdict.text).not.toContain("naoautorizado");
  });
});

describe("opt-out", () => {
  it("reconhece as palavras de saída", () => {
    for (const word of ["sair", "PARAR", "cancelar", "Descadastrar", "stop", "pare"]) {
      expect(isOptOutRequest(word)).toBe(true);
    }
    expect(isOptOutRequest("  não quero mais receber  ")).toBe(true);
  });

  it("não confunde com pergunta que contém a palavra", () => {
    expect(isOptOutRequest("posso parar de recolher PIS em 2027?")).toBe(false);
    expect(isOptOutRequest("o que muda para quem vai sair do Simples?")).toBe(false);
  });
});

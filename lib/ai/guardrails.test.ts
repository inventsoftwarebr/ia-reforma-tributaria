import { describe, expect, it } from "vitest";
import {
  REFUSAL_TEXT,
  applyGuardrails,
  hasCitation,
  hasNumericClaim,
  isOptOutRequest,
  stripDisallowedLinks,
} from "./guardrails";

describe("detecção de afirmação numérica", () => {
  it("reconhece percentual", () => {
    expect(hasNumericClaim("a CBS fica em 0,9% em 2026")).toBe(true);
    expect(hasNumericClaim("a alíquota é de 26.5 %")).toBe(true);
  });

  it("reconhece valor em real e fração", () => {
    expect(hasNumericClaim("o crédito é de R$ 1.000")).toBe(true);
    expect(hasNumericClaim("reduz 9/10 das alíquotas de 2028")).toBe(true);
  });

  it("não acusa texto sem número relevante", () => {
    expect(hasNumericClaim("o IBS substitui ICMS e ISS")).toBe(false);
    expect(hasNumericClaim("a LC 214/2025 trata do creditamento")).toBe(false);
  });
});

describe("citação", () => {
  it("reconhece o formato curto", () => {
    expect(hasCitation("a regra vale (*LC 214/2025, art. 12*)")).toBe(true);
    expect(hasCitation("previsto no ADCT (EC 132/2023)")).toBe(true);
  });

  it("não aceita menção solta", () => {
    expect(hasCitation("li na internet que muda tudo")).toBe(false);
  });
});

describe("links", () => {
  it("mantém domínio da Invent", () => {
    const link = "https://lp.inventsoftware.com.br/simulador?utm_source=a+b";
    expect(stripDisallowedLinks(`veja ${link}`).text).toContain(link);
  });

  it("mantém domínio oficial do governo", () => {
    const link = "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm";
    expect(stripDisallowedLinks(link).removed).toEqual([]);
  });

  it("remove domínio não autorizado", () => {
    const result = stripDisallowedLinks("olha em https://blogaleatorio.com/reforma");
    expect(result.removed).toEqual(["https://blogaleatorio.com/reforma"]);
    expect(result.text).not.toContain("blogaleatorio");
  });

  it("remove domínio parecido com o da Invent", () => {
    expect(
      stripDisallowedLinks("https://inventsoftware.com.br.fake.io/x").removed,
    ).toHaveLength(1);
  });
});

describe("guard-rails da resposta", () => {
  it("recusa número sem respaldo", () => {
    const verdict = applyGuardrails({
      text: "A alíquota total vai ficar em 27,5%.",
      usedScheduleTool: false,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.text).toBe(REFUSAL_TEXT);
  });

  it("aceita número vindo da tool de cronograma", () => {
    const verdict = applyGuardrails({
      text: "Em 2026 a CBS fica em 0,9%.",
      usedScheduleTool: true,
    });
    expect(verdict.ok).toBe(true);
  });

  it("aceita número com citação da norma", () => {
    const verdict = applyGuardrails({
      text: "Em 2026 a CBS fica em 0,9% (*EC 132/2023, ADCT*).",
      usedScheduleTool: false,
    });
    expect(verdict.ok).toBe(true);
  });

  it("aceita resposta sem número", () => {
    expect(
      applyGuardrails({ text: "O IBS substitui ICMS e ISS.", usedScheduleTool: false })
        .ok,
    ).toBe(true);
  });

  it("resposta vazia cai na recusa", () => {
    expect(applyGuardrails({ text: "   ", usedScheduleTool: true }).text).toBe(
      REFUSAL_TEXT,
    );
  });

  it("remove link proibido antes de validar", () => {
    const verdict = applyGuardrails({
      text: "Veja em https://naoautorizado.com/x",
      usedScheduleTool: false,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.text).not.toContain("naoautorizado");
  });
});

describe("opt-out", () => {
  it("reconhece as palavras de saída", () => {
    for (const word of ["sair", "PARAR", "cancelar", "Descadastrar", "stop", "pare"]) {
      expect(isOptOutRequest(word)).toBe(true);
    }
  });

  it("reconhece com acento e espaço", () => {
    expect(isOptOutRequest("  não quero mais receber  ")).toBe(true);
  });

  it("não confunde com pergunta que contém a palavra", () => {
    expect(isOptOutRequest("posso parar de recolher PIS em 2027?")).toBe(false);
    expect(isOptOutRequest("o que muda para quem vai sair do Simples Nacional?")).toBe(
      false,
    );
  });
});

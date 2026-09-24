import { describe, expect, it } from "vitest";
import { chunkDocument, chunkLegalText, chunkMarkdown, estimateTokens } from "./chunk";

const LEI = `
LEI COMPLEMENTAR Nº 214, DE 16 DE JANEIRO DE 2025

Institui o Imposto sobre Bens e Serviços, a Contribuição Social sobre Bens e Serviços
e o Imposto Seletivo, entre outras providências desta lei de teste usada aqui apenas
para exercitar o chunking com um preâmbulo suficientemente longo.

Art. 1º Esta Lei institui o IBS, a CBS e o Imposto Seletivo.

Art. 2º O IBS e a CBS incidem sobre operações com bens e serviços.
§ 1º A incidência não afasta o disposto no art. 3º.
§ 2º Consideram-se bens os materiais e imateriais.

Art. 3º-A Fica instituído regime específico para as operações de teste.
`;

describe("texto normativo", () => {
  it("gera um trecho por artigo", () => {
    const chunks = chunkLegalText(LEI);
    const headings = chunks.map((chunk) => chunk.heading);
    expect(headings).toContain("art. 1º");
    expect(headings).toContain("art. 2º");
    expect(headings).toContain("art. 3º-A");
  });

  it("mantém o preâmbulo como trecho próprio", () => {
    expect(chunkLegalText(LEI)[0]?.heading).toBe("preâmbulo");
  });

  it("não parte o artigo curto", () => {
    const artigo = chunkLegalText(LEI).find((chunk) => chunk.heading === "art. 2º");
    expect(artigo?.content).toContain("§ 1º");
    expect(artigo?.content).toContain("§ 2º");
  });

  it("subdivide artigo longo por parágrafo, mantendo o artigo no heading", () => {
    const longo = `Art. 12 ${"caput ".repeat(120)}
§ 1º ${"primeiro ".repeat(120)}
§ 2º ${"segundo ".repeat(120)}`;
    const chunks = chunkLegalText(longo);
    const headings = chunks.map((chunk) => chunk.heading);
    expect(headings).toContain("art. 12");
    expect(headings.some((heading) => heading?.includes("§ 1º"))).toBe(true);
    expect(headings.some((heading) => heading?.includes("§ 2º"))).toBe(true);
  });

  it("reconhece parágrafo único", () => {
    const texto = `Art. 5º ${"caput ".repeat(150)}
Parágrafo único. ${"unico ".repeat(150)}`;
    const headings = chunkLegalText(texto).map((chunk) => chunk.heading);
    expect(headings.some((heading) => heading?.includes("Parágrafo único"))).toBe(true);
  });

  it("ord é sequencial e sem buraco", () => {
    const chunks = chunkLegalText(LEI);
    expect(chunks.map((chunk) => chunk.ord)).toEqual(chunks.map((_, index) => index));
  });

  it("nenhum trecho sai vazio", () => {
    for (const chunk of chunkLegalText(LEI)) {
      expect(chunk.content.trim().length).toBeGreaterThan(0);
      expect(chunk.tokens).toBeGreaterThan(0);
    }
  });

  it("texto sem artigo cai no chunking de seção", () => {
    const chunks = chunkLegalText("## Perguntas\n\nResposta qualquer para o teste.");
    expect(chunks[0]?.heading).toBe("Perguntas");
  });
});

describe("material comum", () => {
  it("gera um trecho por seção", () => {
    const md = `# FAQ

## O que é a CBS?

Contribuição federal que substitui PIS e COFINS.

## O que é o IBS?

Imposto de estados e municípios que substitui ICMS e ISS.`;
    const chunks = chunkMarkdown(md);
    expect(chunks.map((chunk) => chunk.heading)).toEqual([
      "FAQ",
      "O que é a CBS?",
      "O que é o IBS?",
    ]);
  });

  it("divide seção longa sem estourar o limite", () => {
    const md = `## Seção

${"parágrafo de teste com algum tamanho.\n\n".repeat(40)}`;
    const chunks = chunkMarkdown(md, { maxChars: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(500);
      expect(chunk.heading).toBe("Seção");
    }
  });

  it("texto sem cabeçalho vira trecho sem heading", () => {
    const chunks = chunkMarkdown("Um texto corrido, sem estrutura nenhuma.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading).toBeNull();
  });

  it("texto vazio não gera trecho", () => {
    expect(chunkMarkdown("   ")).toEqual([]);
    expect(chunkLegalText("")).toEqual([]);
  });
});

describe("chunkDocument", () => {
  it("escolhe a estratégia pelo formato", () => {
    expect(chunkDocument(LEI, "legal").some((chunk) => chunk.heading === "art. 1º")).toBe(true);
    expect(chunkDocument("## A\n\ntexto", "markdown")[0]?.heading).toBe("A");
  });
});

describe("estimateTokens", () => {
  it("aproxima 4 caracteres por token", () => {
    expect(estimateTokens("12345678")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});

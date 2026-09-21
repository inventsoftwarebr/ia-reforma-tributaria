import { describe, expect, it } from "vitest";
import { splitForWhatsApp, toWhatsAppFormatting } from "./split";

describe("splitForWhatsApp", () => {
  it("texto curto fica em um bloco", () => {
    expect(splitForWhatsApp("resposta curta")).toEqual(["resposta curta"]);
  });

  it("texto vazio não gera bloco", () => {
    expect(splitForWhatsApp("   ")).toEqual([]);
  });

  it("quebra por parágrafo respeitando o limite", () => {
    const paragraph = "a".repeat(80);
    const blocks = splitForWhatsApp(`${paragraph}\n\n${paragraph}\n\n${paragraph}`, 100);
    expect(blocks).toHaveLength(3);
    for (const block of blocks) expect(block.length).toBeLessThanOrEqual(100);
  });

  it("agrupa parágrafos que caibam juntos", () => {
    const blocks = splitForWhatsApp("um\n\ndois\n\ntrês", 10);
    expect(blocks.join(" ")).toContain("um");
    expect(blocks.every((block) => block.length <= 10)).toBe(true);
  });

  it("quebra parágrafo longo por frase", () => {
    const sentence = `${"palavra ".repeat(12).trim()}.`;
    const blocks = splitForWhatsApp(`${sentence} ${sentence} ${sentence}`, 100);
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) expect(block.length).toBeLessThanOrEqual(100);
  });

  it("corta frase gigante sem estourar o limite", () => {
    const blocks = splitForWhatsApp("x".repeat(500), 100);
    for (const block of blocks) expect(block.length).toBeLessThanOrEqual(100);
    expect(blocks.join("").length).toBe(500);
  });

  it("nenhum bloco fica vazio", () => {
    const blocks = splitForWhatsApp("um\n\n\n\ndois".repeat(40), 120);
    expect(blocks.every((block) => block.trim().length > 0)).toBe(true);
  });
});

describe("toWhatsAppFormatting", () => {
  it("converte negrito do markdown", () => {
    expect(toWhatsAppFormatting("olha o **IBS** aqui")).toBe("olha o *IBS* aqui");
  });

  it("converte negrito com itálico", () => {
    expect(toWhatsAppFormatting("***muito***")).toBe("*muito*");
  });

  it("remove cabeçalho", () => {
    expect(toWhatsAppFormatting("## Transição\ntexto")).toBe("Transição\ntexto");
  });

  it("converte lista em bullet", () => {
    expect(toWhatsAppFormatting("- um\n- dois")).toBe("• um\n• dois");
  });

  it("preserva URL com barras", () => {
    const url = "https://lp.inventsoftware.com.br/simulador?utm_source=a+b";
    expect(toWhatsAppFormatting(url)).toBe(url);
  });

  it("preserva negrito que já está no formato do WhatsApp", () => {
    expect(toWhatsAppFormatting("*IBS*")).toBe("*IBS*");
  });
});

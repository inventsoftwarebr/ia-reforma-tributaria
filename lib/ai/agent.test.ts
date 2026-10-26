import { describe, expect, it } from "vitest";
import { allowedNorms, calledTool } from "./agent";

const step = (...names: string[]) => ({
  toolCalls: names.map((toolName) => ({ toolName })),
});

describe("calledTool", () => {
  it("acha a ferramenta em qualquer passo", () => {
    const steps = [step("buscar_base"), step(), step("solicitar_contato_humano")];
    expect(calledTool(steps, "solicitar_contato_humano")).toBe(true);
  });

  it("não acusa ferramenta que não foi chamada", () => {
    expect(
      calledTool([step("buscar_base", "cronograma_reforma")], "solicitar_contato_humano"),
    ).toBe(false);
  });

  it("resposta sem nenhum passo de ferramenta", () => {
    expect(calledTool([], "cronograma_reforma")).toBe(false);
    expect(calledTool([step()], "cronograma_reforma")).toBe(false);
  });
});

describe("allowedNorms", () => {
  const faq = {
    citationLabel: "FAQ Invent",
    content: "A CBS foi criada pela EC 132/2023 e regulamentada pela LC 214/2025.",
    authority: "invent" as const,
  };

  it("aceita a norma mencionada em material da Invent recuperado", () => {
    expect(allowedNorms([faq], false).sort()).toEqual(["ec 132/2023", "lc 214/2025"]);
  });

  it("aceita o rótulo do trecho oficial", () => {
    const lei = {
      citationLabel: "LC 214/2025",
      content: "Art. 1º ...",
      authority: "oficial" as const,
    };
    expect(allowedNorms([lei], false)).toEqual(["lc 214/2025"]);
  });

  it("imprensa não habilita citar a norma que menciona", () => {
    const noticia = {
      ...faq,
      citationLabel: "Portal de notícias",
      authority: "secundaria" as const,
    };
    expect(allowedNorms([noticia], false)).toEqual([]);
  });

  it("o cronograma habilita as normas dele", () => {
    expect(allowedNorms([], true)).toEqual(
      expect.arrayContaining(["ec 132/2023", "lc 214/2025"]),
    );
  });
});

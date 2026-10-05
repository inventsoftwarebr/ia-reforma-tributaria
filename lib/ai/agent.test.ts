import { describe, expect, it } from "vitest";
import { calledTool } from "./agent";

const step = (...names: string[]) => ({ toolCalls: names.map((toolName) => ({ toolName })) });

describe("calledTool", () => {
  it("acha a ferramenta em qualquer passo", () => {
    const steps = [step("buscar_base"), step(), step("solicitar_contato_humano")];
    expect(calledTool(steps, "solicitar_contato_humano")).toBe(true);
  });

  it("não acusa ferramenta que não foi chamada", () => {
    expect(calledTool([step("buscar_base", "cronograma_reforma")], "solicitar_contato_humano")).toBe(
      false,
    );
  });

  it("resposta sem nenhum passo de ferramenta", () => {
    expect(calledTool([], "cronograma_reforma")).toBe(false);
    expect(calledTool([step()], "cronograma_reforma")).toBe(false);
  });
});

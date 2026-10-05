import { describe, expect, it } from "vitest";
import { modelProviderOptions } from "./provider";

describe("opções do modelo por provedor", () => {
  it("Gemini raciocina pouco, para o raciocínio não comer a resposta", () => {
    expect(modelProviderOptions("google")).toEqual({
      google: { thinkingConfig: { thinkingLevel: "low" } },
    });
  });

  it("Anthropic não recebe opção específica", () => {
    expect(modelProviderOptions("anthropic")).toEqual({});
  });
});

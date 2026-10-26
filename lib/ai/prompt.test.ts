import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, buildSystemPrompt } from "./prompt";

const STATE = {
  isFirstInteraction: false,
  canOfferSimulator: false,
  simulatorAlreadyAccepted: false,
  today: "26/10/2026",
};

describe("modo de conhecimento", () => {
  it("padrão é orientação geral: explica sem a base, sem artigo nem número de memória", () => {
    const prompt = buildSystemPrompt({
      policy: DEFAULT_POLICY,
      context: "Nenhum trecho.",
      state: STATE,
    });
    expect(prompt).toMatch(/conhecimento\s+geral/);
    expect(prompt).toMatch(/Não cite número de artigo/);
    expect(prompt).toMatch(/Não informe alíquota, percentual, valor ou data de memória/);
    expect(prompt).not.toMatch(/não sustentam a resposta, diga isso/);
  });

  it("estrito: sem trecho, recusa e oferece especialista", () => {
    const prompt = buildSystemPrompt({
      policy: DEFAULT_POLICY,
      context: "Nenhum trecho.",
      state: STATE,
      mode: "estrito",
    });
    expect(prompt).toMatch(/não sustentam a resposta, diga isso/);
    expect(prompt).not.toMatch(/conhecimento\s+geral/);
  });
});

describe("posicionamento da Invent", () => {
  const prompt = buildSystemPrompt({ policy: DEFAULT_POLICY, context: "", state: STATE });

  it("TaxPlus é a solução fiscal principal", () => {
    expect(prompt).toMatch(/solução fiscal principal da Invent Software é o \*TaxPlus\*/);
  });

  it("simulador é ferramenta de apoio, não produto", () => {
    expect(prompt).toMatch(/simulador NÃO é produto nem solução da Invent/);
  });

  it("vale também quando o simulador ainda pode ser oferecido", () => {
    const comOferta = buildSystemPrompt({
      policy: DEFAULT_POLICY,
      context: "",
      state: { ...STATE, canOfferSimulator: true },
    });
    expect(comOferta).toMatch(/não um produto da Invent \(a solução\s+é o \*TaxPlus\*\)/);
  });
});

import { describe, expect, it } from "vitest";
import { INITIAL_STATE, nextState } from "./state";

describe("nextState", () => {
  it("depois da primeira resposta, deixa de ser primeira interação", () => {
    expect(nextState(INITIAL_STATE, []).isFirstInteraction).toBe(false);
  });

  it("simulador aceito não é oferecido de novo", () => {
    const state = nextState(INITIAL_STATE, [
      { name: "oferecer_simulador", input: { aceitou: true } },
    ]);
    expect(state).toMatchObject({
      canOfferSimulator: false,
      simulatorAlreadyAccepted: true,
    });
  });

  it("simulador recusado também não volta", () => {
    const state = nextState(INITIAL_STATE, [
      { name: "oferecer_simulador", input: { aceitou: false } },
    ]);
    expect(state).toMatchObject({
      canOfferSimulator: false,
      simulatorAlreadyAccepted: false,
    });
  });

  it("pedido de especialista marca o handoff", () => {
    expect(
      nextState(INITIAL_STATE, [{ name: "solicitar_contato_humano", input: {} }]).handoff,
    ).toBe(true);
  });

  it("não altera o estado recebido", () => {
    nextState(INITIAL_STATE, [{ name: "solicitar_contato_humano", input: {} }]);
    expect(INITIAL_STATE.handoff).toBe(false);
  });
});

import type { ToolCallSummary } from "@/lib/ai/agent";

/**
 * Estado da conversa simulada. No WhatsApp ele mora no banco
 * (conversation_state); no simulador, no navegador de quem testa, e volta a
 * cada pergunta — validado no servidor.
 */
export interface SimulatedState {
  isFirstInteraction: boolean;
  canOfferSimulator: boolean;
  simulatorAlreadyAccepted: boolean;
  /** Na vida real o bot ficaria em silêncio esperando um humano. */
  handoff: boolean;
}

export const INITIAL_STATE: SimulatedState = {
  isFirstInteraction: true,
  canOfferSimulator: true,
  simulatorAlreadyAccepted: false,
  handoff: false,
};

function accepted(input: unknown): boolean {
  return (
    typeof input === "object" &&
    input !== null &&
    (input as { aceitou?: unknown }).aceitou === true
  );
}

/** O que muda depois de um turno, conforme as ferramentas que o agente usou. */
export function nextState(
  state: SimulatedState,
  toolCalls: ToolCallSummary[],
): SimulatedState {
  const next: SimulatedState = { ...state, isFirstInteraction: false };
  for (const call of toolCalls) {
    if (call.name === "oferecer_simulador") {
      next.canOfferSimulator = false;
      if (accepted(call.input)) next.simulatorAlreadyAccepted = true;
    }
    if (call.name === "solicitar_contato_humano") next.handoff = true;
  }
  return next;
}

/** Nome das ferramentas na língua de quem lê o simulador. */
export const TOOL_LABELS: Record<string, string> = {
  buscar_base: "buscou mais trechos na base",
  cronograma_reforma: "consultou o cronograma oficial",
  oferecer_simulador: "ofereceu o simulador da Invent",
  solicitar_contato_humano: "pediu um especialista (lead iria ao HubSpot)",
};

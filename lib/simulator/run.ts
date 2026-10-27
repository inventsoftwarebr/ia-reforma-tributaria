import { z } from "zod";
import { answerQuestion } from "@/lib/ai/agent";
import { DAILY_QUOTA_MESSAGE, isDailyQuota } from "@/lib/ai/errors";
import { OPT_OUT_CONFIRMATION, isOptOutRequest } from "@/lib/ai/guardrails";
import { describeError, logError, logInfo } from "@/lib/observability/logger";
import { FALLBACK_ERROR } from "@/lib/turn/messages";
import { splitForWhatsApp } from "@/lib/whatsapp/split";
import { nextState, type SimulatedState } from "./state";

/**
 * Um turno do simulador do console: o mesmo caminho do WhatsApp (busca na
 * base, prompt ativo, modelo, guard-rails, divisão em blocos), sem gravar
 * conversa, sem métrica no painel, sem HubSpot e sem enviar nada.
 */

export const simulateInputSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  history: z
    .array(
      z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(6_000) }),
    )
    .max(20),
  state: z.object({
    isFirstInteraction: z.boolean(),
    canOfferSimulator: z.boolean(),
    simulatorAlreadyAccepted: z.boolean(),
    handoff: z.boolean(),
  }),
});

export type SimulateInput = z.infer<typeof simulateInputSchema>;

export interface SimulateResult {
  blocks: string[];
  state: SimulatedState;
  details: {
    refused: boolean;
    refusalReason: string | null;
    sources: string[];
    tools: string[];
    model: string;
    promptVersion: string;
    latencyMs: number;
    tokens: number;
    /** Falha técnica: o cliente veria a mensagem padrão de erro. */
    error: string | null;
    note: string | null;
  };
}

const NO_DETAILS = {
  refused: false,
  refusalReason: null,
  sources: [],
  tools: [],
  model: "—",
  promptVersion: "—",
  latencyMs: 0,
  tokens: 0,
  error: null,
};

export async function simulateTurn(
  input: SimulateInput,
  userId: string,
  channel: "whatsapp" | "site" = "whatsapp",
): Promise<SimulateResult> {
  // Mesma prioridade do WhatsApp: pedido de descadastro não passa pelo modelo.
  if (isOptOutRequest(input.question)) {
    return {
      blocks: [OPT_OUT_CONFIRMATION],
      state: { ...input.state, isFirstInteraction: false },
      details: {
        ...NO_DETAILS,
        note: "Pedido de descadastro: no WhatsApp o número deixaria de receber mensagens.",
      },
    };
  }

  try {
    const answer = await answerQuestion({
      conversationId: `simulador:${userId}`,
      question: input.question,
      history: input.history,
      state: {
        isFirstInteraction: input.state.isFirstInteraction,
        canOfferSimulator: input.state.canOfferSimulator,
        simulatorAlreadyAccepted: input.state.simulatorAlreadyAccepted,
        channel,
      },
      sandbox: true,
    });

    logInfo("simulator.turn", {
      userId,
      refused: answer.refused,
      tokens: answer.inputTokens + answer.outputTokens,
      latencyMs: answer.latencyMs,
    });

    return {
      blocks: splitForWhatsApp(answer.text),
      state: nextState(input.state, answer.toolCalls),
      details: {
        refused: answer.refused,
        refusalReason: answer.refusalReason,
        sources: answer.sources,
        tools: [...new Set(answer.toolCalls.map((call) => call.name))],
        model: answer.model,
        promptVersion: answer.promptVersion,
        latencyMs: answer.latencyMs,
        tokens: answer.inputTokens + answer.outputTokens,
        error: null,
        note:
          answer.sources.length === 0 && !answer.refused
            ? "Nenhum trecho da base cobriu a pergunta: resposta de orientação geral, sem fonte citada."
            : null,
      },
    };
  } catch (error) {
    logError("simulator.failed", error, { userId });
    return {
      blocks: [FALLBACK_ERROR],
      state: input.state,
      details: {
        ...NO_DETAILS,
        error: isDailyQuota(error)
          ? DAILY_QUOTA_MESSAGE
          : describeError(error).slice(0, 500),
        note: null,
      },
    };
  }
}

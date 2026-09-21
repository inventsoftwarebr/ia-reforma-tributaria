import { generateText, stepCountIs } from "ai";
import { serverEnv } from "@/lib/env";
import { logWarn } from "@/lib/observability/logger";
import { toWhatsAppFormatting } from "@/lib/whatsapp/split";
import { applyGuardrails } from "./guardrails";
import { PROMPT_VERSION, buildSystemPrompt, type PromptState } from "./prompt";
import { modelLabel, resolveModel } from "./provider";
import { cronogramaReforma } from "./tools/cronograma";
import { buildHandoffTool } from "./tools/handoff";
import { buildSimuladorTool } from "./tools/simulador";

export interface AgentInput {
  conversationId: string;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  state: PromptState;
}

export interface AgentResult {
  text: string;
  refused: boolean;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

const SCHEDULE_TOOL = "cronograma_reforma";

/**
 * Uma nova tentativa para erro transitório do provider (sobrecarga, timeout).
 * Mais que isso o usuário já percebe a demora; aí vale a mensagem de fallback.
 */
const RETRIES = 1;

export async function answerQuestion(input: AgentInput): Promise<AgentResult> {
  const env = serverEnv();
  const startedAt = Date.now();

  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const result = await generateText({
        model: resolveModel(),
        system: buildSystemPrompt(input.state),
        messages: [
          ...input.history.map((entry) => ({
            role: entry.role,
            content: entry.content,
          })),
          { role: "user" as const, content: input.question },
        ],
        tools: {
          [SCHEDULE_TOOL]: cronogramaReforma,
          oferecer_simulador: buildSimuladorTool(input.conversationId),
          solicitar_contato_humano: buildHandoffTool(input.conversationId),
        },
        stopWhen: stepCountIs(5),
        maxOutputTokens: env.AI_MAX_TOKENS_PER_TURN,
        temperature: 0.3,
      });

      const usedScheduleTool = result.steps.some((step) =>
        step.toolCalls.some((call) => call.toolName === SCHEDULE_TOOL),
      );

      const verdict = applyGuardrails({
        text: toWhatsAppFormatting(result.text),
        usedScheduleTool,
      });

      if (!verdict.ok) {
        logWarn("agent.guardrail_blocked", {
          conversationId: input.conversationId,
          reason: verdict.reason,
        });
      }

      return {
        text: verdict.text,
        refused: !verdict.ok,
        model: modelLabel(),
        promptVersion: PROMPT_VERSION,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) {
        logWarn("agent.retrying", {
          conversationId: input.conversationId,
          attempt: attempt + 1,
        });
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

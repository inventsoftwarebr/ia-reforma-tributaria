import { generateText, stepCountIs } from "ai";
import { serverEnv } from "@/lib/env";
import { buildContextBlock, searchKb, type RetrievedChunk } from "@/lib/kb/search";
import { logWarn } from "@/lib/observability/logger";
import { brazilDate } from "@/lib/time";
import { toWhatsAppFormatting } from "@/lib/whatsapp/split";
import { PHASES } from "@/lib/tax/schedule";
import {
  applyGuardrails,
  normalizeNormReference,
  type RefusalReason,
} from "./guardrails";
import { buildSystemPrompt, type PromptState } from "./prompt";
import { activePolicy } from "./prompt-store";
import { modelLabel, modelProviderOptions, resolveModel } from "./provider";
import { buildBuscarBaseTool } from "./tools/buscar-base";
import { cronogramaReforma } from "./tools/cronograma";
import { buildHandoffTool } from "./tools/handoff";
import { buildSimuladorTool } from "./tools/simulador";

export interface AgentInput {
  conversationId: string;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  state: Omit<PromptState, "today">;
}

export interface AgentResult {
  text: string;
  refused: boolean;
  refusalReason: RefusalReason | null;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  retrievedCount: number;
  citedChunkIds: string[];
  /** A pessoa pediu especialista neste turno: o lead deve ir ao HubSpot já. */
  handoffRequested: boolean;
}

const SCHEDULE_TOOL = "cronograma_reforma";
const HANDOFF_TOOL = "solicitar_contato_humano";

/** O agente chamou esta ferramenta em algum passo da resposta? */
export function calledTool(
  steps: readonly { toolCalls: readonly { toolName: string }[] }[],
  toolName: string,
): boolean {
  return steps.some((step) => step.toolCalls.some((call) => call.toolName === toolName));
}
const RETRIES = 1;

/**
 * Consulta de busca: a pergunta sozinha não basta em follow-up ("e para
 * serviços?"), então entram as últimas falas do usuário. Heurística barata; se
 * não bastar, o agente tem a ferramenta `buscar_base` para refinar.
 */
function buildSearchQuery(input: AgentInput): string {
  const lastUserTurns = input.history
    .filter((entry) => entry.role === "user")
    .slice(-2)
    .map((entry) => entry.content);

  return [...lastUserTurns, input.question].join(" ").slice(0, 600);
}

/** Normas que a resposta pode citar: as recuperadas, mais as do cronograma. */
function allowedNorms(chunks: RetrievedChunk[], usedScheduleTool: boolean): string[] {
  const norms = new Set<string>();

  for (const chunk of chunks) {
    const normalized = normalizeNormReference(chunk.citationLabel);
    if (normalized) norms.add(normalized);
  }

  if (usedScheduleTool) {
    for (const phase of PHASES) {
      const normalized = normalizeNormReference(phase.source);
      if (normalized) norms.add(normalized);
    }
  }

  return [...norms];
}

export async function answerQuestion(input: AgentInput): Promise<AgentResult> {
  const env = serverEnv();
  const startedAt = Date.now();

  const retrieved: RetrievedChunk[] = await searchKb(buildSearchQuery(input));
  const collected: RetrievedChunk[] = [...retrieved];

  const policy = await activePolicy();
  const system = buildSystemPrompt({
    policy: policy.content,
    context: buildContextBlock(retrieved),
    state: { ...input.state, today: brazilDate(new Date()) },
  });

  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const result = await generateText({
        model: resolveModel(),
        system,
        messages: [
          ...input.history.map((entry) => ({ role: entry.role, content: entry.content })),
          { role: "user" as const, content: input.question },
        ],
        tools: {
          buscar_base: buildBuscarBaseTool(collected),
          [SCHEDULE_TOOL]: cronogramaReforma,
          oferecer_simulador: buildSimuladorTool(input.conversationId),
          [HANDOFF_TOOL]: buildHandoffTool(input.conversationId),
        },
        stopWhen: stepCountIs(6),
        maxOutputTokens: env.AI_MAX_TOKENS_PER_TURN,
        temperature: 0.2,
        providerOptions: modelProviderOptions(env.AI_PROVIDER),
      });

      const usedScheduleTool = calledTool(result.steps, SCHEDULE_TOOL);

      const verdict = applyGuardrails({
        text: toWhatsAppFormatting(result.text),
        usedScheduleTool,
        availableNorms: allowedNorms(collected, usedScheduleTool),
      });

      if (!verdict.ok) {
        logWarn("agent.guardrail_blocked", {
          conversationId: input.conversationId,
          reason: verdict.reason,
          citedNorms: verdict.citedNorms,
        });
      }

      // Rastreia quais trechos sustentaram a resposta: recusa alta num tema é
      // lacuna de curadoria, não defeito do modelo.
      const citedChunkIds = verdict.ok
        ? collected
            .filter((chunk) => {
              const normalized = normalizeNormReference(chunk.citationLabel);
              return normalized !== null && verdict.citedNorms.includes(normalized);
            })
            .map((chunk) => chunk.chunkId)
        : [];

      return {
        text: verdict.text,
        refused: !verdict.ok,
        refusalReason: verdict.ok ? null : verdict.reason,
        model: modelLabel(),
        promptVersion: policy.version,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        latencyMs: Date.now() - startedAt,
        retrievedCount: collected.length,
        citedChunkIds: [...new Set(citedChunkIds)],
        handoffRequested: calledTool(result.steps, HANDOFF_TOOL),
      };
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) {
        logWarn("agent.retrying", { conversationId: input.conversationId, attempt: attempt + 1 });
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

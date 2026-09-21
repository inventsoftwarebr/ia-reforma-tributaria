import { tool } from "ai";
import { z } from "zod";
import { registerHandoff } from "@/lib/conversations/repository";
import { logInfo } from "@/lib/observability/logger";

/**
 * Abre handoff humano: marca a conversa e silencia o bot. O envio do lead ao
 * HubSpot entra na fase 3 (outbox) — o silenciamento não espera por isso,
 * porque o pior resultado é a pessoa pedir humano e o bot seguir respondendo.
 */
export function buildHandoffTool(conversationId: string) {
  return tool({
    description:
      "Registra que a pessoa quer falar com um especialista humano da Invent. Chame quando ela pedir proposta, cotação, demonstração, atendimento humano, ou quando o caso exigir análise individual.",
    inputSchema: z.object({
      reason: z
        .string()
        .min(3)
        .max(300)
        .describe("Em uma frase, o que a pessoa precisa. Vai para o time comercial."),
    }),
    execute: async ({ reason }) => {
      await registerHandoff(conversationId);
      logInfo("handoff.requested", { conversationId, reason });
      // TODO(fase 3): enfileirar em hubspot_outbox com consentimento registrado.
      return { registered: true };
    },
  });
}

import { tool } from "ai";
import { z } from "zod";
import { enqueueHubspotEvent, registerHandoff } from "@/lib/conversations/repository";
import { logInfo } from "@/lib/observability/logger";

/**
 * Handoff humano: marca a conversa, silencia o bot e enfileira o lead para o
 * HubSpot. O silenciamento não espera pela integração — o pior resultado é a
 * pessoa pedir humano e o bot continuar respondendo sozinho.
 */
export function buildHandoffTool(conversationId: string) {
  return tool({
    description:
      "Registra que a pessoa quer falar com um especialista humano da Invent. Chame quando ela pedir proposta, cotação, demonstração, atendimento humano, ou quando o caso exigir análise individual.",
    inputSchema: z.object({
      motivo: z
        .string()
        .min(3)
        .max(300)
        .describe("Em uma frase, o que a pessoa precisa. Vai para o time comercial."),
      empresa: z.string().max(120).optional().describe("Nome da empresa, se ela disse."),
      segmento: z.string().max(120).optional().describe("Segmento ou setor, se ela disse."),
      erp: z.string().max(120).optional().describe("ERP em uso, se ela disse."),
    }),
    execute: async ({ motivo, empresa, segmento, erp }) => {
      await registerHandoff(conversationId, { motivo, empresa, segmento, erp });
      await enqueueHubspotEvent({
        conversationId,
        eventType: "handoff_requested",
        payload: { motivo, empresa, segmento, erp },
      });
      logInfo("handoff.requested", { conversationId, motivo });
      return { registrado: true };
    },
  });
}

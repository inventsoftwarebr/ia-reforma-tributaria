import { tool } from "ai";
import { z } from "zod";
import {
  registerSimulatorAccepted,
  registerSimulatorDeclined,
  registerSimulatorOffer,
} from "@/lib/conversations/repository";
import { simulatorLink } from "@/lib/env";

/**
 * Entrega o link do simulador e registra no banco. O modelo não escreve a URL:
 * a UTM de campanha fica em configuração e a aceitação vira métrica.
 */
export function buildSimuladorTool(conversationId: string) {
  return tool({
    description:
      "Envia o link do Simulador da Reforma Tributária da Invent. Chame APENAS depois de a pessoa aceitar. Devolve o link já com a campanha; use exatamente como veio. Se a pessoa recusou, chame com aceitou=false para registrar e não oferecer de novo.",
    inputSchema: z.object({
      aceitou: z.boolean().describe("true se a pessoa aceitou receber o simulador."),
    }),
    execute: async ({ aceitou }) => {
      if (!aceitou) {
        await registerSimulatorDeclined(conversationId);
        return { enviado: false, motivo: "Recusa registrada: não ofereça novamente." };
      }
      await registerSimulatorOffer(conversationId);
      await registerSimulatorAccepted(conversationId);
      return { enviado: true, url: simulatorLink() };
    },
  });
}

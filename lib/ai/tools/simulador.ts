import { tool } from "ai";
import { z } from "zod";
import { simulatorLink } from "@/lib/env";
import {
  registerSimulatorAccepted,
  registerSimulatorOffer,
} from "@/lib/conversations/repository";

/**
 * Entrega o link do simulador e registra a oferta no banco. O modelo não
 * escreve a URL: assim a UTM de campanha fica em configuração, não no prompt
 * (achado P5), e a aceitação virá medida.
 */
export function buildSimuladorTool(conversationId: string) {
  return tool({
    description:
      "Envia o link do Simulador da Reforma Tributária da Invent. Chame APENAS depois de a pessoa aceitar a oferta. Devolve o link já com a campanha; use o link exatamente como veio.",
    inputSchema: z.object({
      confirmedByUser: z
        .boolean()
        .describe("true somente se a pessoa aceitou receber o simulador nesta conversa."),
    }),
    execute: async ({ confirmedByUser }) => {
      if (!confirmedByUser) {
        return {
          sent: false,
          reason: "Pergunte antes se a pessoa quer conhecer o simulador.",
        };
      }
      await registerSimulatorOffer(conversationId);
      await registerSimulatorAccepted(conversationId);
      return { sent: true, url: simulatorLink() };
    },
  });
}

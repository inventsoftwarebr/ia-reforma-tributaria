import { tool } from "ai";
import { z } from "zod";
import { buildContextBlock, searchKb, type RetrievedChunk } from "@/lib/kb/search";
import { logInfo } from "@/lib/observability/logger";

/**
 * Busca extra na base, para quando os trechos pré-carregados não bastam.
 *
 * Tudo que o agente recupera entra no `collector`: é dele que sai a lista de
 * normas permitidas na verificação de citação. Sem isso, um trecho buscado pela
 * ferramenta seria citado e o guard-rail trataria como invenção.
 */
export function buildBuscarBaseTool(collector: RetrievedChunk[]) {
  return tool({
    description:
      "Busca trechos da base curada da Invent sobre Reforma Tributária. Use quando os trechos já recebidos não cobrirem a pergunta, reformulando com os termos técnicos corretos (ex.: 'split payment', 'crédito presumido', 'regime específico').",
    inputSchema: z.object({
      consulta: z
        .string()
        .min(3)
        .max(300)
        .describe("O que buscar, em português, com os termos técnicos."),
    }),
    execute: async ({ consulta }) => {
      const chunks = await searchKb(consulta);
      collector.push(...chunks);
      logInfo("kb.tool_search", { consulta, encontrados: chunks.length });
      return {
        encontrados: chunks.length,
        trechos: buildContextBlock(chunks),
      };
    },
  });
}

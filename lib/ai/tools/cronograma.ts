import { tool } from "ai";
import { z } from "zod";
import {
  PHASES,
  REVISAO_AVISO,
  REVISAO_PENDENTE,
  currentPhase,
  phasesForYear,
} from "@/lib/tax/schedule";

/**
 * Única fonte de número do agente: alíquota, fração e data saem daqui, nunca
 * da cabeça do modelo. Ver CLAUDE.md §3.
 */
export const cronogramaReforma = tool({
  description:
    "Cronograma oficial da Reforma Tributária: anos, fases, alíquotas previstas e a norma de cada informação. Use SEMPRE que a resposta envolver alíquota, percentual, prazo, data ou fase da transição. Nunca estime esses valores sem chamar esta ferramenta.",
  inputSchema: z.object({
    year: z
      .number()
      .int()
      .min(2023)
      .max(2040)
      .optional()
      .describe("Ano específico. Omita para receber o cronograma completo."),
  }),
  execute: ({ year }) => {
    const entries = year ? phasesForYear(year) : [...PHASES];
    return {
      entries,
      currentPhase: currentPhase(),
      warning: REVISAO_PENDENTE ? REVISAO_AVISO : null,
    };
  },
});

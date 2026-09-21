/**
 * Cronograma e alíquotas de referência da Reforma Tributária.
 *
 * ESTA É A ÚNICA ORIGEM DE NÚMERO DO AGENTE. O modelo não estima alíquota nem
 * data: ele chama a tool `cronograma_reforma`, que lê daqui. Ver CLAUDE.md §3.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ REVISÃO FISCAL PENDENTE                                                  │
 * │ Conteúdo compilado a partir da EC 132/2023 e da LC 214/2025 para dar     │
 * │ forma à estrutura de dados. Antes de ir a produção, o time fiscal da     │
 * │ Invent precisa conferir cada linha contra o texto vigente e zerar        │
 * │ REVISAO_PENDENTE. Enquanto estiver true, toda resposta que usa a tool    │
 * │ carrega o aviso de conteúdo não homologado.                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

export const REVISAO_PENDENTE = true;

export const REVISAO_AVISO =
  "Conteúdo de cronograma ainda não homologado pelo time fiscal da Invent: apresente como referência e recomende confirmação.";

export interface PhaseEntry {
  year: number;
  label: string;
  summary: string;
  /** Alíquotas ou frações explicitamente previstas para o ano. */
  rates: { tribute: string; value: string }[];
  /** Norma de onde a informação vem, para citação. */
  source: string;
  /** Marca o que precisa de conferência mais cuidadosa na revisão fiscal. */
  needsReview: boolean;
}

export const PHASES: readonly PhaseEntry[] = [
  {
    year: 2023,
    label: "Promulgação da emenda",
    summary:
      "A EC 132/2023 cria o IBS (estadual e municipal), a CBS (federal) e o Imposto Seletivo, e define o desenho da transição.",
    rates: [],
    source: "EC 132/2023",
    needsReview: false,
  },
  {
    year: 2025,
    label: "Lei geral",
    summary:
      "A LC 214/2025 institui e regulamenta IBS, CBS e Imposto Seletivo, tratando de base de cálculo, creditamento, regimes específicos e a operação do Comitê Gestor do IBS.",
    rates: [],
    source: "LC 214/2025",
    needsReview: false,
  },
  {
    year: 2026,
    label: "Ano-teste",
    summary:
      "Começa a cobrança em alíquota reduzida, com finalidade de teste e ajuste de sistemas. O valor recolhido pode ser compensado conforme as regras de transição.",
    rates: [
      { tribute: "CBS", value: "0,9%" },
      { tribute: "IBS", value: "0,1%" },
    ],
    source: "EC 132/2023, art. 125 do ADCT; LC 214/2025",
    needsReview: true,
  },
  {
    year: 2027,
    label: "CBS plena e fim de PIS/COFINS",
    summary:
      "A CBS passa a ser cobrada integralmente e PIS e COFINS são extintos. O Imposto Seletivo entra em vigor. O IPI é reduzido, com tratamento específico para a Zona Franca de Manaus.",
    rates: [{ tribute: "CBS", value: "alíquota de referência integral" }],
    source: "EC 132/2023, ADCT; LC 214/2025",
    needsReview: true,
  },
  {
    year: 2029,
    label: "Início da transição de ICMS e ISS",
    summary:
      "ICMS e ISS começam a ser reduzidos progressivamente enquanto o IBS sobe, até a extinção. A redução é aplicada em frações anuais sobre as alíquotas vigentes em 2028.",
    rates: [{ tribute: "ICMS/ISS", value: "fração decrescente a confirmar na revisão" }],
    source: "EC 132/2023, ADCT",
    needsReview: true,
  },
  {
    year: 2033,
    label: "Sistema novo pleno",
    summary:
      "IBS e CBS passam a vigorar integralmente e os tributos substituídos deixam de existir.",
    rates: [],
    source: "EC 132/2023, ADCT",
    needsReview: true,
  },
];

export function phasesForYear(year: number): PhaseEntry[] {
  return PHASES.filter((phase) => phase.year === year);
}

/** Fase vigente numa data, isto é, a última fase iniciada até ali. */
export function currentPhase(reference: Date = new Date()): PhaseEntry | null {
  const year = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
    }).format(reference),
  );
  const started = PHASES.filter((phase) => phase.year <= year);
  return started.at(-1) ?? null;
}

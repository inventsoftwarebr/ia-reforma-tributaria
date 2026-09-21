/**
 * Guard-rails aplicados no código, não só no prompt. CLAUDE.md §1, §2, §3.
 *
 * O fluxo n8n original mandava o modelo "nunca dizer que não tem informação".
 * Aqui é o contrário: resposta com número sem respaldo é bloqueada e trocada
 * pela recusa, que oferece contato humano.
 */

/** Domínios que o agente pode linkar. Qualquer outro é removido da resposta. */
const ALLOWED_LINK_HOSTS = [
  "inventsoftware.com.br",
  "www.inventsoftware.com.br",
  "lp.inventsoftware.com.br",
  "gov.br",
  "www.gov.br",
  "planalto.gov.br",
  "www.planalto.gov.br",
];

export const REFUSAL_TEXT =
  "Essa parte eu não consigo confirmar na nossa base técnica, e prefiro não arriscar um palpite em cima de tributo. Quer que eu chame um especialista da *Invent* para te responder com segurança?";

export const AI_DISCLAIMER =
  "Minhas respostas são geradas por IA e podem conter erros — vale confirmar com seu contador.";

/** Percentual, valor em real ou fração — o que exige respaldo. */
const NUMERIC_CLAIM =
  /(\d+(?:[.,]\d+)?\s*%)|(R\$\s*\d)|(\d+\/\d+\s+(?:da|das|do|dos)\s)/i;

/** Citação no formato curto: (*LC 214/2025, art. 12*) ou (EC 132/2023). */
const CITATION = /\(\s*\*?\s*(LC|EC|LEI|IN|ADCT|MP|Decreto|art\.)/i;

export function hasNumericClaim(text: string): boolean {
  return NUMERIC_CLAIM.test(text);
}

export function hasCitation(text: string): boolean {
  return CITATION.test(text);
}

function hostAllowed(host: string): boolean {
  return ALLOWED_LINK_HOSTS.includes(host.toLowerCase());
}

/**
 * Remove URL de domínio não autorizado. Um modelo que inventa link manda a
 * pessoa para fora do controle da Invent — e link inventado costuma ser 404.
 */
export function stripDisallowedLinks(text: string): {
  text: string;
  removed: string[];
} {
  const removed: string[] = [];
  const cleaned = text.replace(/https?:\/\/[^\s<>)"']+/gi, (match) => {
    try {
      const url = new URL(match);
      if (hostAllowed(url.hostname)) return match;
    } catch {
      // URL malformada cai no mesmo tratamento de domínio não autorizado.
    }
    removed.push(match);
    return "";
  });

  return { text: cleaned.replace(/[ \t]{2,}/g, " ").trim(), removed };
}

export type GuardrailVerdict =
  | { ok: true; text: string }
  | { ok: false; reason: "numeric_claim_without_support"; text: string };

/**
 * Valida a resposta antes do envio. Número só passa quando veio da tool de
 * cronograma ou acompanhado de citação da norma.
 */
export function applyGuardrails(input: {
  text: string;
  usedScheduleTool: boolean;
}): GuardrailVerdict {
  const { text: withoutBadLinks } = stripDisallowedLinks(input.text);
  const text = withoutBadLinks.trim();

  if (!text) {
    return { ok: false, reason: "numeric_claim_without_support", text: REFUSAL_TEXT };
  }

  if (hasNumericClaim(text) && !input.usedScheduleTool && !hasCitation(text)) {
    return { ok: false, reason: "numeric_claim_without_support", text: REFUSAL_TEXT };
  }

  return { ok: true, text };
}

/** Palavras de saída do canal. LGPD: opt-out sempre disponível. CLAUDE.md §13. */
const OPT_OUT_WORDS = [
  "sair",
  "parar",
  "pare",
  "cancelar",
  "descadastrar",
  "remover meu contato",
  "não quero mais receber",
  "stop",
];

export function isOptOutRequest(text: string): boolean {
  const normalized = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (normalized.length > 40) return false;
  return OPT_OUT_WORDS.some((word) => {
    const target = word.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return normalized === target || normalized.startsWith(`${target} `);
  });
}

export const OPT_OUT_CONFIRMATION =
  "Pronto, não vou mais te enviar mensagens por aqui. Se mudar de ideia, basta escrever de novo. 👋";

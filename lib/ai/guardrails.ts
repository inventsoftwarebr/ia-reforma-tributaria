/**
 * Guard-rails aplicados no código, não só no prompt.
 *
 * Prompt pede; código garante. Três regras:
 * 1. Afirmação com número exige respaldo — trecho recuperado ou cronograma.
 * 2. Norma citada tem que estar entre as que foram realmente recuperadas:
 *    citação inventada é pior que ausência de citação, porque parece confiável.
 * 3. Link só de domínio autorizado.
 */

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

/** Percentual, valor em real ou fração: o que precisa de respaldo. */
const NUMERIC_CLAIM = /(\d+(?:[.,]\d+)?\s*%)|(R\$\s*\d)|(\d+\/\d+\s+(?:da|das|do|dos)\s)/i;

/**
 * Identificador de norma dentro do texto: "LC 214/2025", "EC 132/2023",
 * "Lei Complementar nº 214/2025", "IN RFB 2.161/2023".
 */
const NORM_PATTERN =
  String.raw`\b(EC|LC|IN(?:\s+RFB)?|MP|ADE|Emenda Constitucional|Lei Complementar|Lei|Decreto|Resolução)\s*(?:n[º°o]?\.?\s*)?(\d[\d.]*\/\d{4})`;

/**
 * Um regex por chamada: objeto global compartilhado carrega `lastIndex` entre
 * funções e, num laço que chama a outra, o reset faz o `exec` nunca terminar.
 */
function normPattern(global: boolean): RegExp {
  return new RegExp(NORM_PATTERN, global ? "gi" : "i");
}

const ABBREVIATION: Record<string, string> = {
  "emenda constitucional": "ec",
  "lei complementar": "lc",
  ec: "ec",
  lc: "lc",
  lei: "lei",
  in: "in",
  "in rfb": "in",
  mp: "mp",
  ade: "ade",
  decreto: "decreto",
  resolução: "resolucao",
};

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** "Lei Complementar nº 214/2025, art. 12" → "lc 214/2025" */
export function normalizeNormReference(label: string): string | null {
  const match = normPattern(false).exec(label);
  if (!match) return null;

  const kind = stripAccents(match[1]!.toLowerCase().replace(/\s+/g, " ").trim());
  const number = match[2]!.replace(/\./g, "");
  return `${ABBREVIATION[kind] ?? kind} ${number}`;
}

/** Todas as normas citadas num texto, normalizadas e sem repetição. */
export function extractNormReferences(text: string): string[] {
  const pattern = normPattern(true);
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const normalized = normalizeNormReference(match[0]);
    if (normalized) found.add(normalized);
  }
  return [...found];
}

export function hasNumericClaim(text: string): boolean {
  return NUMERIC_CLAIM.test(text);
}

function hostAllowed(host: string): boolean {
  return ALLOWED_LINK_HOSTS.includes(host.toLowerCase());
}

export function stripDisallowedLinks(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const cleaned = text.replace(/https?:\/\/[^\s<>)"']+/gi, (match) => {
    try {
      const url = new URL(match);
      if (hostAllowed(url.hostname)) return match;
    } catch {
      // URL malformada recebe o mesmo tratamento de domínio não autorizado.
    }
    removed.push(match);
    return "";
  });

  return { text: cleaned.replace(/[ \t]{2,}/g, " ").trim(), removed };
}

export type RefusalReason =
  | "empty_answer"
  | "numeric_claim_without_support"
  | "fabricated_citation";

export type GuardrailVerdict =
  | { ok: true; text: string; citedNorms: string[] }
  | { ok: false; reason: RefusalReason; text: string; citedNorms: string[] };

export interface GuardrailInput {
  text: string;
  /** O agente chamou a ferramenta de cronograma nesta resposta. */
  usedScheduleTool: boolean;
  /** Normas dos trechos efetivamente recuperados, já normalizadas. */
  availableNorms: string[];
}

export function applyGuardrails(input: GuardrailInput): GuardrailVerdict {
  const { text: cleaned } = stripDisallowedLinks(input.text);
  const text = cleaned.trim();

  if (!text) {
    return { ok: false, reason: "empty_answer", text: REFUSAL_TEXT, citedNorms: [] };
  }

  const citedNorms = extractNormReferences(text);
  const available = new Set(input.availableNorms);

  // Citação que não veio da base é invenção com cara de fonte.
  const fabricated = citedNorms.filter((norm) => !available.has(norm));
  if (fabricated.length > 0) {
    return { ok: false, reason: "fabricated_citation", text: REFUSAL_TEXT, citedNorms };
  }

  if (hasNumericClaim(text) && !input.usedScheduleTool && citedNorms.length === 0) {
    return {
      ok: false,
      reason: "numeric_claim_without_support",
      text: REFUSAL_TEXT,
      citedNorms,
    };
  }

  return { ok: true, text, citedNorms };
}

/** Palavras de saída do canal. Opt-out sempre disponível (LGPD). */
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
  const normalized = stripAccents(text.toLowerCase()).trim();
  if (normalized.length > 40) return false;
  return OPT_OUT_WORDS.some((word) => {
    const target = stripAccents(word);
    return normalized === target || normalized.startsWith(`${target} `);
  });
}

export const OPT_OUT_CONFIRMATION =
  "Pronto, não vou mais te enviar mensagens por aqui. Se mudar de ideia, basta escrever de novo. 👋";

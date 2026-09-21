/**
 * Quebra a resposta em blocos enviáveis pelo WhatsApp.
 *
 * Mensagem longa em bloco único é ruim de ler no celular e o provider pode
 * truncar. A quebra respeita parágrafo, depois frase, e só corta no meio de um
 * trecho quando não há alternativa.
 */

const DEFAULT_MAX = 900;

function splitLongParagraph(paragraph: string, maxLength: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?…])\s+/);
  const blocks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) blocks.push(current.trim());
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      flush();
      // Último recurso: corta em espaço, para não partir palavra.
      let rest = sentence;
      while (rest.length > maxLength) {
        const slice = rest.slice(0, maxLength);
        const cut = slice.lastIndexOf(" ");
        const at = cut > maxLength * 0.6 ? cut : maxLength;
        blocks.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      current = rest;
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxLength) {
      flush();
      current = sentence;
    } else {
      current = candidate;
    }
  }

  flush();
  return blocks;
}

export function splitForWhatsApp(
  text: string,
  maxLength: number = DEFAULT_MAX,
): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxLength) return [normalized];

  const blocks: string[] = [];
  let current = "";

  for (const paragraph of normalized.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    if (trimmed.length > maxLength) {
      if (current) {
        blocks.push(current);
        current = "";
      }
      blocks.push(...splitLongParagraph(trimmed, maxLength));
      continue;
    }

    const candidate = current ? `${current}\n\n${trimmed}` : trimmed;
    if (candidate.length > maxLength) {
      blocks.push(current);
      current = trimmed;
    } else {
      current = candidate;
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

/**
 * O WhatsApp não entende `**negrito**` do markdown — mostra os asteriscos. Os
 * modelos escrevem assim mesmo quando instruídos, então normalizamos na saída.
 */
export function toWhatsAppFormatting(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/gs, "*$1*")
    .replace(/\*\*(.+?)\*\*/gs, "*$1*")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ");
}

/**
 * Chunking estrutural.
 *
 * Cortar texto legal a cada N caracteres separa o caput do parágrafo que o
 * altera, e aí a resposta cita o dispositivo errado. Aqui o corte segue a
 * estrutura do documento: artigo em texto normativo, seção em material comum.
 * Cada trecho carrega o dispositivo em `heading`, que é o que permite citar
 * "LC 214/2025, art. 12, §3º" em vez de "segundo a base de conhecimento".
 */

export interface Chunk {
  ord: number;
  heading: string | null;
  content: string;
  tokens: number;
}

export interface ChunkOptions {
  /** Acima disso o trecho é subdividido. ~1500 caracteres ≈ 375 tokens. */
  maxChars?: number;
  /** Abaixo disso o trecho é grudado no anterior, para não virar ruído. */
  minChars?: number;
}

const DEFAULTS = { maxChars: 1500, minChars: 120 } as const;

/** Estimativa suficiente para orçamento de contexto: ~4 caracteres por token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const ARTICLE = /^[ \t]*Art(?:igo)?\.?[ \t]*(\d+[ºo°]?(?:-[A-Z])?)/gim;
const PARAGRAPH = /^[ \t]*(§[ \t]*\d+[ºo°]?|Parágrafo único)/gim;
const MD_HEADING = /^(#{1,6})[ \t]+(.+)$/gm;

function normalizeArticle(raw: string): string {
  return `art. ${raw.replace(/[ºo°]/g, "º").trim()}`;
}

function cut(text: string, starts: number[]): { start: number; end: number }[] {
  return starts.map((start, index) => ({
    start,
    end: index + 1 < starts.length ? starts[index + 1]! : text.length,
  }));
}

/** Divide um artigo longo nos parágrafos, mantendo o artigo no heading. */
function splitArticle(body: string, articleHeading: string, maxChars: number): Chunk[] {
  PARAGRAPH.lastIndex = 0;
  const marks: { at: number; label: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = PARAGRAPH.exec(body)) !== null) {
    marks.push({ at: match.index, label: match[1]!.replace(/\s+/g, " ").trim() });
  }

  if (marks.length === 0) {
    return splitByParagraphBreak(body, articleHeading, maxChars);
  }

  const chunks: Chunk[] = [];
  const caput = body.slice(0, marks[0]!.at).trim();
  if (caput) {
    chunks.push({ ord: 0, heading: articleHeading, content: caput, tokens: estimateTokens(caput) });
  }

  for (const [index, mark] of marks.entries()) {
    const end = index + 1 < marks.length ? marks[index + 1]!.at : body.length;
    const content = body.slice(mark.at, end).trim();
    if (!content) continue;
    chunks.push({
      ord: chunks.length,
      heading: `${articleHeading}, ${mark.label}`,
      content,
      tokens: estimateTokens(content),
    });
  }

  return chunks;
}

/** Último recurso: quebra em parágrafos de texto, sem partir frase. */
function splitByParagraphBreak(body: string, heading: string | null, maxChars: number): Chunk[] {
  const text = body.trim();
  if (text.length <= maxChars) {
    return text ? [{ ord: 0, heading, content: text, tokens: estimateTokens(text) }] : [];
  }

  const chunks: Chunk[] = [];
  let current = "";

  const flush = () => {
    const content = current.trim();
    if (content) {
      chunks.push({ ord: chunks.length, heading, content, tokens: estimateTokens(content) });
    }
    current = "";
  };

  for (const block of text.split(/\n{2,}/)) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > maxChars && current) {
      flush();
      current = block;
    } else {
      current = candidate;
    }
  }
  flush();

  return chunks.map((chunk, ord) => ({ ...chunk, ord }));
}

/** Texto normativo: um trecho por artigo, subdividido por parágrafo se grande. */
export function chunkLegalText(text: string, options: ChunkOptions = {}): Chunk[] {
  const { maxChars, minChars } = { ...DEFAULTS, ...options };
  ARTICLE.lastIndex = 0;

  const starts: number[] = [];
  const labels: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = ARTICLE.exec(text)) !== null) {
    starts.push(match.index);
    labels.push(normalizeArticle(match[1]!));
  }

  if (starts.length === 0) return chunkMarkdown(text, options);

  const chunks: Chunk[] = [];

  const preamble = text.slice(0, starts[0]!).trim();
  if (preamble.length >= minChars) {
    chunks.push(...splitByParagraphBreak(preamble, "preâmbulo", maxChars));
  }

  for (const [index, range] of cut(text, starts).entries()) {
    const body = text.slice(range.start, range.end).trim();
    if (!body) continue;
    const heading = labels[index]!;
    const pieces =
      body.length > maxChars
        ? splitArticle(body, heading, maxChars)
        : [{ ord: 0, heading, content: body, tokens: estimateTokens(body) }];
    chunks.push(...pieces);
  }

  return chunks.map((chunk, ord) => ({ ...chunk, ord }));
}

/** Material comum (FAQ, nota, artigo): um trecho por seção de cabeçalho. */
export function chunkMarkdown(text: string, options: ChunkOptions = {}): Chunk[] {
  const { maxChars, minChars } = { ...DEFAULTS, ...options };
  MD_HEADING.lastIndex = 0;

  const starts: number[] = [];
  const labels: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = MD_HEADING.exec(text)) !== null) {
    starts.push(match.index);
    labels.push(match[2]!.trim());
  }

  if (starts.length === 0) return splitByParagraphBreak(text, null, maxChars);

  const chunks: Chunk[] = [];

  const intro = text.slice(0, starts[0]!).trim();
  if (intro.length >= minChars) {
    chunks.push(...splitByParagraphBreak(intro, null, maxChars));
  }

  for (const [index, range] of cut(text, starts).entries()) {
    const body = text.slice(range.start, range.end).trim();
    if (!body) continue;
    chunks.push(...splitByParagraphBreak(body, labels[index]!, maxChars));
  }

  return chunks.map((chunk, ord) => ({ ...chunk, ord }));
}

export type DocumentShape = "legal" | "markdown";

export function chunkDocument(text: string, shape: DocumentShape, options?: ChunkOptions): Chunk[] {
  return shape === "legal" ? chunkLegalText(text, options) : chunkMarkdown(text, options);
}

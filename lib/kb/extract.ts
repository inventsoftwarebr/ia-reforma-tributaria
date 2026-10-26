import { decodeHTML } from "entities";

/**
 * Extração de texto para a base: página de site oficial (HTML), PDF, Word e
 * texto puro. O resultado alimenta o chunking estrutural (lib/kb/chunk.ts), que
 * depende de cada "Art." começar numa linha própria — por isso a conversão de
 * HTML respeita os blocos em vez de só arrancar as tags.
 */

/** Elementos descartados com todo o conteúdo. */
const DROP_ELEMENTS = [
  "script",
  "style",
  "noscript",
  "head",
  "nav",
  "header",
  "footer",
  "form",
  "button",
  "select",
  "svg",
  "iframe",
  // O Planalto mostra a redação revogada riscada. Indexar esse texto faria a
  // IA citar regra que já não vale.
  "strike",
  "s",
  "del",
];

const BLOCK_END =
  /<\/(p|div|li|tr|table|blockquote|section|article|ul|ol|center|dd|dt)\s*>/gi;

/** Charset declarado no cabeçalho HTTP ou na própria página (Planalto usa windows-1252). */
export function detectCharset(contentType: string | null, head: Uint8Array): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? "");
  if (fromHeader?.[1]) return fromHeader[1].toLowerCase();

  const ascii = new TextDecoder("latin1").decode(head.subarray(0, 4096));
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(ascii);
  return fromMeta?.[1]?.toLowerCase() ?? "utf-8";
}

export function decodeBytes(bytes: Uint8Array, contentType: string | null): string {
  const charset = detectCharset(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Pega a região de conteúdo da página, sem menu e rodapé, quando ela existe. */
function mainRegion(html: string): string {
  for (const tag of ["main", "article"]) {
    const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)<\\/${tag}>`, "i").exec(html);
    if (match?.[1] && match[1].replace(/<[^>]+>/g, "").trim().length > 200)
      return match[1];
  }
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return body?.[1] ?? html;
}

export function htmlToText(html: string): string {
  // No HTML, quebra de linha do código-fonte é espaço; as quebras de verdade
  // vêm dos blocos (<p>, <br>), convertidos abaixo.
  let text = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/[\r\n\t]+/g, " ");

  for (const tag of DROP_ELEMENTS) {
    text = text.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"),
      " ",
    );
  }
  // Riscado feito por estilo, sem <strike>.
  text = text.replace(/<span\b[^>]*line-through[^>]*>[\s\S]*?<\/span\s*>/gi, " ");

  text = mainRegion(text);

  text = text
    .replace(
      /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,
      (_match, level: string, inner: string) => {
        const title = inner
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return title ? `\n\n${"#".repeat(Number(level))} ${title}\n\n` : "\n\n";
      },
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/t[dh]\s*>/gi, " ")
    .replace(BLOCK_END, "\n\n")
    .replace(/<[^>]+>/g, " ");

  return normalizeText(decodeHTML(text));
}

export function normalizeText(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return normalizeText(text.join("\n\n"));
}

export async function docxToText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return normalizeText(value);
}

export type FileKind = "pdf" | "docx" | "html" | "text" | "xlsx" | "csv";

/** Planilha: cada linha vira um trecho; o corte tem de ser por seção. */
export function isTableKind(kind: FileKind | null): boolean {
  return kind === "xlsx" || kind === "csv";
}

export function fileKind(name: string, mimeType = ""): FileKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (/\.(csv|tsv)$/.test(lower) || mimeType === "text/csv") return "csv";
  if (/\.html?$/.test(lower) || mimeType.startsWith("text/html")) return "html";
  if (/\.(md|markdown|txt)$/.test(lower) || mimeType.startsWith("text/")) return "text";
  return null;
}

/** Texto de arquivo sem charset declarado: UTF-8, e Windows-1252 se não for. */
function decodeUnknownText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

type Cell = string | number | boolean | Date | null | undefined;

function cellText(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(value);
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value).replace(/\s+/g, " ").trim();
}

const MAX_TABLE_ROWS = 5_000;

/**
 * Tabela (cClassTrib, CST, NCM…) em seções Markdown: uma por linha, com o
 * código e a descrição no título — é o que a IA cita — e cada coluna
 * identificada pelo cabeçalho, para a linha fazer sentido sozinha.
 */
export function tableToMarkdown(sheets: { name: string; rows: Cell[][] }[]): string {
  const parts: string[] = [];
  let total = 0;

  for (const sheet of sheets) {
    const rows = sheet.rows.map((row) => row.map(cellText));
    const headerIndex = rows.findIndex((row) => row.filter(Boolean).length >= 2);
    if (headerIndex < 0) continue;
    const header = rows[headerIndex]!.map(
      (title, index) => title || `Coluna ${index + 1}`,
    );

    for (const row of rows.slice(headerIndex + 1)) {
      const filled = row.filter(Boolean);
      if (filled.length === 0) continue;
      if ((total += 1) > MAX_TABLE_ROWS) {
        throw new Error(
          `planilha com mais de ${MAX_TABLE_ROWS} linhas — divida em arquivos menores`,
        );
      }
      const title = filled.slice(0, 2).join(" — ").slice(0, 160);
      const lines = row
        .map((value, index) =>
          value ? `${header[index] ?? `Coluna ${index + 1}`}: ${value}` : "",
        )
        .filter(Boolean);
      parts.push(`## ${title}\n\nTabela: ${sheet.name}\n${lines.join("\n")}`);
    }
  }

  if (parts.length === 0) throw new Error("a planilha não tem linhas com dados");
  return parts.join("\n\n");
}

/** CSV com ; , ou tabulação, aspas e quebra de linha dentro de aspas. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", "\t", ","].reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best,
  );

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function xlsxToText(bytes: Uint8Array): Promise<string> {
  const { default: readXlsxFile } = await import("read-excel-file/node");
  const sheets = await readXlsxFile(Buffer.from(bytes));
  return tableToMarkdown(
    sheets.map((sheet) => ({ name: sheet.sheet, rows: sheet.data as Cell[][] })),
  );
}

/** Texto de um arquivo enviado pelo console. */
export async function fileToText(
  name: string,
  bytes: Uint8Array,
  mimeType = "",
): Promise<string> {
  const kind = fileKind(name, mimeType);
  if (kind === "pdf") return pdfToText(bytes);
  if (kind === "docx") return docxToText(bytes);
  if (kind === "xlsx") return xlsxToText(bytes);
  if (kind === "csv") {
    const title = name.replace(/\.[^.]+$/, "");
    return tableToMarkdown([{ name: title, rows: parseCsv(decodeUnknownText(bytes)) }]);
  }
  if (kind === "html") return htmlToText(decodeBytes(bytes, mimeType));
  if (kind === "text") return normalizeText(decodeUnknownText(bytes));
  if (name.toLowerCase().endsWith(".xls")) {
    throw new Error(
      "planilha no formato antigo (.xls): abra no Excel e salve como .xlsx",
    );
  }
  throw new Error(
    "formato não suportado — envie PDF, Word (.docx), planilha (.xlsx, .csv), página salva (.html) ou texto (.txt, .md)",
  );
}

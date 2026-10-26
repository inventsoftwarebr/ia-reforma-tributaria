import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { kbSources } from "@/db/schema";
import { logError, logInfo } from "@/lib/observability/logger";
import type { DocumentShape } from "./chunk";
import { decodeBytes, htmlToText, normalizeText, pdfToText } from "./extract";
import {
  EmbeddingBusyError,
  EmbeddingQuotaError,
  embedPending,
  prepareSource,
  type KbKind,
  type PrepareOutcome,
  type SourceInput,
} from "./ingest";

/**
 * Integração com os sites oficiais da Reforma Tributária.
 *
 * O catálogo traz as normas-base já descritas (rótulo de citação, vigência,
 * formato). O console importa com um clique, e o cron diário confere cada fonte
 * com atualização automática: se o texto mudou no site, a base é atualizada e
 * a revisão fiscal é zerada para alguém conferir a mudança.
 */

export interface OfficialEntry {
  slug: string;
  title: string;
  citationLabel: string;
  kind: KbKind;
  shape: DocumentShape;
  url: string;
  publisher: string;
  effectiveFrom: string;
  description: string;
}

export const OFFICIAL_CATALOG: OfficialEntry[] = [
  {
    slug: "ec-132-2023",
    title: "Emenda Constitucional 132/2023 — Reforma Tributária",
    citationLabel: "EC 132/2023",
    kind: "emenda",
    shape: "legal",
    url: "https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc132.htm",
    publisher: "Congresso Nacional",
    effectiveFrom: "2023-12-21",
    description:
      "Cria na Constituição o IBS, a CBS e o Imposto Seletivo e define a transição.",
  },
  {
    slug: "lc-214-2025",
    title: "Lei Complementar 214/2025 — IBS, CBS e Imposto Seletivo",
    citationLabel: "LC 214/2025",
    kind: "lei_complementar",
    shape: "legal",
    url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm",
    publisher: "Presidência da República",
    effectiveFrom: "2025-01-16",
    description:
      "Regulamenta IBS, CBS e Imposto Seletivo: fato gerador, base, créditos, regimes.",
  },
];

/**
 * Só site de governo ou do Legislativo pode entrar como fonte "oficial".
 * Blog e portal de notícia entram como secundária, que nunca vira norma.
 */
export function isOfficialHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "gov.br" ||
    host.endsWith(".gov.br") ||
    host.endsWith(".leg.br") ||
    host === "in.gov.br"
  );
}

/**
 * Endereço que o servidor aceita buscar: só https e só nome de domínio — nada
 * de IP, localhost ou rede interna, para o importador não virar porta de
 * entrada para dentro da infraestrutura.
 */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("o link não é um endereço válido");
  }
  if (url.protocol !== "https:") throw new Error("use um link https://");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":")
  ) {
    throw new Error("endereço não permitido");
  }
  return url;
}

const MAX_BYTES = 8 * 1024 * 1024;

/** Busca uma página ou PDF e devolve o texto pronto para o chunking. */
export async function fetchDocumentText(
  raw: string,
): Promise<{ text: string; finalUrl: string }> {
  const url = assertFetchableUrl(raw);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; InventIA/1.0; +https://www.inventsoftware.com.br)",
        accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch {
    throw new Error(
      `o site ${url.hostname} não respondeu em 30 segundos — tente de novo mais tarde ou envie o arquivo salvo`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `o site ${url.hostname} respondeu ${response.status} — confira o link ou envie o arquivo salvo`,
    );
  }
  // Redirecionamento não pode levar a um endereço que não seria aceito.
  assertFetchableUrl(response.url || url.toString());

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error("documento maior que 8 MB");

  const contentType = response.headers.get("content-type");
  const isPdf =
    contentType?.includes("application/pdf") ||
    url.pathname.toLowerCase().endsWith(".pdf");

  const text = isPdf
    ? await pdfToText(bytes)
    : contentType?.includes("text/plain")
      ? normalizeText(decodeBytes(bytes, contentType))
      : htmlToText(decodeBytes(bytes, contentType));

  if (text.length < 200) {
    throw new Error(
      "a página veio quase vazia — o site pode exigir navegador; salve a página (Ctrl+S) e envie o arquivo",
    );
  }
  return { text, finalUrl: response.url || url.toString() };
}

/** Norma corta por artigo; o resto, por seção. */
export function shapeForKind(kind: KbKind): DocumentShape {
  return ["emenda", "lei_complementar", "lei", "instrucao_normativa"].includes(kind)
    ? "legal"
    : "markdown";
}

export function catalogEntry(slug: string): OfficialEntry | undefined {
  return OFFICIAL_CATALOG.find((entry) => entry.slug === slug);
}

/** Importa (ou reimporta) uma norma do catálogo direto do site oficial. */
export async function importOfficial(entry: OfficialEntry): Promise<PrepareOutcome> {
  const { text } = await fetchDocumentText(entry.url);
  return prepareSource({
    slug: entry.slug,
    title: entry.title,
    citationLabel: entry.citationLabel,
    kind: entry.kind,
    authority: "oficial",
    shape: entry.shape,
    url: entry.url,
    publisher: entry.publisher,
    effectiveFrom: entry.effectiveFrom,
    version: `texto do site oficial em ${new Date().toISOString().slice(0, 10)}`,
    autoUpdate: true,
    text,
  });
}

export interface CheckResult {
  slug: string;
  status: "sem mudança" | "atualizada" | "erro";
  detail?: string;
}

/**
 * Conferência diária das fontes com atualização automática. Uma fonte que
 * falha não impede as outras; o erro fica registrado na própria fonte, visível
 * no console.
 */
export async function checkOfficialSources(): Promise<CheckResult[]> {
  const sources = await db
    .select()
    .from(kbSources)
    .where(
      and(
        eq(kbSources.autoUpdate, true),
        eq(kbSources.status, "active"),
        isNotNull(kbSources.url),
      ),
    );

  const results: CheckResult[] = [];
  for (const source of sources) {
    let result: CheckResult;
    try {
      const { text } = await fetchDocumentText(source.url!);
      const input: SourceInput = {
        slug: source.slug,
        title: source.title,
        citationLabel: source.citationLabel,
        kind: source.kind,
        authority: source.authority,
        shape: catalogEntry(source.slug)?.shape ?? shapeForKind(source.kind),
        url: source.url ?? undefined,
        publisher: source.publisher ?? undefined,
        effectiveFrom: source.effectiveFrom ?? undefined,
        effectiveTo: source.effectiveTo ?? undefined,
        version: `texto do site oficial em ${new Date().toISOString().slice(0, 10)}`,
        autoUpdate: true,
        // Sem mudança nada é regravado e a revisão continua valendo; com
        // mudança, prepareSource zera a revisão para o time fiscal conferir.
        text,
      };
      const outcome = await prepareSource(input);
      // Normalmente só os artigos alterados ficam pendentes: indexa já, para a
      // mudança valer hoje. O que não couber, o cron termina depois.
      if (outcome.pending > 0) {
        await embedPending({
          sourceId: outcome.sourceId,
          deadline: Date.now() + 30_000,
        }).catch((error: unknown) => {
          // Sem cota agora: o texto novo já está gravado e o cron termina depois.
          if (!(
            error instanceof EmbeddingBusyError || error instanceof EmbeddingQuotaError
          )) {
            throw error;
          }
        });
      }
      result = {
        slug: source.slug,
        status: outcome.status === "unchanged" ? "sem mudança" : "atualizada",
      };
    } catch (error) {
      logError("kb.official_check_failed", error, { slug: source.slug });
      result = {
        slug: source.slug,
        status: "erro",
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    await db
      .update(kbSources)
      .set({
        lastCheckedAt: new Date(),
        lastCheckStatus: result.detail
          ? `${result.status}: ${result.detail}`
          : result.status,
      })
      .where(eq(kbSources.slug, source.slug));
    results.push(result);
  }

  logInfo("kb.official_checked", { total: results.length, results });
  return results;
}

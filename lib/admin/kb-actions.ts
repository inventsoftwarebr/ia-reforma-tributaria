"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { kbSources } from "@/db/schema";
import { slugify, type IngestStart, type IngestStep } from "@/lib/kb/console";
import { fileKind, fileToText, isTableKind } from "@/lib/kb/extract";
import {
  EmbeddingBusyError,
  EmbeddingQuotaError,
  KB_KINDS,
  embedPending,
  prepareSource,
  sourceProgress,
  type PrepareOutcome,
} from "@/lib/kb/ingest";
import {
  assertFetchableUrl,
  catalogEntry,
  checkOfficialSources,
  fetchDocumentText,
  importOfficial,
  isOfficialHost,
  shapeForKind,
} from "@/lib/kb/official";
import { starterSource } from "@/lib/kb/starter";
import { logError, logInfo } from "@/lib/observability/logger";
import { requireAdmin } from "./auth";

/**
 * Server Actions da base de conhecimento. Só admin mexe na base: o que entra
 * aqui vira resposta para cliente.
 */

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal("").transform(() => undefined));

const formSchema = z.object({
  mode: z.enum(["file", "url", "text"]),
  title: z.string().trim().min(3, "informe um título").max(200),
  citationLabel: z.string().trim().min(2, "informe como a fonte será citada").max(80),
  kind: z.enum(KB_KINDS),
  authority: z.enum(["oficial", "invent", "secundaria"]),
  shape: z.enum(["legal", "markdown", "auto"]).default("auto"),
  url: z.string().trim().max(2000).optional(),
  publisher: z.string().trim().max(120).optional(),
  effectiveFrom: isoDate,
  effectiveTo: isoDate,
  version: z.string().trim().max(120).optional(),
  autoUpdate: z.literal("on").optional(),
  text: z.string().max(3_000_000).optional(),
});

function startMessage(outcome: PrepareOutcome): string {
  if (outcome.status === "unchanged") {
    return outcome.pending > 0
      ? "O texto não mudou; continuando a indexação que faltava."
      : "O texto é igual ao que já está na base — nada a fazer.";
  }
  const reaproveitados =
    outcome.reused > 0
      ? ` ${outcome.reused} trechos sem mudança aproveitados da versão anterior.`
      : "";
  return `${outcome.chunks} trechos preparados.${reaproveitados}`;
}

function failure(error: unknown, context: string): { ok: false; error: string } {
  logError(context, error);
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function started(outcome: PrepareOutcome): IngestStart {
  revalidatePath("/admin/base");
  return {
    ok: true,
    sourceId: outcome.sourceId,
    chunks: outcome.chunks,
    pending: outcome.pending,
    reused: outcome.reused,
    message: startMessage(outcome),
  };
}

/** Formulário "Adicionar fonte": arquivo, link ou texto colado. */
export async function addSource(formData: FormData): Promise<IngestStart> {
  const user = await requireAdmin();
  try {
    const raw = Object.fromEntries(
      [...formData.entries()].filter(([, value]) => typeof value === "string"),
    );
    const parsed = formSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((issue) => issue.message).join("; "),
      };
    }
    const input = parsed.data;

    let text: string;
    let url = input.url || undefined;
    let tableFile = false;
    if (input.mode === "file") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return { ok: false, error: "escolha um arquivo" };
      }
      if (file.size > MAX_FILE_BYTES) {
        return {
          ok: false,
          error:
            "arquivo maior que 4 MB — para lei do Planalto, use a importação por link",
        };
      }
      const kind = fileKind(file.name, file.type);
      if (!kind && !file.name.toLowerCase().endsWith(".xls")) {
        return {
          ok: false,
          error:
            "envie PDF, Word (.docx), planilha (.xlsx, .csv), página salva (.html) ou texto (.txt, .md)",
        };
      }
      tableFile = isTableKind(kind);
      text = await fileToText(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
        file.type,
      );
    } else if (input.mode === "url") {
      if (!url) return { ok: false, error: "informe o link" };
      const target = assertFetchableUrl(url);
      if (input.authority === "oficial" && !isOfficialHost(target.hostname)) {
        return {
          ok: false,
          error: `${target.hostname} não é site de governo: escolha a autoridade "Invent" ou "Secundária"`,
        };
      }
      const fetched = await fetchDocumentText(url);
      text = fetched.text;
      url = fetched.finalUrl;
    } else {
      text = (input.text ?? "").trim();
      if (text.length < 50)
        return { ok: false, error: "cole o texto (mínimo de 50 caracteres)" };
    }

    if (url) assertFetchableUrl(url);
    const outcome = await prepareSource({
      slug: slugify(input.title),
      title: input.title,
      citationLabel: input.citationLabel,
      kind: input.kind,
      authority: input.authority,
      // Planilha é sempre uma seção por linha, qualquer que seja o tipo escolhido.
      shape: tableFile
        ? "markdown"
        : input.shape === "auto"
          ? shapeForKind(input.kind)
          : input.shape,
      url,
      publisher: input.publisher || undefined,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      version: input.version || undefined,
      // Só faz sentido conferir de novo o que veio de um link.
      autoUpdate: input.mode === "url" && input.autoUpdate === "on",
      text,
    });
    logInfo("admin.kb_source_added", {
      slug: slugify(input.title),
      mode: input.mode,
      by: user.id,
    });
    return started(outcome);
  } catch (error) {
    return failure(error, "admin.kb_add_failed");
  }
}

/** Norma do catálogo oficial, direto do site do governo. */
export async function importCatalogSource(slug: string): Promise<IngestStart> {
  const user = await requireAdmin();
  const entry = catalogEntry(slug);
  if (!entry) return { ok: false, error: "norma fora do catálogo" };
  try {
    const outcome = await importOfficial(entry);
    logInfo("admin.kb_official_imported", { slug, by: user.id });
    return started(outcome);
  } catch (error) {
    return failure(error, "admin.kb_official_failed");
  }
}

/** Rascunho do pacote inicial da Invent. */
export async function importStarterSource(slug: string): Promise<IngestStart> {
  const user = await requireAdmin();
  const starter = starterSource(slug);
  if (!starter) return { ok: false, error: "material fora do pacote inicial" };
  try {
    // A descrição extra é ignorada pela ingestão.
    const outcome = await prepareSource(starter);
    logInfo("admin.kb_starter_imported", { slug, by: user.id });
    return started(outcome);
  } catch (error) {
    return failure(error, "admin.kb_starter_failed");
  }
}

/** Um passo da indexação: o console chama em sequência até acabar. */
export async function indexSourceStep(sourceId: string): Promise<IngestStep> {
  await requireAdmin();
  const id = z.string().uuid().parse(sourceId);
  try {
    const { remaining } = await embedPending({
      sourceId: id,
      deadline: Date.now() + 35_000,
    });
    const { total } = await sourceProgress(id);
    if (remaining === 0) revalidatePath("/admin/base");
    return { ok: true, remaining, total, paused: false };
  } catch (error) {
    if (error instanceof EmbeddingQuotaError) {
      return { ok: false, error: `${error.message} O que já foi indexado está salvo.` };
    }
    if (error instanceof EmbeddingBusyError) {
      const { total, embedded } = await sourceProgress(id);
      return { ok: true, remaining: total - embedded, total, paused: true };
    }
    return failure(error, "admin.kb_index_failed");
  }
}

export async function setSourceAutoUpdate(id: string, enabled: boolean): Promise<void> {
  const user = await requireAdmin();
  await db
    .update(kbSources)
    .set({ autoUpdate: enabled, updatedAt: new Date() })
    .where(eq(kbSources.id, z.string().uuid().parse(id)));
  logInfo("admin.kb_auto_update", { id, enabled, by: user.id });
  revalidatePath("/admin/base");
}

/** "Conferir agora": a mesma checagem do cron, sob demanda. */
export async function checkOfficialNow(): Promise<{ ok: boolean; summary: string }> {
  await requireAdmin();
  try {
    const results = await checkOfficialSources();
    revalidatePath("/admin/base");
    if (results.length === 0)
      return { ok: true, summary: "nenhuma fonte com atualização automática" };
    return {
      ok: results.every((result) => result.status !== "erro"),
      summary: results.map((result) => `${result.slug}: ${result.status}`).join(" · "),
    };
  } catch (error) {
    return { ok: false, summary: failure(error, "admin.kb_check_failed").error };
  }
}

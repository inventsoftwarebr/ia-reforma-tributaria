import "dotenv/config";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ingestSource } from "@/lib/kb/ingest";

/**
 * Ingestão da base curada.
 *
 * Uso:
 *   pnpm kb:ingest                  # processa o que mudou
 *   pnpm kb:ingest -- --force       # reprocessa tudo (gasta embedding)
 *   pnpm kb:ingest -- --only=lc-214-2025
 *
 * O manifesto declara a procedência de cada documento. Nada entra na base sem
 * rótulo de citação, autoridade e vigência: é isso que permite ao agente citar
 * a norma e filtrar o que já não vale.
 */

const entrySchema = z.object({
  slug: z
    .string()
    .min(3)
    .regex(/^[a-z0-9-]+$/, "use apenas minúsculas, números e hífen"),
  title: z.string().min(3),
  citationLabel: z.string().min(2),
  kind: z.enum([
    "emenda",
    "lei_complementar",
    "lei",
    "instrucao_normativa",
    "nota_tecnica",
    "faq",
    "material_invent",
    "imprensa",
  ]),
  authority: z.enum(["oficial", "invent", "secundaria"]),
  shape: z.enum(["legal", "markdown"]),
  file: z.string().min(1),
  url: z.string().optional(),
  publisher: z.string().optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  version: z.string().optional(),
  reviewedBy: z.string().optional(),
});

const manifestSchema = z.array(entrySchema).min(1);

function arg(name: string): string | undefined {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found?.split("=")[1];
}

async function main() {
  const force = process.argv.includes("--force");
  const only = arg("only");
  const manifestPath = arg("manifest") ?? "kb/manifest.json";

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error(
      `não consegui ler ${manifestPath}. Copie kb/manifest.example.json para kb/manifest.json e preencha.`,
    );
  }

  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    const problemas = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n  ");
    throw new Error(`manifesto inválido:\n  ${problemas}`);
  }

  const entries = only ? parsed.data.filter((entry) => entry.slug === only) : parsed.data;
  if (entries.length === 0) throw new Error(`nenhuma fonte com slug "${only}"`);

  // Imprensa nunca sustenta resposta como norma; o agente já é instruído a
  // tratar como contexto, mas avisar aqui evita curadoria distraída.
  const secundarias = entries.filter((entry) => entry.authority === "secundaria");
  if (secundarias.length > 0) {
    process.stdout.write(
      `aviso: ${secundarias.length} fonte(s) secundária(s) — entram como contexto, nunca como norma\n`,
    );
  }

  let ingeridas = 0;
  let inalteradas = 0;

  for (const entry of entries) {
    const text = readFileSync(entry.file.startsWith("kb/") ? entry.file : `kb/${entry.file}`, "utf8");
    const outcome = await ingestSource({ ...entry, text }, { force });

    if (outcome.status === "ingested") {
      ingeridas += 1;
      process.stdout.write(`ingerida: ${outcome.slug} (${outcome.chunks} trechos)\n`);
    } else {
      inalteradas += 1;
      process.stdout.write(`inalterada: ${outcome.slug}\n`);
    }
  }

  process.stdout.write(`\n${ingeridas} ingerida(s), ${inalteradas} inalterada(s).\n`);
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
});

/**
 * Tipos e regras do gerenciamento da base pelo console, sem dependência de
 * servidor — usados pelas Server Actions e pelos componentes de tela.
 */

export type IngestStart =
  | {
      ok: true;
      sourceId: string;
      chunks: number;
      pending: number;
      reused: number;
      message: string;
    }
  | { ok: false; error: string };

export type IngestStep =
  | { ok: true; remaining: number; total: number; rateLimited: boolean }
  | { ok: false; error: string };

/** Chave estável a partir do título: mesmo título = nova versão da mesma fonte. */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export const KIND_LABELS: Record<string, string> = {
  emenda: "Emenda constitucional",
  lei_complementar: "Lei complementar",
  lei: "Lei",
  instrucao_normativa: "Instrução normativa / ato da Receita",
  nota_tecnica: "Nota técnica / manual oficial",
  faq: "Perguntas e respostas",
  material_invent: "Material da Invent",
  imprensa: "Notícia / artigo de terceiros",
};

export const AUTHORITY_LABELS: Record<string, string> = {
  oficial: "Oficial (governo, norma)",
  invent: "Invent (material próprio)",
  secundaria: "Secundária (imprensa, terceiros)",
};

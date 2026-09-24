import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { promptVersions } from "@/db/schema";
import { DEFAULT_POLICY, PROMPT_KEY, PROMPT_VERSION } from "./prompt";

/**
 * Política ativa do prompt. Versão no banco vence a do código, o que permite
 * ajustar tom e regras pelo console com rollback — sem deploy e sem perder o
 * rastro de qual versão gerou qual resposta (ai_runs.prompt_version).
 */
export async function activePolicy(): Promise<{ version: string; content: string }> {
  try {
    const [row] = await db
      .select({ version: promptVersions.version, content: promptVersions.content })
      .from(promptVersions)
      .where(and(eq(promptVersions.key, PROMPT_KEY), eq(promptVersions.active, true)))
      .orderBy(desc(promptVersions.createdAt))
      .limit(1);

    if (row) return row;
  } catch {
    // Banco fora do ar não pode derrubar o atendimento: cai para o padrão.
  }

  return { version: PROMPT_VERSION, content: DEFAULT_POLICY };
}

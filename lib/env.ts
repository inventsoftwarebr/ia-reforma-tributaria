import { z } from "zod";

/**
 * Env do servidor, validado uma vez e em lote — falha com a lista completa do
 * que está faltando, em vez de um `undefined` aparecendo no meio da requisição.
 * Nunca importar isto em Client Component.
 */
const serverSchema = z.object({
  /** URL pública da app — usada para montar o callback do worker. */
  APP_URL: z.string().min(1),

  WHATSAPP_GATEWAY: z.enum(["evolution", "cloud_api"]).default("evolution"),
  EVOLUTION_API_URL: z.string().min(1),
  EVOLUTION_API_KEY: z.string().min(1),
  /** Uma ou mais instâncias separadas por vírgula. Nunca vazio. CLAUDE.md §5. */
  EVOLUTION_INSTANCE: z.string().min(1),
  EVOLUTION_WEBHOOK_SECRET: z.string().min(16),

  /**
   * QStash. Sem token, o turno roda inline na própria requisição do webhook —
   * aceitável em desenvolvimento, nunca em produção (o webhook precisa
   * responder em menos de 300ms). Ver CLAUDE.md §5 e §7.
   */
  QSTASH_TOKEN: z.string().default(""),
  QSTASH_CURRENT_SIGNING_KEY: z.string().default(""),
  QSTASH_NEXT_SIGNING_KEY: z.string().default(""),

  TURN_DEBOUNCE_SECONDS: z.coerce.number().int().min(0).max(120).default(7),
  RATE_LIMIT_MESSAGES_PER_DAY: z.coerce.number().int().positive().default(50),

  AI_PROVIDER: z.enum(["anthropic", "google"]).default("anthropic"),
  AI_MODEL: z.string().min(1),
  AI_MAX_TOKENS_PER_TURN: z.coerce.number().int().positive().default(1200),

  SIMULATOR_URL: z.string().min(1),
  SIMULATOR_UTM: z.string().default(""),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Variáveis de ambiente inválidas — ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

/** Allowlist de instâncias autorizadas a usar o webhook. */
export function allowedInstances(): string[] {
  return serverEnv()
    .EVOLUTION_INSTANCE.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/** Link do simulador com UTM de campanha — nunca hardcoded no prompt. */
export function simulatorLink(): string {
  const { SIMULATOR_URL, SIMULATOR_UTM } = serverEnv();
  if (!SIMULATOR_UTM) return SIMULATOR_URL;
  return SIMULATOR_URL.includes("?")
    ? `${SIMULATOR_URL}&${SIMULATOR_UTM}`
    : `${SIMULATOR_URL}?${SIMULATOR_UTM}`;
}

/** Usado em teste para reavaliar o env depois de mexer em process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

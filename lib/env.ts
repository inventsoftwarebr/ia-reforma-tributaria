import { z } from "zod";

/**
 * Env do servidor, validado em lote: falha com a lista completa do que falta,
 * em vez de um `undefined` aparecendo no meio de uma requisição.
 * Nunca importar em Client Component.
 */
const serverSchema = z.object({
  /** URL pública da app — a fila usa para chamar o worker de volta. */
  APP_URL: z.string().min(1),

  // Supabase Auth do console. O pipeline não usa supabase-js: fala com o banco
  // pela conexão Postgres (DATABASE_URL), então a chave secreta não é exigida.
  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1),
  /** "Publishable key" no painel (sb_publishable_...), ou a anon key legada. */
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),

  // WhatsApp
  WHATSAPP_GATEWAY: z.enum(["evolution", "cloud_api"]).default("evolution"),
  EVOLUTION_API_URL: z.string().min(1),
  EVOLUTION_API_KEY: z.string().min(1),
  /** Uma ou mais instâncias separadas por vírgula. Nunca vazio. */
  EVOLUTION_INSTANCE: z.string().min(1),
  EVOLUTION_WEBHOOK_SECRET: z.string().min(16),

  /**
   * QStash. Sem token, o turno roda inline na requisição do webhook — serve em
   * desenvolvimento, nunca em produção (o webhook precisa responder rápido).
   */
  QSTASH_TOKEN: z.string().default(""),
  QSTASH_CURRENT_SIGNING_KEY: z.string().default(""),
  QSTASH_NEXT_SIGNING_KEY: z.string().default(""),
  TURN_DEBOUNCE_SECONDS: z.coerce.number().int().min(0).max(120).default(7),

  // Modelo de conversa
  AI_PROVIDER: z.enum(["anthropic", "google"]).default("anthropic"),
  AI_MODEL: z.string().min(1),
  AI_MAX_TOKENS_PER_TURN: z.coerce.number().int().positive().default(1200),

  /**
   * Embeddings. Trocar de modelo muda a dimensão do vetor e exige migration em
   * kb_chunks.embedding + reingestão completa da base.
   */
  AI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_API_KEY: z.string().default(""),

  /** Quantos trechos da base entram no contexto de cada resposta. */
  KB_MATCH_COUNT: z.coerce.number().int().min(1).max(20).default(8),

  RATE_LIMIT_MESSAGES_PER_DAY: z.coerce.number().int().positive().default(50),

  // Conversão
  SIMULATOR_URL: z.string().min(1),
  SIMULATOR_UTM: z.string().default(""),

  // HubSpot (opcional: sem token, o outbox acumula e avisa)
  HUBSPOT_PRIVATE_APP_TOKEN: z.string().default(""),
  HUBSPOT_PIPELINE_ID: z.string().default(""),
  HUBSPOT_DEAL_STAGE_ID: z.string().default(""),

  /** Protege as rotas de cron na Vercel. */
  CRON_SECRET: z.string().default(""),
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

export function hubspotEnabled(): boolean {
  return serverEnv().HUBSPOT_PRIVATE_APP_TOKEN.length > 0;
}

export function resetEnvCache(): void {
  cached = undefined;
}

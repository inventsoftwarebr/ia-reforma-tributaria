import { z } from "zod";
import { validateDatabaseUrl } from "./db-url";

/**
 * Env do servidor, validado em lote: falha com a lista completa do que falta,
 * em vez de um `undefined` aparecendo no meio de uma requisição.
 * Nunca importar em Client Component.
 */
const serverSchema = z.object({
  /** URL pública da app — a fila usa para chamar o worker de volta. */
  APP_URL: z.string().default(""),
  /**
   * Domínio de produção do projeto, informado pela própria Vercel (variável de
   * sistema). Usado quando APP_URL não está preenchido — assim o endereço que
   * a fila chama de volta não fica desatualizado se o domínio mudar.
   */
  VERCEL_PROJECT_PRODUCTION_URL: z.string().default(""),

  /** Transaction pooler do Supabase (porta 6543). Ver lib/db-url.ts. */
  DATABASE_URL: z.string().superRefine((value, ctx) => {
    const problem = validateDatabaseUrl(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  }),

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

  // Modelo de conversa. gemini-3.5-flash: estável desde 19/05/2026, sem
  // desligamento antes de 19/05/2027. Trocar de modelo é só mudar a variável.
  AI_PROVIDER: z.enum(["google", "anthropic"]).default("google"),
  AI_MODEL: z.string().min(1).default("gemini-3.5-flash"),
  /**
   * Teto de saída por turno. Inclui o raciocínio interno do modelo, não só o
   * texto da resposta — por isso folga sobre os ~400 tokens de uma resposta de
   * WhatsApp.
   */
  AI_MAX_TOKENS_PER_TURN: z.coerce.number().int().positive().default(2048),

  /**
   * Embeddings da base. O modelo pode mudar, a dimensão não: ver
   * lib/kb/dimensions.ts. Trocar de modelo exige reingestão completa, porque
   * vetores de modelos diferentes não são comparáveis entre si.
   */
  EMBEDDING_PROVIDER: z.enum(["google", "openai"]).default("google"),
  AI_EMBEDDING_MODEL: z.string().min(1).default("gemini-embedding-2"),

  // Chaves: só a do provedor escolhido é exigida (ver superRefine abaixo).
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),

  /** Quantos trechos da base entram no contexto de cada resposta. */
  KB_MATCH_COUNT: z.coerce.number().int().min(1).max(20).default(8),

  RATE_LIMIT_MESSAGES_PER_DAY: z.coerce.number().int().positive().default(50),

  // Conversão. Valores do fluxo original do n8n: link público e fixo, por isso
  // têm padrão. A variável existe para o marketing trocar sem mexer em código.
  SIMULATOR_URL: z
    .string()
    .min(1)
    .default("https://lp.inventsoftware.com.br/simulador-reforma-tributaria/"),
  SIMULATOR_UTM: z
    .string()
    .default("utm_source=ia+whatsapp+mkt&utm_campaign=simulador+da+reforma+tributaria"),

  // HubSpot (opcional: sem token, o outbox acumula e avisa)
  HUBSPOT_PRIVATE_APP_TOKEN: z.string().default(""),
  HUBSPOT_PIPELINE_ID: z.string().default(""),
  HUBSPOT_DEAL_STAGE_ID: z.string().default(""),

  /** Protege as rotas de cron na Vercel. */
  CRON_SECRET: z.string().default(""),
}).superRefine((env, ctx) => {
  // A chave exigida depende do provedor escolhido: faltando, o deploy na
  // Vercel falha dizendo qual, em vez de a primeira conversa falhar.
  if (!env.APP_URL && !env.VERCEL_PROJECT_PRODUCTION_URL) {
    ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "faltando" });
  }

  const needs: { key: keyof typeof env; because: string }[] = [];
  if (env.AI_PROVIDER === "google" || env.EMBEDDING_PROVIDER === "google") {
    needs.push({ key: "GOOGLE_GENERATIVE_AI_API_KEY", because: "provedor google" });
  }
  if (env.AI_PROVIDER === "anthropic") {
    needs.push({ key: "ANTHROPIC_API_KEY", because: "AI_PROVIDER=anthropic" });
  }
  if (env.EMBEDDING_PROVIDER === "openai") {
    needs.push({ key: "OPENAI_API_KEY", because: "EMBEDDING_PROVIDER=openai" });
  }
  for (const { key, because } of needs) {
    if (!env[key]) {
      ctx.addIssue({ code: "custom", path: [key], message: `faltando (${because})` });
    }
  }
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => {
        const name = issue.path.join(".");
        // Mensagem padrão do zod para ausência é ilegível no log da Vercel.
        return issue.message.includes("received undefined")
          ? `${name}: faltando`
          : `${name}: ${issue.message}`;
      })
      .join("; ");
    throw new Error(`Variáveis de ambiente inválidas — ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

/** Completa o https:// e tira a barra final: "x.vercel.app/" → "https://x.vercel.app". */
export function normalizeAppUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Endereço público da aplicação: APP_URL quando preenchido, senão o domínio de
 * produção que a Vercel informa.
 */
export function appUrl(): string {
  const { APP_URL, VERCEL_PROJECT_PRODUCTION_URL } = serverEnv();
  return normalizeAppUrl(APP_URL || VERCEL_PROJECT_PRODUCTION_URL);
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

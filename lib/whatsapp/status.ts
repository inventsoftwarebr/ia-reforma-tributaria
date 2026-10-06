import { appUrl, serverEnv } from "@/lib/env";
import {
  type Check,
  configProblem,
  connectionCheck,
  type EvolutionConfig,
  expectedWebhookUrl,
  webhookCheck,
} from "./evolution-admin";

/**
 * Estado do canal WhatsApp para o console e o /api/health. Server-only.
 */

export function evolutionConfig(): EvolutionConfig {
  const env = serverEnv();
  return {
    baseUrl: env.EVOLUTION_API_URL.trim(),
    apiKey: env.EVOLUTION_API_KEY.trim(),
    // A primeira da allowlist é a que envia; é nela que o webhook importa.
    instance: env.EVOLUTION_INSTANCE.split(",")[0]?.trim() ?? "",
  };
}

/**
 * APP_URL preenchida com outro domínio faria a Evolution (e a fila) entregar
 * mensagens a um site que não é este — inclusive o de outra pessoa, como o
 * ia-reforma-tributaria.vercel.app. Por isso o console se recusa a configurar
 * o webhook enquanto os dois não baterem.
 */
export function webhookTarget(): Check & { url?: string } {
  const env = serverEnv();
  const site = appUrl();
  if (env.APP_URL && env.VERCEL_PROJECT_PRODUCTION_URL) {
    const fromApp = new URL(site).host;
    const fromVercel = env.VERCEL_PROJECT_PRODUCTION_URL.replace(
      /^https?:\/\//,
      "",
    ).replace(/\/.*$/, "");
    if (fromApp !== fromVercel) {
      return {
        ok: false,
        text: `APP_URL aponta para ${fromApp}, mas o domínio deste projeto é ${fromVercel} — corrija APP_URL na Vercel (ou deixe vazia) e faça Redeploy`,
      };
    }
  }
  return {
    ok: true,
    text: site,
    url: expectedWebhookUrl(site, env.EVOLUTION_WEBHOOK_SECRET),
  };
}

export interface WhatsAppStatus {
  provedor: string;
  conexao: Check;
  webhook: Check;
  destino: Check;
}

export async function whatsappStatus(): Promise<WhatsAppStatus> {
  const env = serverEnv();
  const destino = webhookTarget();

  if (env.WHATSAPP_GATEWAY !== "evolution") {
    const skip = { ok: true, text: "não se aplica (WhatsApp Cloud API)" } as const;
    return { provedor: env.WHATSAPP_GATEWAY, conexao: skip, webhook: skip, destino };
  }

  const config = evolutionConfig();
  const problem = configProblem(config);
  if (problem) {
    const pending = { ok: false, text: problem } as const;
    return { provedor: "evolution", conexao: pending, webhook: pending, destino };
  }

  const [conexao, webhook] = await Promise.all([
    connectionCheck(config),
    webhookCheck(config, appUrl(), env.EVOLUTION_WEBHOOK_SECRET),
  ]);
  return { provedor: "evolution", conexao, webhook, destino };
}

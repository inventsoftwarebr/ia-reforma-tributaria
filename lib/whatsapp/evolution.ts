import { timingSafeEqual } from "node:crypto";
import { allowedInstances, serverEnv } from "@/lib/env";
import { logWarn } from "@/lib/observability/logger";
import { parseEvolutionWebhook } from "./normalize";
import type { ParseResult, SendTextResult, WhatsAppGateway } from "./types";

/**
 * Gateway Evolution API (VPS/EasyPanel). Nenhuma rota fala com a Evolution
 * direto — tudo passa por esta porta. CLAUDE.md §14.
 */

const TOKEN_HEADER = "x-invent-token";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function requestUrl(path: string): string {
  const base = serverEnv().EVOLUTION_API_URL.replace(/\/+$/, "");
  return `${base}${path}`;
}

async function attempt(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(requestUrl(path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: serverEnv().EVOLUTION_API_KEY,
    },
    body: JSON.stringify(body),
    // A Evolution roda na VPS; sem timeout uma instância travada prende o worker.
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(
      `Evolution API respondeu ${response.status} em ${path}: ${detail.slice(0, 300)}`,
    );
    // 4xx é erro nosso (payload, instância, credencial): repetir não resolve.
    throw Object.assign(error, { retryable: response.status >= 500 });
  }

  return response.json().catch(() => null);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Error && "retryable" in error) {
    return (error as { retryable?: boolean }).retryable === true;
  }
  // Timeout e falha de rede não têm status: valem uma segunda tentativa.
  return true;
}

/** Uma nova tentativa para falha transitória — a VPS cai mais que a Vercel. */
async function post(path: string, body: unknown): Promise<unknown> {
  try {
    return await attempt(path, body);
  } catch (error) {
    if (!isRetryable(error)) throw error;
    logWarn("whatsapp.evolution.retrying", { path });
    await new Promise((resolve) => setTimeout(resolve, 600));
    return attempt(path, body);
  }
}

/** Primeira instância da allowlist — a que usamos para enviar. */
function sendingInstance(): string {
  const instances = allowedInstances();
  const first = instances[0];
  if (!first) throw new Error("EVOLUTION_INSTANCE não tem nenhuma instância válida.");
  return first;
}

function extractMessageId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const key = (payload as { key?: unknown }).key;
  if (typeof key !== "object" || key === null) return null;
  const id = (key as { id?: unknown }).id;
  return typeof id === "string" && id ? id : null;
}

export const evolutionGateway: WhatsAppGateway = {
  provider: "evolution",

  /**
   * O segredo pode vir no header `x-invent-token` ou em `?token=` — algumas
   * versões da Evolution não permitem header customizado no webhook.
   */
  verifyInbound({ headers, url }) {
    const expected = serverEnv().EVOLUTION_WEBHOOK_SECRET;
    const provided = headers.get(TOKEN_HEADER) ?? url.searchParams.get("token") ?? "";
    if (!provided) {
      logWarn("whatsapp.inbound.missing_token");
      return false;
    }
    const valid = safeEqual(provided, expected);
    if (!valid) logWarn("whatsapp.inbound.invalid_token");
    return valid;
  },

  parseInbound(payload): ParseResult {
    return parseEvolutionWebhook(payload, { allowedInstances: allowedInstances() });
  },

  async sendText({ waJid, text }): Promise<SendTextResult> {
    const payload = await post(`/message/sendText/${sendingInstance()}`, {
      number: waJid,
      text,
    });
    return { providerMessageId: extractMessageId(payload) };
  },

  async setTyping({ waJid, durationMs = 2_000 }): Promise<void> {
    // Presence é cosmético: falhar aqui não pode derrubar o turno.
    try {
      await post(`/chat/sendPresence/${sendingInstance()}`, {
        number: waJid,
        presence: "composing",
        delay: durationMs,
      });
    } catch (error) {
      logWarn("whatsapp.presence.failed", { reason: String(error) });
    }
  },
};

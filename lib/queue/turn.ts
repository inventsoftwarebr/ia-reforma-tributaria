import { Client, Receiver } from "@upstash/qstash";
import { appUrl, serverEnv } from "@/lib/env";
import { logWarn } from "@/lib/observability/logger";
import { runTurn } from "@/lib/turn/run";

/**
 * Fila do turno. O webhook responde 200 rápido e o trabalho acontece aqui,
 * com um atraso de debounce para agregar mensagens em sequência.
 * Ver CLAUDE.md §5 e §7.
 */

export interface TurnJob {
  conversationId: string;
}

const JOB_PATH = "/api/jobs/turn";

export async function enqueueTurn(job: TurnJob): Promise<{ mode: "queued" | "inline" }> {
  const env = serverEnv();

  if (!env.QSTASH_TOKEN) {
    // Desenvolvimento sem QStash: roda inline. Em produção isso faz o webhook
    // estourar o orçamento de 300ms — por isso o aviso.
    logWarn("queue.inline_fallback", { reason: "QSTASH_TOKEN ausente" });
    await runTurn(job);
    return { mode: "inline" };
  }

  const client = new Client({ token: env.QSTASH_TOKEN });
  await client.publishJSON({
    url: `${appUrl()}${JOB_PATH}`,
    body: job,
    delay: env.TURN_DEBOUNCE_SECONDS,
    // Deduplica jobs da mesma conversa dentro da janela de debounce: várias
    // mensagens em sequência geram um único turno.
    deduplicationId: `turn:${job.conversationId}:${debounceWindow(env.TURN_DEBOUNCE_SECONDS)}`,
    retries: 2,
  });

  return { mode: "queued" };
}

/** Janela de debounce, para o deduplicationId mudar a cada bloco de tempo. */
function debounceWindow(seconds: number): number {
  const width = Math.max(seconds, 1) * 1_000;
  return Math.floor(Date.now() / width);
}

/** Verifica a assinatura do QStash. Sem chaves configuradas, nada entra. */
export async function verifyQueueRequest(
  request: Request,
  body: string,
): Promise<boolean> {
  const env = serverEnv();
  if (!env.QSTASH_CURRENT_SIGNING_KEY || !env.QSTASH_NEXT_SIGNING_KEY) {
    logWarn("queue.verify_unconfigured");
    return false;
  }

  const signature = request.headers.get("upstash-signature");
  if (!signature) return false;

  const receiver = new Receiver({
    currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
  });

  try {
    return await receiver.verify({ signature, body });
  } catch {
    return false;
  }
}

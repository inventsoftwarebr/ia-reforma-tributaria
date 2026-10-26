/**
 * Classificação dos erros da API do modelo (Gemini). O AI SDK embrulha a
 * última tentativa em "Failed after 3 attempts", com a causa em `lastError`;
 * por isso tudo aqui percorre `cause` e `lastError`.
 */

function* errorChain(error: unknown): Generator<{ status?: number; message: string }> {
  const queue: unknown[] = [error];
  for (let seen = 0; seen < 8 && queue.length > 0; seen += 1) {
    const current = queue.shift();
    if (!current) continue;
    let status: number | undefined;
    if (typeof current === "object") {
      const record = current as {
        statusCode?: unknown;
        cause?: unknown;
        lastError?: unknown;
      };
      if (typeof record.statusCode === "number") status = record.statusCode;
      queue.push(record.cause, record.lastError);
    }
    yield {
      status,
      message: current instanceof Error ? current.message : String(current),
    };
  }
}

const TEMPORARY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const TEMPORARY_MESSAGE =
  /\b(408|429|500|502|503|504)\b|quota|rate.?limit|resource.?exhausted|unavailable|overloaded|try again|timed? ?out|ECONNRESET|socket hang up/i;

/** Falha que passa sozinha: cota por minuto, instabilidade, timeout. */
export function isTemporaryFailure(error: unknown): boolean {
  for (const { status, message } of errorChain(error)) {
    if (status !== undefined && TEMPORARY_STATUS.has(status)) return true;
    if (TEMPORARY_MESSAGE.test(message)) return true;
  }
  return false;
}

/**
 * Cota DIÁRIA esgotada (plano gratuito do Gemini: 1.000 pedidos de embedding
 * por dia). Esperar 30 segundos não adianta: só volta no dia seguinte ou com o
 * faturamento ativado.
 */
export function isDailyQuota(error: unknown): boolean {
  for (const { message } of errorChain(error)) {
    if (/per ?day|perday|daily|requests per day|free_tier_requests/i.test(message))
      return true;
  }
  return false;
}

export const DAILY_QUOTA_MESSAGE =
  "A cota diária gratuita do Gemini acabou. Ela volta sozinha no dia seguinte (por volta das 4h ou 5h de Brasília); para liberar agora e não depender mais dela, ative o faturamento no Google AI Studio.";

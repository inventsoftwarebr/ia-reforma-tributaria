/* eslint-disable no-console -- único ponto do código autorizado a escrever log */

/**
 * Porta de saída de log. Toda escrita estruturada passa aqui para que
 * `no-console` valha no resto do projeto e para ter um ponto único de
 * integração com o Sentry (fase 3).
 */

export type LogFields = Record<string, unknown>;

type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, fields: LogFields): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export function logInfo(event: string, fields: LogFields = {}): void {
  emit("info", event, fields);
}

export function logWarn(event: string, fields: LogFields = {}): void {
  emit("warn", event, fields);
}

export function logError(event: string, error: unknown, fields: LogFields = {}): void {
  const description =
    error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error) };
  emit("error", event, { ...fields, error: description });
  // TODO(fase 3): Sentry.captureException(error, { extra: fields }).
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

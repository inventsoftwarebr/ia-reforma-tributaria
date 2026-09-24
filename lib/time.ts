const TIMEZONE = "America/Sao_Paulo";

/**
 * Dia corrente no fuso do Brasil, em ISO (YYYY-MM-DD).
 *
 * O contador diário e o filtro de vigência usam o dia de quem está do outro
 * lado, não o UTC do servidor: às 22h de São Paulo já é o dia seguinte em UTC.
 */
export function brazilDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Data e hora legíveis em pt-BR, para o console e para logs de operação. */
export function brazilDateTime(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function brazilDate(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

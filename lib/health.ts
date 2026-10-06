/**
 * Tradução de erro de conexão com o Postgres para algo que quem configura a
 * Vercel consiga corrigir. Nunca devolve a mensagem original: ela pode trazer
 * endereço do banco ou usuário.
 */
/**
 * O Drizzle embrulha o erro do Postgres ("Failed query: ...") e o código real
 * (28P01, ECONNREFUSED...) fica em `cause`. Percorre a cadeia até achar.
 */
function unwrap(error: unknown): { code: string; message: string } {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error) messages.push(current.message);
    else messages.push(String(current));

    const code =
      typeof current === "object" && current !== null && "code" in current
        ? String((current as { code: unknown }).code)
        : "";
    if (code) return { code, message: messages.join(" | ").toLowerCase() };

    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : undefined;
  }
  return { code: "", message: messages.join(" | ").toLowerCase() };
}

export function describeDatabaseError(error: unknown): string {
  const { code, message } = unwrap(error);

  if (code === "28P01" || message.includes("password authentication failed")) {
    return "senha do banco inválida — confira a senha dentro da DATABASE_URL";
  }
  if (code === "ENOTFOUND" || message.includes("getaddrinfo")) {
    return "endereço do banco não encontrado — confira o host da DATABASE_URL";
  }
  if (code === "CONNECT_TIMEOUT" || message.includes("timeout") || code === "ETIMEDOUT") {
    return "o banco não respondeu em 10 segundos — use o Transaction pooler cujo endereço termina em pooler.supabase.com (porta 6543); os endereços db.<projeto>.supabase.co só funcionam em IPv6, que a Vercel não alcança";
  }
  if (code === "ECONNREFUSED") return "o banco recusou a conexão — confira a porta da DATABASE_URL";
  if (code === "ENETUNREACH" || code === "EHOSTUNREACH") {
    return "endereço do banco inalcançável — confira o host da DATABASE_URL";
  }
  if (code === "3D000") return "o banco informado não existe — confira o final da DATABASE_URL";
  if (code === "42P01") {
    return "o banco conecta, mas as tabelas não existem — rode o db/bootstrap.sql no Supabase";
  }
  if (message.includes("tenant or user not found")) {
    return "o pooler do Supabase não reconheceu o usuário — confira se o usuário é postgres.<ref-do-projeto>";
  }
  return `falha ao conectar${code ? ` (código ${code})` : ""}`;
}

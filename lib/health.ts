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
  if (
    code === "CONNECT_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    code.startsWith("TIMEOUT_") ||
    message.includes("timeout")
  ) {
    return "o banco não respondeu a tempo — use o Transaction pooler cujo endereço termina em pooler.supabase.com (porta 6543); os endereços db.<projeto>.supabase.co só funcionam em IPv6, que a Vercel não alcança";
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

/**
 * O login do console fala direto com o Supabase Auth a partir do navegador.
 * URL ou chave publicável erradas na Vercel deixam o botão "Entrando…" sem
 * resposta clara — aqui o mesmo pedido é feito pelo servidor, com prazo.
 */
export async function checkAuth(
  url: string | undefined,
  key: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!url || !key) return "não verificado — faltam NEXT_PUBLIC_SUPABASE_URL ou a chave publicável";

  let endpoint: string;
  try {
    endpoint = new URL("/auth/v1/settings", url).toString();
  } catch {
    return "NEXT_PUBLIC_SUPABASE_URL não é um endereço válido — copie de Project Settings → API";
  }

  try {
    const response = await fetchImpl(endpoint, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (response.ok) return "ok";
    if (response.status === 401 || response.status === 403) {
      return "o Supabase recusou a chave publicável — confira NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
    }
    return `o Supabase respondeu ${response.status} — confira se NEXT_PUBLIC_SUPABASE_URL é https://<projeto>.supabase.co, sem nada depois`;
  } catch {
    return "o serviço de login do Supabase não respondeu em 8 segundos — confira NEXT_PUBLIC_SUPABASE_URL e se o projeto não está pausado";
  }
}

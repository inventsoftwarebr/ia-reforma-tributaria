/**
 * Validação da DATABASE_URL — o erro de configuração mais provável do projeto.
 *
 * O painel do Supabase mostra várias strings `postgresql://` parecidas. Só a do
 * Transaction pooler (porta 6543) serve para a aplicação na Vercel: com a
 * Session pooler ou a Direct connection (porta 5432) cada função serverless
 * segura uma conexão e o banco esgota o limite sob carga.
 *
 * Devolve a mensagem de erro em português, ou null quando a URL está certa.
 */
export function validateDatabaseUrl(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";

  if (!raw) {
    return "DATABASE_URL está vazia. Use a string do Transaction pooler do Supabase (porta 6543).";
  }

  if (!/^postgres(ql)?:\/\//.test(raw)) {
    return "DATABASE_URL deve começar com postgresql://. Copie do botão Connect do Supabase.";
  }

  if (raw.includes("[YOUR-PASSWORD]")) {
    return "DATABASE_URL ainda tem [YOUR-PASSWORD]: troque pela senha do banco.";
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "DATABASE_URL não é uma URL válida. Se a senha tem @ # / ? ou %, redefina a senha do banco usando só letras e números.";
  }

  const isSupabase = /\.supabase\.(com|co)$/.test(url.hostname);
  if (isSupabase && url.port !== "6543") {
    return `DATABASE_URL está na porta ${url.port || "padrão"}, mas a aplicação precisa do Transaction pooler (porta 6543). A porta 5432 é a do DIRECT_URL.`;
  }

  return null;
}

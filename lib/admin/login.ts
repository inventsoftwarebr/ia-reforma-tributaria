/**
 * Regras do login do console, sem dependência de navegador, para teste.
 */

/**
 * Só aceita destino interno ("/admin/conversas"). Sem isso, um link de login
 * com ?redirect=https://site-falso levaria a pessoa para fora depois de entrar.
 */
export function safeRedirect(value: string | null | undefined): string {
  if (!value) return "/admin";
  // "//x" e "/\x" são interpretados pelo navegador como outro domínio.
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/admin";
  }
  return value;
}

/** Motivos com que o servidor devolve alguém para a tela de login. */
export const LOGIN_REASONS: Record<string, string> = {
  sem_perfil:
    "Seu e-mail e senha estão certos, mas este usuário ainda não tem acesso ao console. Um administrador precisa liberar o perfil (docs/setup.md, parte 6).",
  sessao_expirada: "Sua sessão expirou. Entre de novo.",
};

/** Quanto a tela de login espera antes de dizer que algo travou. */
export const LOGIN_WATCHDOG_MS = 20_000;

/**
 * Mensagem quando o login passa do prazo, conforme a etapa em que parou.
 * "autenticando": o navegador não teve resposta do Supabase Auth.
 * "abrindo": e-mail e senha aceitos, mas o servidor não entregou o painel.
 */
export const LOGIN_SLOW = {
  autenticando:
    'O serviço de login não respondeu em 20 segundos. Abra /api/health e veja a linha "login" — ela diz o que conferir na Vercel.',
  abrindo:
    'Seu e-mail e senha foram aceitos, mas o painel está demorando para abrir. Abra /api/health e veja as linhas "banco" e "tabelas".',
} as const;

/** Traduz o erro do Supabase Auth para algo que a pessoa consiga resolver. */
export function loginErrorMessage(message: string | undefined): string {
  const text = (message ?? "").toLowerCase();
  if (text.includes("invalid login credentials")) return "E-mail ou senha inválidos.";
  if (text.includes("email not confirmed")) {
    return "Este e-mail ainda não foi confirmado. No Supabase, confirme o usuário em Authentication → Users.";
  }
  if (text.includes("fetch") || text.includes("network")) {
    return "Não foi possível falar com o serviço de login. Confira a conexão e tente de novo.";
  }
  return `Não foi possível entrar: ${message ?? "erro desconhecido"}.`;
}

/**
 * Conferência e configuração da instância Evolution pelo console.
 *
 * Quem configura não deveria precisar abrir o Evolution Manager para colar a
 * URL do webhook com o segredo: o console lê o estado, compara com o esperado e
 * oferece configurar. Nunca devolve apikey nem o segredo do webhook — só se
 * batem ou não.
 *
 * A Evolution mudou o formato do webhook entre versões (v1 snake_case, v2.0
 * plano, v2.1+ dentro de `webhook`), então a leitura aceita os três e a escrita
 * tenta do mais novo para o mais antigo.
 */

export const WEBHOOK_EVENT = "MESSAGES_UPSERT";
export const INBOUND_PATH = "/api/whatsapp/inbound";

export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
  instance: string;
}

export interface WebhookSnapshot {
  enabled: boolean;
  url: string;
  events: string[];
  byEvents: boolean;
}

/**
 * User-Agent próprio em toda chamada à Evolution: com ele, quem administra o
 * firewall (Cloudflare) consegue criar uma regra que libere só este sistema.
 */
export const EVOLUTION_USER_AGENT = "InventIA-ReformaTributaria/1.0";

export type Check = { ok: true; text: string } | { ok: false; text: string };

type FetchLike = typeof fetch;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Domínio protegido por senha no EasyPanel ("Basic Auth"): aceita
 * https://usuario:senha@host em EVOLUTION_API_URL. O fetch não aceita
 * credencial dentro da URL, então ela vira cabeçalho Authorization.
 */
export function splitBasicAuth(raw: string): { url: string; authorization?: string } {
  try {
    const url = new URL(raw.trim());
    if (!url.username && !url.password) return { url: raw.trim().replace(/\/+$/, "") };
    const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    url.username = "";
    url.password = "";
    return {
      url: url.toString().replace(/\/+$/, ""),
      authorization: `Basic ${Buffer.from(credentials).toString("base64")}`,
    };
  } catch {
    return { url: raw.trim().replace(/\/+$/, "") };
  }
}

/** O endereço configurado, sem usuário e senha, para mostrar na tela. */
export function displayAddress(raw: string): string {
  try {
    const url = new URL(splitBasicAuth(raw).url);
    const path = url.pathname === "/" ? "" : url.pathname;
    const protegido = /@/.test(raw) ? " (com usuário e senha)" : "";
    return `${url.host}${path}${protegido}`;
  } catch {
    return "(endereço inválido)";
  }
}

function endpoint(config: EvolutionConfig, path: string): string {
  return `${splitBasicAuth(config.baseUrl).url}${path}/${encodeURIComponent(config.instance)}`;
}

function authHeaders(config: EvolutionConfig): Record<string, string> {
  const { authorization } = splitBasicAuth(config.baseUrl);
  return authorization ? { authorization } : {};
}

async function call(
  config: EvolutionConfig,
  path: string,
  fetchImpl: FetchLike,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown; blockedByCloudflare: boolean }> {
  const response = await fetchImpl(endpoint(config, path), {
    method: init.method ?? "GET",
    headers: {
      apikey: config.apiKey,
      "content-type": "application/json",
      "user-agent": EVOLUTION_USER_AGENT,
      ...authHeaders(config),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  const blockedByCloudflare =
    (response.status === 403 || response.status === 503) &&
    (/cloudflare/i.test(response.headers.get("server") ?? "") ||
      response.headers.has("cf-mitigated"));
  return { status: response.status, body, blockedByCloudflare };
}

/** Pendente, URL sem http ou instância vazia: nem adianta chamar. */
export function configProblem(config: EvolutionConfig): string | null {
  const values = [config.baseUrl, config.apiKey, config.instance];
  if (values.some((value) => !value || value.trim().toLowerCase() === "pendente")) {
    return "variáveis EVOLUTION_* ainda não preenchidas na Vercel";
  }
  if (!/^https?:\/\//.test(config.baseUrl.trim())) {
    return "EVOLUTION_API_URL precisa começar com https:// (endereço da Evolution, sem /manager)";
  }
  return null;
}

function requestFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return "a Evolution não respondeu em 10 segundos — confira EVOLUTION_API_URL e se a VPS está no ar";
  }
  return "não foi possível falar com a Evolution — confira EVOLUTION_API_URL";
}

function statusFailure(status: number): string {
  if (status === 401 || status === 403) {
    return "a Evolution recusou a chave — confira EVOLUTION_API_KEY (apikey global)";
  }
  if (status === 404) {
    return "instância não encontrada — confira o nome em EVOLUTION_INSTANCE (maiúsculas contam)";
  }
  return `a Evolution respondeu ${status}`;
}

export interface ServerIdentity {
  evolution: boolean;
  version: string;
  status: number;
  /** O domínio pede usuário e senha antes de chegar à Evolution (EasyPanel). */
  basicAuth: boolean;
  html: boolean;
  /** Proteção na frente do servidor (Cloudflare) barrando a Vercel. */
  cloudflare: boolean;
  /** Resumo técnico da resposta, para quem administra o servidor. */
  detail: string;
}

/**
 * A raiz da Evolution responde sem chave ("Welcome to the Evolution API"). Com
 * isso dá para separar "chave errada" de "endereço que nem é a Evolution" (o
 * Manager, o painel do EasyPanel) e de "domínio com senha do EasyPanel".
 */
export async function identifyServer(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<ServerIdentity> {
  const { url, authorization } = splitBasicAuth(baseUrl);
  try {
    const response = await fetchImpl(`${url}/`, {
      headers: {
        "user-agent": EVOLUTION_USER_AGENT,
        ...(authorization ? { authorization } : {}),
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text().catch(() => "");
    let body: Record<string, unknown> | null = null;
    try {
      body = asRecord(JSON.parse(text));
    } catch {
      body = null;
    }
    const message = String(body?.message ?? "");
    const serverHeader = response.headers.get("server") ?? "";
    const cloudflare =
      /cloudflare/i.test(serverHeader) ||
      response.headers.has("cf-ray") ||
      /cloudflare|attention required|just a moment/i.test(text.slice(0, 2000));
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 80);
    return {
      evolution: /evolution/i.test(message),
      version: typeof body?.version === "string" ? body.version : "",
      status: response.status,
      basicAuth: /basic/i.test(response.headers.get("www-authenticate") ?? ""),
      html: contentType.includes("text/html") || /^\s*</.test(text),
      cloudflare,
      detail: `resposta ${response.status}${serverHeader ? `, servidor "${serverHeader}"` : ""}${
        preview ? `, início: "${preview}"` : ""
      }`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      evolution: false,
      version: "",
      status: 0,
      basicAuth: false,
      html: false,
      cloudflare: false,
      detail: `sem resposta (${reason.slice(0, 80)})`,
    };
  }
}

/** Por que a Evolution recusou o pedido, em linguagem de quem configura. */
export function explainRejection(address: string, server: ServerIdentity): string {
  if (server.evolution) {
    const version = server.version ? ` ${server.version}` : "";
    return `a Evolution${version} em ${address} foi encontrada, mas recusou a chave — EVOLUTION_API_KEY precisa ser a API Key global (AUTHENTICATION_API_KEY no EasyPanel, a mesma usada para entrar no Evolution Manager)`;
  }
  if (server.cloudflare && !server.evolution) {
    return `o Cloudflare na frente de ${address} está barrando o acesso vindo da Vercel (no navegador funciona, porque você passa pela verificação). Peça para liberar esse subdomínio no Cloudflare: desligar "Bot Fight Mode"/desafio para ele, ou criar regra que permita as chamadas da API. Detalhe técnico: ${server.detail}`;
  }
  if (server.basicAuth) {
    return `o domínio ${address} pede usuário e senha antes de chegar à Evolution (proteção do EasyPanel). Desligue essa proteção no domínio da Evolution no EasyPanel, ou coloque os dois no link: https://usuario:senha@${address}`;
  }
  if (server.html) {
    return `${address} abriu uma página, não a API da Evolution — parece o painel do EasyPanel, o Manager ou um firewall. Detalhe técnico: ${server.detail}`;
  }
  if (server.status === 0) {
    return `${address} não respondeu — confira o endereço e se a VPS está no ar`;
  }
  return `${address} recusou o acesso e não se identificou como Evolution API. Detalhe técnico para quem administra o servidor: ${server.detail}`;
}

async function keyRejected(
  config: EvolutionConfig,
  fetchImpl: FetchLike,
): Promise<string> {
  const server = await identifyServer(config.baseUrl, fetchImpl);
  return explainRejection(displayAddress(config.baseUrl), server);
}

export async function connectionCheck(
  config: EvolutionConfig,
  fetchImpl: FetchLike = fetch,
): Promise<Check> {
  try {
    const { status, body } = await call(config, "/instance/connectionState", fetchImpl);
    if (status === 401 || status === 403) {
      return { ok: false, text: await keyRejected(config, fetchImpl) };
    }
    if (status !== 200) return { ok: false, text: statusFailure(status) };
    const instance = asRecord(asRecord(body)?.instance) ?? asRecord(body);
    const state = String(instance?.state ?? "");
    if (state === "open") return { ok: true, text: "WhatsApp conectado" };
    if (state === "connecting") {
      return { ok: false, text: "conectando — leia o QR code no Evolution Manager" };
    }
    return {
      ok: false,
      text: `WhatsApp desconectado (${state || "estado desconhecido"}) — reconecte lendo o QR code no Evolution Manager`,
    };
  } catch (error) {
    return { ok: false, text: requestFailure(error) };
  }
}

/** Lê o webhook nos três formatos conhecidos. `null` = nenhum configurado. */
export function parseWebhook(body: unknown): WebhookSnapshot | null {
  const root = asRecord(body);
  if (!root) return null;
  const data = asRecord(root.webhook) ?? root;
  const url = typeof data.url === "string" ? data.url : "";
  if (!url) return null;
  const events = Array.isArray(data.events)
    ? data.events.filter((event): event is string => typeof event === "string")
    : [];
  return {
    enabled: data.enabled !== false,
    url,
    events: events.map((event) => event.toUpperCase().replace(/\./g, "_")),
    byEvents:
      data.webhookByEvents === true ||
      data.webhook_by_events === true ||
      data.byEvents === true,
  };
}

/** A URL que a Evolution deve chamar. */
export function expectedWebhookUrl(appUrl: string, secret: string): string {
  return `${appUrl.replace(/\/+$/, "")}${INBOUND_PATH}?token=${encodeURIComponent(secret)}`;
}

/**
 * Compara o webhook configurado com o esperado e diz, em linguagem de quem
 * configura, o que está diferente. O segredo nunca aparece na resposta.
 */
export function evaluateWebhook(
  current: WebhookSnapshot | null,
  appUrl: string,
  secret: string,
): Check {
  if (!current) return { ok: false, text: "nenhum webhook configurado na instância" };

  let parsed: URL;
  try {
    parsed = new URL(current.url);
  } catch {
    return { ok: false, text: "o webhook configurado não é um endereço válido" };
  }

  const expected = new URL(appUrl);
  if (parsed.host !== expected.host) {
    return {
      ok: false,
      text: `o webhook aponta para ${parsed.host}, não para ${expected.host}`,
    };
  }
  if (parsed.pathname.replace(/\/+$/, "") !== INBOUND_PATH) {
    return {
      ok: false,
      text: `o webhook aponta para ${parsed.pathname}, não para ${INBOUND_PATH}`,
    };
  }
  if (parsed.searchParams.get("token") !== secret) {
    return {
      ok: false,
      text: "o token do webhook não bate com EVOLUTION_WEBHOOK_SECRET",
    };
  }
  if (!current.enabled) return { ok: false, text: "o webhook está desligado" };
  if (current.byEvents) {
    // Com "por evento", a Evolution acrescenta /messages-upsert ao caminho e
    // a mensagem cai num endereço que não existe.
    return {
      ok: false,
      text: "a opção “Webhook by events” está ligada — precisa ficar desligada",
    };
  }
  if (current.events.length > 0 && !current.events.includes(WEBHOOK_EVENT)) {
    return { ok: false, text: `o evento ${WEBHOOK_EVENT} não está marcado` };
  }
  return { ok: true, text: "webhook apontando para este site" };
}

/**
 * Endereço do webhook para mostrar na tela: valores da query (onde ficam
 * tokens) viram "***". Serve para anotar o destino atual antes de trocar e
 * poder voltar a ele.
 */
export function maskUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "***");
    return decodeURIComponent(url.toString());
  } catch {
    return "(endereço inválido)";
  }
}

export async function webhookCheck(
  config: EvolutionConfig,
  appUrl: string,
  secret: string,
  fetchImpl: FetchLike = fetch,
): Promise<Check & { atual?: string }> {
  try {
    const { status, body, blockedByCloudflare } = await call(
      config,
      "/webhook/find",
      fetchImpl,
    );
    if (blockedByCloudflare) {
      return {
        ok: false,
        text: "não verificado: o mesmo bloqueio do Cloudflare da linha Conexão (não é problema de chave)",
      };
    }
    if (status !== 200) return { ok: false, text: statusFailure(status) };
    const current = parseWebhook(body);
    const check = evaluateWebhook(current, appUrl, secret);
    return current ? { ...check, atual: maskUrl(current.url) } : check;
  } catch (error) {
    return { ok: false, text: requestFailure(error) };
  }
}

/** Corpos aceitos por cada geração da Evolution, do mais novo ao mais antigo. */
export function webhookBodies(url: string): unknown[] {
  return [
    {
      webhook: {
        enabled: true,
        url,
        byEvents: false,
        base64: false,
        events: [WEBHOOK_EVENT],
      },
    },
    {
      enabled: true,
      url,
      webhookByEvents: false,
      webhookBase64: false,
      events: [WEBHOOK_EVENT],
    },
    { enabled: true, url, webhook_by_events: false, events: [WEBHOOK_EVENT] },
  ];
}

export async function configureWebhook(
  config: EvolutionConfig,
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<Check> {
  let lastStatus = 0;
  try {
    for (const body of webhookBodies(url)) {
      const result = await call(config, "/webhook/set", fetchImpl, {
        method: "POST",
        body,
      });
      if (result.status >= 200 && result.status < 300) {
        return { ok: true, text: "webhook configurado" };
      }
      lastStatus = result.status;
      // Chave ou instância erradas não melhoram com outro formato de corpo.
      if (result.status === 401 || result.status === 403 || result.status === 404) break;
    }
  } catch (error) {
    return { ok: false, text: requestFailure(error) };
  }
  if (lastStatus === 401 || lastStatus === 403) {
    return { ok: false, text: await keyRejected(config, fetchImpl) };
  }
  return { ok: false, text: statusFailure(lastStatus) };
}

/** Uma chamada como ela chegou, com o que o firewall devolve para rastrear. */
async function probe(
  url: string,
  headers: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<string> {
  const at = new Date();
  try {
    const response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const parts = [`HTTP ${response.status}`];
    for (const header of ["server", "cf-ray", "cf-mitigated", "cf-cache-status"]) {
      const value = response.headers.get(header);
      if (value) parts.push(`${header}: ${value}`);
    }
    const text = await response.text().catch(() => "");
    const title = /<title>([^<]{0,80})<\/title>/i.exec(text)?.[1];
    if (title) parts.push(`página: "${title.trim()}"`);
    return `${parts.join(" | ")} | às ${at.toISOString()}`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `sem resposta (${reason.slice(0, 80)}) | às ${at.toISOString()}`;
  }
}

/**
 * Relatório para quem administra o domínio da Evolution: o que foi pedido, de
 * onde, quando e o que o firewall respondeu (Ray ID do Cloudflare incluído).
 * Não contém chave nem senha.
 */
export async function blockReport(
  config: EvolutionConfig,
  region: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const { url, authorization } = splitBasicAuth(config.baseUrl);
  const base = {
    "user-agent": EVOLUTION_USER_AGENT,
    ...(authorization ? { authorization } : {}),
  };
  const instancePath = `/instance/connectionState/${encodeURIComponent(config.instance)}`;
  const [root, instance] = await Promise.all([
    probe(`${url}/`, base, fetchImpl),
    probe(`${url}${instancePath}`, { ...base, apikey: config.apiKey }, fetchImpl),
  ]);
  const agora = new Date();
  const brasilia = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(agora);

  return [
    "Bloqueio nas chamadas da IA da Reforma Tributária para a Evolution API",
    `Gerado em: ${brasilia} (Brasília) / ${agora.toISOString()} (UTC)`,
    `Domínio: ${new URL(url).host}`,
    `Origem: funções da Vercel, região ${region} (IPs dinâmicos, sem IP fixo)`,
    `User-Agent enviado: ${EVOLUTION_USER_AGENT}`,
    "",
    `1) GET / -> ${root}`,
    `2) GET ${instancePath} (com cabeçalho apikey) -> ${instance}`,
    "",
    "O que precisa: liberar no Cloudflare as chamadas de servidor para este subdomínio.",
    'Opções: (a) deixar o registro DNS do subdomínio como "DNS only" (nuvem cinza);',
    "(b) desligar o Bot Fight Mode / desafio para ele; ou (c) regra de WAF que pule as",
    "proteções quando o User-Agent for o acima e houver o cabeçalho apikey. No plano",
    "gratuito do Cloudflare o Bot Fight Mode não aceita exceção por regra: (a) ou (b).",
  ].join("\n");
}

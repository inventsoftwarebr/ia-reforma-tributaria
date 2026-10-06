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

export type Check = { ok: true; text: string } | { ok: false; text: string };

type FetchLike = typeof fetch;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function endpoint(config: EvolutionConfig, path: string): string {
  return `${config.baseUrl.replace(/\/+$/, "")}${path}/${encodeURIComponent(config.instance)}`;
}

async function call(
  config: EvolutionConfig,
  path: string,
  fetchImpl: FetchLike,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(endpoint(config, path), {
    method: init.method ?? "GET",
    headers: { apikey: config.apiKey, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body };
}

/** Pendente, URL sem http ou instância vazia: nem adianta chamar. */
export function configProblem(config: EvolutionConfig): string | null {
  const values = [config.baseUrl, config.apiKey, config.instance];
  if (values.some((value) => !value || value.trim().toLowerCase() === "pendente")) {
    return "variáveis EVOLUTION_* ainda não preenchidas na Vercel";
  }
  if (!/^https?:\/\//.test(config.baseUrl)) {
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

/**
 * A raiz da Evolution responde sem chave ("Welcome to the Evolution API"). Com
 * isso dá para separar "chave errada" de "endereço que nem é a Evolution" (o
 * Manager, o painel do EasyPanel), que também podem responder 401.
 */
export async function identifyServer(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ evolution: boolean; version: string }> {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/`, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const body = asRecord(await response.json().catch(() => null));
    const message = String(body?.message ?? "");
    return {
      evolution: /evolution/i.test(message),
      version: typeof body?.version === "string" ? body.version : "",
    };
  } catch {
    return { evolution: false, version: "" };
  }
}

async function keyRejected(
  config: EvolutionConfig,
  fetchImpl: FetchLike,
): Promise<string> {
  const server = await identifyServer(config.baseUrl, fetchImpl);
  if (!server.evolution) {
    return "o endereço em EVOLUTION_API_URL pediu senha, mas não respondeu como Evolution API — use o endereço da API (o mesmo que o Manager pede como “Server URL”), sem /manager e sem o endereço do EasyPanel";
  }
  const version = server.version ? ` ${server.version}` : "";
  return `a Evolution${version} foi encontrada, mas recusou a chave — EVOLUTION_API_KEY precisa ser a API Key global (a mesma usada para entrar no Evolution Manager)`;
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
    const { status, body } = await call(config, "/webhook/find", fetchImpl);
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
  return { ok: false, text: statusFailure(lastStatus) };
}

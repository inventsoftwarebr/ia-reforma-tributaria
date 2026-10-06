import { describe, expect, it } from "vitest";
import {
  configProblem,
  configureWebhook,
  connectionCheck,
  evaluateWebhook,
  expectedWebhookUrl,
  parseWebhook,
  webhookBodies,
} from "./evolution-admin";

const CONFIG = {
  baseUrl: "https://evo.invent.app/",
  apiKey: "chave",
  instance: "invent teste",
};
const SITE = "https://ia-reforma-tributaria-zeta.vercel.app";
const SEGREDO = "segredo-com-mais-de-16";
const CERTA = expectedWebhookUrl(SITE, SEGREDO);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

describe("configProblem", () => {
  it("variável ainda como 'pendente'", () => {
    expect(configProblem({ ...CONFIG, apiKey: "pendente" })).toMatch(/não preenchidas/);
  });

  it("URL sem https", () => {
    expect(configProblem({ ...CONFIG, baseUrl: "evo.invent.app" })).toMatch(/https:\/\//);
  });

  it("configuração completa", () => {
    expect(configProblem(CONFIG)).toBeNull();
  });
});

describe("connectionCheck", () => {
  it("chama a instância certa com a apikey e reconhece 'open'", async () => {
    let chamada = "";
    let apikey = "";
    const fake: typeof fetch = async (input, init) => {
      chamada = String(input);
      apikey = new Headers(init?.headers).get("apikey") ?? "";
      return json(200, { instance: { instanceName: "invent teste", state: "open" } });
    };
    expect(await connectionCheck(CONFIG, fake)).toEqual({
      ok: true,
      text: "WhatsApp conectado",
    });
    expect(chamada).toBe(
      "https://evo.invent.app/instance/connectionState/invent%20teste",
    );
    expect(apikey).toBe("chave");
  });

  it("desconectado pede o QR code", async () => {
    const fake: typeof fetch = async () => json(200, { instance: { state: "close" } });
    const check = await connectionCheck(CONFIG, fake);
    expect(check.ok).toBe(false);
    expect(check.text).toMatch(/QR code/);
  });

  it("chave errada numa Evolution de verdade", async () => {
    const fake: typeof fetch = async (input) =>
      String(input) === "https://evo.invent.app/"
        ? json(200, {
            message: "Welcome to the Evolution API, it is working!",
            version: "2.2.3",
          })
        : json(401, { message: "Unauthorized" });
    const check = await connectionCheck(CONFIG, fake);
    expect(check.ok).toBe(false);
    expect(check.text).toMatch(/Evolution 2\.2\.3 foi encontrada, mas recusou a chave/);
    expect(check.text).toMatch(/Manager/);
  });

  it("endereço que pede senha mas não é a Evolution (Manager, EasyPanel)", async () => {
    const fake: typeof fetch = async () =>
      new Response("<html>login</html>", { status: 401 });
    expect((await connectionCheck(CONFIG, fake)).text).toMatch(
      /não respondeu como Evolution API/,
    );
  });

  it("instância com nome errado", async () => {
    const fake: typeof fetch = async () => json(404, {});
    expect((await connectionCheck(CONFIG, fake)).text).toMatch(/EVOLUTION_INSTANCE/);
  });

  it("Evolution fora do ar", async () => {
    const fake: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect((await connectionCheck(CONFIG, fake)).text).toMatch(/EVOLUTION_API_URL/);
  });
});

describe("parseWebhook", () => {
  it("formato v2.1+ (dentro de webhook)", () => {
    expect(
      parseWebhook({
        webhook: { enabled: true, url: CERTA, events: ["MESSAGES_UPSERT"] },
      }),
    ).toMatchObject({ url: CERTA, enabled: true, byEvents: false });
  });

  it("formato v2.0 (plano)", () => {
    expect(
      parseWebhook({ url: CERTA, webhookByEvents: true, events: [] })?.byEvents,
    ).toBe(true);
  });

  it("formato v1 (snake_case e evento com ponto)", () => {
    expect(
      parseWebhook({ url: CERTA, webhook_by_events: false, events: ["messages.upsert"] })
        ?.events,
    ).toEqual(["MESSAGES_UPSERT"]);
  });

  it("sem webhook", () => {
    expect(parseWebhook(null)).toBeNull();
    expect(parseWebhook({ enabled: false })).toBeNull();
  });
});

describe("evaluateWebhook", () => {
  const base = {
    enabled: true,
    url: CERTA,
    events: ["MESSAGES_UPSERT"],
    byEvents: false,
  };

  it("tudo certo", () => {
    expect(evaluateWebhook(base, SITE, SEGREDO).ok).toBe(true);
  });

  it("aponta para o domínio de outra pessoa", () => {
    const outro = {
      ...base,
      url: expectedWebhookUrl("https://ia-reforma-tributaria.vercel.app", SEGREDO),
    };
    expect(evaluateWebhook(outro, SITE, SEGREDO).text).toMatch(
      /aponta para ia-reforma-tributaria\.vercel\.app/,
    );
  });

  it("ainda aponta para o n8n", () => {
    const n8n = { ...base, url: "https://n8n.vps.app/webhook/abc" };
    expect(evaluateWebhook(n8n, SITE, SEGREDO).ok).toBe(false);
  });

  it("token diferente, sem mostrar nenhum dos dois", () => {
    const check = evaluateWebhook(
      { ...base, url: expectedWebhookUrl(SITE, "outro-segredo-qualquer") },
      SITE,
      SEGREDO,
    );
    expect(check.text).toMatch(/token/);
    expect(check.text).not.toContain(SEGREDO);
    expect(check.text).not.toContain("outro-segredo");
  });

  it("webhook by events ligado", () => {
    expect(evaluateWebhook({ ...base, byEvents: true }, SITE, SEGREDO).text).toMatch(
      /by events/,
    );
  });

  it("evento errado", () => {
    expect(
      evaluateWebhook({ ...base, events: ["QRCODE_UPDATED"] }, SITE, SEGREDO).text,
    ).toMatch(/MESSAGES_UPSERT/);
  });

  it("desligado", () => {
    expect(evaluateWebhook({ ...base, enabled: false }, SITE, SEGREDO).text).toMatch(
      /desligado/,
    );
  });
});

describe("configureWebhook", () => {
  it("cai para o formato antigo quando o novo é recusado", async () => {
    const corpos: unknown[] = [];
    const fake: typeof fetch = async (_input, init) => {
      corpos.push(JSON.parse(String(init?.body)));
      return corpos.length < 3
        ? json(400, { message: "url is required" })
        : json(201, {});
    };
    expect(await configureWebhook(CONFIG, CERTA, fake)).toEqual({
      ok: true,
      text: "webhook configurado",
    });
    expect(corpos).toEqual(webhookBodies(CERTA));
  });

  it("não insiste com chave errada", async () => {
    let chamadas = 0;
    const fake: typeof fetch = async () => {
      chamadas += 1;
      return json(401, {});
    };
    expect((await configureWebhook(CONFIG, CERTA, fake)).ok).toBe(false);
    expect(chamadas).toBe(1);
  });

  it("todo corpo desliga o 'by events' e assina só MESSAGES_UPSERT", () => {
    for (const corpo of webhookBodies(CERTA)) {
      const texto = JSON.stringify(corpo);
      expect(texto).toContain('"events":["MESSAGES_UPSERT"]');
      expect(texto).toMatch(/"(byEvents|webhookByEvents|webhook_by_events)":false/);
    }
  });
});

describe("expectedWebhookUrl", () => {
  it("monta o caminho de entrada com o token codificado", () => {
    expect(expectedWebhookUrl(`${SITE}/`, "a b&c")).toBe(
      `${SITE}/api/whatsapp/inbound?token=a%20b%26c`,
    );
  });
});

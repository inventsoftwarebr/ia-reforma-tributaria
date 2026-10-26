import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {} }));

const { OFFICIAL_CATALOG, assertFetchableUrl, isOfficialHost, shapeForKind } =
  await import("./official");
const { isTemporaryFailure, pgArray } = await import("./ingest");
const { slugify } = await import("./console");

describe("isOfficialHost", () => {
  it("aceita governo e Legislativo", () => {
    for (const host of [
      "www.planalto.gov.br",
      "www.gov.br",
      "in.gov.br",
      "www.camara.leg.br",
      "www25.senado.leg.br",
    ]) {
      expect(isOfficialHost(host), host).toBe(true);
    }
  });

  it("recusa o resto, inclusive imitação", () => {
    for (const host of ["www.inventsoftware.com.br", "gov.br.golpe.com", "blog.com.br"]) {
      expect(isOfficialHost(host), host).toBe(false);
    }
  });
});

describe("assertFetchableUrl", () => {
  it("aceita https com domínio", () => {
    expect(assertFetchableUrl("https://www.gov.br/fazenda").hostname).toBe("www.gov.br");
  });

  it("recusa o que abriria a rede interna", () => {
    for (const url of [
      "http://www.gov.br",
      "https://127.0.0.1/admin",
      "https://localhost/",
      "https://[::1]/",
      "https://servico.internal/",
      "nem é link",
    ]) {
      expect(() => assertFetchableUrl(url), url).toThrow();
    }
  });
});

describe("catálogo oficial", () => {
  it("só tem norma de site de governo, cortada por artigo", () => {
    for (const entry of OFFICIAL_CATALOG) {
      expect(isOfficialHost(new URL(entry.url).hostname)).toBe(true);
      expect(entry.shape).toBe("legal");
      expect(entry.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("shapeForKind", () => {
  it("norma por artigo, o resto por seção", () => {
    expect(shapeForKind("lei_complementar")).toBe("legal");
    expect(shapeForKind("instrucao_normativa")).toBe("legal");
    expect(shapeForKind("faq")).toBe("markdown");
    expect(shapeForKind("nota_tecnica")).toBe("markdown");
  });
});

describe("isTemporaryFailure", () => {
  it("cota esgotada do Gemini, mesmo embrulhada", () => {
    const api = Object.assign(new Error("Resource has been exhausted"), {
      statusCode: 429,
    });
    expect(isTemporaryFailure(new Error("falhou", { cause: api }))).toBe(true);
  });

  it("instabilidade depois das tentativas do AI SDK (como aconteceu em produção)", () => {
    const api = Object.assign(new Error("The service is currently unavailable"), {
      statusCode: 503,
    });
    const retry = Object.assign(
      new Error(
        "Failed after 3 attempts. Last error: The service is currently unavailable.",
      ),
      { lastError: api },
    );
    expect(isTemporaryFailure(retry)).toBe(true);
  });

  it("erro de configuração não é temporário", () => {
    const api = Object.assign(new Error("API key not valid"), { statusCode: 400 });
    expect(isTemporaryFailure(api)).toBe(false);
  });
});

describe("pgArray", () => {
  it("monta literal de array do Postgres", () => {
    expect(pgArray(["a", "b"], false)).toBe("{a,b}");
    expect(pgArray(["[1,2]"], true)).toBe('{"[1,2]"}');
  });
});

describe("slugify", () => {
  it("chave estável a partir do título", () => {
    expect(slugify("Perguntas e Respostas — CBS (Receita)")).toBe(
      "perguntas-e-respostas-cbs-receita",
    );
  });
});

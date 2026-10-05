import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache, serverEnv, simulatorLink } from "./env";

const BASE: Record<string, string> = {
  APP_URL: "https://ia.vercel.app",
  DATABASE_URL:
    "postgresql://postgres.abc:Senha123@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  EVOLUTION_API_URL: "https://evo.example",
  EVOLUTION_API_KEY: "k",
  EVOLUTION_INSTANCE: "invent",
  EVOLUTION_WEBHOOK_SECRET: "0123456789abcdef0123",
};

const original = { ...process.env };

function useEnv(vars: Record<string, string>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, vars);
  resetEnvCache();
}

describe("variáveis de ambiente", () => {
  beforeEach(() => useEnv(BASE));
  afterEach(() => useEnv(original as Record<string, string>));

  it("Gemini é o padrão para conversa e busca", () => {
    useEnv({ ...BASE, GOOGLE_GENERATIVE_AI_API_KEY: "g" });
    const env = serverEnv();
    expect(env.AI_PROVIDER).toBe("google");
    expect(env.AI_MODEL).toBe("gemini-3.5-flash");
    expect(env.EMBEDDING_PROVIDER).toBe("google");
    expect(env.AI_EMBEDDING_MODEL).toBe("gemini-embedding-2");
  });

  it("sem as variáveis do simulador, usa o link e a UTM do fluxo original", () => {
    useEnv({ ...BASE, GOOGLE_GENERATIVE_AI_API_KEY: "g" });
    expect(simulatorLink()).toBe(
      "https://lp.inventsoftware.com.br/simulador-reforma-tributaria/?utm_source=ia+whatsapp+mkt&utm_campaign=simulador+da+reforma+tributaria",
    );
  });

  it("marketing troca o link pela variável", () => {
    useEnv({
      ...BASE,
      GOOGLE_GENERATIVE_AI_API_KEY: "g",
      SIMULATOR_URL: "https://lp.inventsoftware.com.br/novo-simulador/",
      SIMULATOR_UTM: "utm_source=whatsapp",
    });
    expect(simulatorLink()).toBe("https://lp.inventsoftware.com.br/novo-simulador/?utm_source=whatsapp");
  });

  it("sem a chave do Gemini, diz qual falta", () => {
    expect(() => serverEnv()).toThrow(/GOOGLE_GENERATIVE_AI_API_KEY: faltando/);
  });

  it("com Gemini, não exige chave da Anthropic nem da OpenAI", () => {
    useEnv({ ...BASE, GOOGLE_GENERATIVE_AI_API_KEY: "g" });
    expect(() => serverEnv()).not.toThrow();
  });

  it("embedding pela OpenAI exige a chave da OpenAI", () => {
    useEnv({ ...BASE, GOOGLE_GENERATIVE_AI_API_KEY: "g", EMBEDDING_PROVIDER: "openai" });
    expect(() => serverEnv()).toThrow(/OPENAI_API_KEY: faltando/);
  });

  it("conversa pela Anthropic exige a chave da Anthropic", () => {
    useEnv({ ...BASE, GOOGLE_GENERATIVE_AI_API_KEY: "g", AI_PROVIDER: "anthropic" });
    expect(() => serverEnv()).toThrow(/ANTHROPIC_API_KEY: faltando/);
  });

  it("aponta a DATABASE_URL na porta errada", () => {
    useEnv({
      ...BASE,
      GOOGLE_GENERATIVE_AI_API_KEY: "g",
      DATABASE_URL: BASE.DATABASE_URL!.replace(":6543", ":5432"),
    });
    expect(() => serverEnv()).toThrow(/porta 5432/);
  });
});

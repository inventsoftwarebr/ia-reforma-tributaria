import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { webhookTarget } from "./status";

const BASE: Record<string, string> = {
  DATABASE_URL:
    "postgresql://postgres.abc:Senha123@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  GOOGLE_GENERATIVE_AI_API_KEY: "g",
  EVOLUTION_API_URL: "https://evo.example",
  EVOLUTION_API_KEY: "k",
  EVOLUTION_INSTANCE: "invent",
  EVOLUTION_WEBHOOK_SECRET: "0123456789abcdef0123",
  VERCEL_PROJECT_PRODUCTION_URL: "ia-reforma-tributaria-zeta.vercel.app",
};

const original = { ...process.env };

function useEnv(vars: Record<string, string>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, vars);
  resetEnvCache();
}

describe("webhookTarget", () => {
  afterEach(() => useEnv(original as Record<string, string>));

  it("sem APP_URL, usa o domínio do projeto", () => {
    useEnv(BASE);
    const target = webhookTarget();
    expect(target.ok).toBe(true);
    expect(target.url).toBe(
      "https://ia-reforma-tributaria-zeta.vercel.app/api/whatsapp/inbound?token=0123456789abcdef0123",
    );
  });

  it("recusa APP_URL de outro domínio — a mensagem iria para o site de outra pessoa", () => {
    useEnv({ ...BASE, APP_URL: "https://ia-reforma-tributaria.vercel.app" });
    const target = webhookTarget();
    expect(target.ok).toBe(false);
    expect(target.url).toBeUndefined();
    expect(target.text).toMatch(/corrija APP_URL/);
  });

  it("aceita APP_URL igual ao domínio, com ou sem barra", () => {
    useEnv({ ...BASE, APP_URL: "https://ia-reforma-tributaria-zeta.vercel.app/" });
    expect(webhookTarget().ok).toBe(true);
  });
});

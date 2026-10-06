import { describe, expect, it } from "vitest";
import { checkAuth, describeDatabaseError } from "./health";
import { TimeoutError } from "./timeout";

const pgError = (code: string, message = "") => Object.assign(new Error(message), { code });

describe("describeDatabaseError", () => {
  it("senha errada", () => {
    expect(describeDatabaseError(pgError("28P01"))).toMatch(/senha do banco/);
  });

  it("host errado", () => {
    expect(describeDatabaseError(pgError("ENOTFOUND"))).toMatch(/endereço do banco/);
  });

  it("banco que não responde", () => {
    expect(describeDatabaseError(pgError("CONNECT_TIMEOUT"))).toMatch(/não respondeu a tempo/);
  });

  it("consulta que conecta mas nunca volta", () => {
    expect(describeDatabaseError(new TimeoutError("banco", 12_000))).toMatch(/pooler\.supabase\.com/);
  });

  it("tabelas ausentes aponta o bootstrap", () => {
    expect(describeDatabaseError(pgError("42P01"))).toMatch(/bootstrap/);
  });

  it("usuário do pooler errado", () => {
    expect(describeDatabaseError(new Error("Tenant or user not found"))).toMatch(/postgres\.<ref/);
  });

  it("acha o código dentro do erro embrulhado pelo Drizzle", () => {
    // É assim que o erro chega de verdade: "Failed query" por fora, Postgres em cause.
    const drizzle = new Error('Failed query: select "role" from "profiles"', {
      cause: pgError("28P01", "password authentication failed for user postgres"),
    });
    expect(describeDatabaseError(drizzle)).toMatch(/senha do banco/);
  });

  it("conexão recusada embrulhada", () => {
    const drizzle = new Error("Failed query: select 1", {
      cause: pgError("ECONNREFUSED", "connect ECONNREFUSED 192.0.2.1:5432"),
    });
    expect(describeDatabaseError(drizzle)).toMatch(/recusou a conexão/);
  });

  it("nunca repete a mensagem original, que pode ter dado sensível", () => {
    const resultado = describeDatabaseError(pgError("XX000", "falhou em db.abcdef.supabase.co"));
    expect(resultado).not.toContain("abcdef");
    expect(resultado).toMatch(/XX000/);
  });
});

describe("checkAuth", () => {
  const URL_OK = "https://abc.supabase.co";
  const resposta = (status: number) => async () => new Response("{}", { status });

  it("ok quando o Supabase responde", async () => {
    expect(await checkAuth(URL_OK, "sb_publishable_x", resposta(200))).toBe("ok");
  });

  it("chave recusada", async () => {
    expect(await checkAuth(URL_OK, "errada", resposta(401))).toMatch(/chave publicável/);
  });

  it("endereço que não é do Auth", async () => {
    expect(await checkAuth(URL_OK, "k", resposta(404))).toMatch(/respondeu 404/);
  });

  it("endereço inválido", async () => {
    expect(await checkAuth("abc.supabase.co", "k", resposta(200))).toMatch(/não é um endereço válido/);
  });

  it("serviço que não responde", async () => {
    const falha = async () => {
      throw new Error("aborted");
    };
    expect(await checkAuth(URL_OK, "k", falha)).toMatch(/não respondeu/);
  });

  it("sem variáveis", async () => {
    expect(await checkAuth(undefined, "k", resposta(200))).toMatch(/não verificado/);
  });
});

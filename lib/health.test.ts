import { describe, expect, it } from "vitest";
import { describeDatabaseError } from "./health";

const pgError = (code: string, message = "") => Object.assign(new Error(message), { code });

describe("describeDatabaseError", () => {
  it("senha errada", () => {
    expect(describeDatabaseError(pgError("28P01"))).toMatch(/senha do banco/);
  });

  it("host errado", () => {
    expect(describeDatabaseError(pgError("ENOTFOUND"))).toMatch(/endereço do banco/);
  });

  it("banco que não responde", () => {
    expect(describeDatabaseError(pgError("CONNECT_TIMEOUT"))).toMatch(/10 segundos/);
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

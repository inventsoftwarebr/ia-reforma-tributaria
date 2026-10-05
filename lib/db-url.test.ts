import { describe, expect, it } from "vitest";
import { validateDatabaseUrl } from "./db-url";

const POOLER =
  "postgresql://postgres.abcdefghijkl:SenhaForte123@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";

describe("validateDatabaseUrl", () => {
  it("aceita o Transaction pooler do Supabase", () => {
    expect(validateDatabaseUrl(POOLER)).toBeNull();
  });

  it("aceita banco local em qualquer porta", () => {
    expect(validateDatabaseUrl("postgresql://ci@127.0.0.1:5432/ia_test")).toBeNull();
    expect(validateDatabaseUrl("postgres://user:pw@localhost:5599/db")).toBeNull();
  });

  it("recusa vazia", () => {
    expect(validateDatabaseUrl(undefined)).toMatch(/vazia/);
    expect(validateDatabaseUrl("   ")).toMatch(/vazia/);
  });

  it("recusa o Session pooler na porta 5432", () => {
    expect(validateDatabaseUrl(POOLER.replace(":6543", ":5432"))).toMatch(/porta 5432/);
  });

  it("recusa a Direct connection", () => {
    expect(
      validateDatabaseUrl(
        "postgresql://postgres:Senha123@db.abcdefghijkl.supabase.co:5432/postgres",
      ),
    ).toMatch(/6543/);
  });

  it("recusa o placeholder de senha esquecido", () => {
    expect(
      validateDatabaseUrl(POOLER.replace("SenhaForte123", "[YOUR-PASSWORD]")),
    ).toMatch(/YOUR-PASSWORD/);
  });

  it("recusa o que não é URL de Postgres", () => {
    expect(validateDatabaseUrl("https://abcdefghijkl.supabase.co")).toMatch(
      /postgresql:\/\//,
    );
  });

  it("recusa senha com caractere que quebra a URL", () => {
    expect(
      validateDatabaseUrl(
        "postgresql://postgres.abc:Se#nha@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
      ),
    ).not.toBeNull();
  });
});

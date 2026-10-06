import { describe, expect, it } from "vitest";
import { CONNECTION_OPTIONS } from "./client";

describe("CONNECTION_OPTIONS", () => {
  it("segue as regras do Supavisor em transaction mode", () => {
    expect(CONNECTION_OPTIONS.max).toBe(1);
    expect(CONNECTION_OPTIONS.prepare).toBe(false);
  });

  it("nunca envia consultas em lote na mesma conexão", () => {
    // Com o padrão (100), o painel ficava "carregando" em produção.
    expect(CONNECTION_OPTIONS.max_pipeline).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { CONNECTION_OPTIONS } from "./client";

describe("CONNECTION_OPTIONS", () => {
  it("segue as regras do Supavisor em transaction mode", () => {
    expect(CONNECTION_OPTIONS.max).toBe(1);
    expect(CONNECTION_OPTIONS.prepare).toBe(false);
  });

  it("não desliga o envio em lote na biblioteca: isso quebra transações", () => {
    // A serialização fica em db/serialize.ts; max_pipeline: 0 fazia o begin
    // falhar com "Cannot set properties of undefined (setting 'onclose')".
    expect("max_pipeline" in CONNECTION_OPTIONS).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const { formatStep, timedStep } = await import("./diagnose");

describe("timedStep", () => {
  it("mede o tempo de uma etapa que responde", async () => {
    const step = await timedStep(
      () => Promise.resolve([{ role: "admin" }]),
      100,
      "banco",
    );
    expect(step.ok).toBe(true);
    expect(formatStep(step, "admin")).toMatch(/^admin \(\d+ ms\)$/);
  });

  it("diz quando a etapa passou do prazo", async () => {
    const step = await timedStep(() => new Promise<never>(() => {}), 30, "banco");
    expect(formatStep(step)).toMatch(/não respondeu em 0.03s/);
  });

  it("traduz erro de banco sem expor a mensagem original", async () => {
    const erro = Object.assign(new Error("password authentication failed for user x"), {
      code: "28P01",
    });
    const step = await timedStep(() => Promise.reject(erro), 100, "banco");
    expect(formatStep(step)).toMatch(/senha do banco/);
    expect(formatStep(step)).not.toMatch(/user x/);
  });
});

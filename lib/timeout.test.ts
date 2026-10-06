import { describe, expect, it } from "vitest";
import { TimeoutError, withTimeout } from "./timeout";

describe("withTimeout", () => {
  it("devolve o resultado quando responde a tempo", async () => {
    await expect(withTimeout(Promise.resolve(42), 50, "banco")).resolves.toBe(42);
  });

  it("falha com código próprio quando não responde", async () => {
    const pendurada = new Promise<never>(() => {});
    const erro = await withTimeout(pendurada, 20, "banco").catch(
      (error: unknown) => error,
    );
    expect(erro).toBeInstanceOf(TimeoutError);
    expect((erro as TimeoutError).code).toBe("TIMEOUT_BANCO");
  });

  it("repassa o erro original", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("x")), 50, "banco"),
    ).rejects.toThrow("x");
  });
});

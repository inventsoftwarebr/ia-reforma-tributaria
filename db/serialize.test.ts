import { describe, expect, it } from "vitest";
import { serializeQueries } from "./serialize";

function fakeClient() {
  const events: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const work = (label: string, ms: number) =>
    new Promise((resolve) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      events.push(`start ${label}`);
      setTimeout(() => {
        inFlight -= 1;
        events.push(`end ${label}`);
        resolve(label);
      }, ms);
    });
  const client = {
    options: { parsers: {} },
    unsafe(query: string) {
      const pending = {
        then: (a: (value: unknown) => unknown, b: (reason: unknown) => unknown) =>
          work(query, 15).then(a, b),
        values: () => work(`${query}:values`, 15),
      };
      return pending;
    },
    begin(fn: () => Promise<unknown>) {
      return work("begin", 5).then(fn);
    },
  };
  return { client, events, max: () => maxInFlight };
}

describe("serializeQueries", () => {
  it("consultas em paralelo saem uma de cada vez", async () => {
    const fake = fakeClient();
    const db = serializeQueries(fake.client);
    const results = await Promise.all([
      db.unsafe("a"),
      db.unsafe("b").values(),
      db.unsafe("c"),
    ]);
    expect(results).toEqual(["a", "b:values", "c"]);
    expect(fake.max()).toBe(1);
    // Nunca duas ao mesmo tempo: cada início vem logo depois de um fim.
    fake.events.forEach((event, index) => {
      expect(event.startsWith(index % 2 === 0 ? "start" : "end")).toBe(true);
    });
  });

  it("transação inteira segura a fila até terminar", async () => {
    const fake = fakeClient();
    const db = serializeQueries(fake.client);
    const tx = db.begin(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      fake.events.push("tx body");
    });
    const depois = db.unsafe("depois");
    await Promise.all([tx, depois]);
    expect(fake.events.indexOf("tx body")).toBeLessThan(
      fake.events.indexOf("start depois"),
    );
  });

  it("um erro não trava a fila", async () => {
    const fake = fakeClient();
    const db = serializeQueries(fake.client);
    const failing = db.begin(() => Promise.reject(new Error("falhou")));
    await expect(failing).rejects.toThrow("falhou");
    await expect(db.unsafe("segue")).resolves.toBe("segue");
  });

  it("o resto do cliente passa direto", () => {
    const fake = fakeClient();
    expect(serializeQueries(fake.client).options).toBe(fake.client.options);
  });
});

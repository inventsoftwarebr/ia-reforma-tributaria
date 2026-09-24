import { describe, expect, it } from "vitest";
import { brazilDate, brazilDateTime, brazilDay } from "./time";

describe("dia no fuso do Brasil", () => {
  it("02:00 UTC de 1º de janeiro ainda é 31 de dezembro em São Paulo", () => {
    expect(brazilDay(new Date("2026-01-01T02:00:00Z"))).toBe("2025-12-31");
  });

  it("vira o dia no horário local", () => {
    expect(brazilDay(new Date("2026-01-01T03:30:00Z"))).toBe("2026-01-01");
  });

  it("formata data e hora em pt-BR", () => {
    expect(brazilDate(new Date("2026-03-15T15:00:00Z"))).toBe("15/03/2026");
    expect(brazilDateTime(new Date("2026-03-15T15:00:00Z"))).toBe("15/03/2026, 12:00");
  });
});

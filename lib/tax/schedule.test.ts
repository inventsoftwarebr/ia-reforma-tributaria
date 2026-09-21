import { describe, expect, it } from "vitest";
import { PHASES, currentPhase, phasesForYear } from "./schedule";
import { brazilDay } from "@/lib/conversations/repository";

describe("cronograma", () => {
  it("fases estão em ordem crescente de ano", () => {
    const years = PHASES.map((phase) => phase.year);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
  });

  it("toda fase declara a norma de origem", () => {
    for (const phase of PHASES) {
      expect(phase.source.length).toBeGreaterThan(0);
    }
  });

  it("filtra por ano", () => {
    expect(phasesForYear(2026)).toHaveLength(1);
    expect(phasesForYear(2026)[0]?.rates.map((rate) => rate.tribute)).toEqual([
      "CBS",
      "IBS",
    ]);
    expect(phasesForYear(2024)).toEqual([]);
  });

  it("fase vigente é a última iniciada", () => {
    expect(currentPhase(new Date("2026-06-01T12:00:00Z"))?.year).toBe(2026);
    expect(currentPhase(new Date("2028-06-01T12:00:00Z"))?.year).toBe(2027);
    expect(currentPhase(new Date("2035-06-01T12:00:00Z"))?.year).toBe(2033);
  });
});

describe("dia no fuso do Brasil", () => {
  it("usa America/Sao_Paulo, não UTC nem Lisboa (achado B3)", () => {
    // 02:00 UTC de 1º de janeiro ainda é 31 de dezembro em São Paulo.
    expect(brazilDay(new Date("2026-01-01T02:00:00Z"))).toBe("2025-12-31");
  });

  it("vira o dia no horário local", () => {
    expect(brazilDay(new Date("2026-01-01T03:30:00Z"))).toBe("2026-01-01");
  });
});

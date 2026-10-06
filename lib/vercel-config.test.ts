import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * O plano Hobby da Vercel recusa o deploy inteiro se alguma rotina (cron)
 * rodar mais de uma vez por dia — e recusa antes do build, sem log, só com
 * "Deployment failed". Já aconteceu aqui com um agendamento de 10 em 10
 * minutos. Este teste impede a volta.
 */

interface VercelConfig {
  regions?: string[];
  crons?: { path: string; schedule: string }[];
}

const config = JSON.parse(readFileSync("vercel.json", "utf8")) as VercelConfig;

describe("vercel.json", () => {
  it("toda rotina roda no máximo uma vez por dia", () => {
    for (const cron of config.crons ?? []) {
      const [minute, hour] = cron.schedule.trim().split(/\s+/);
      // Minuto e hora precisam ser um número fixo: "*", "*/10", "0,30" ou
      // "8-18" fariam a rotina rodar mais de uma vez no dia.
      expect(minute, `${cron.path}: minuto "${minute}"`).toMatch(/^\d+$/);
      expect(hour, `${cron.path}: hora "${hour}"`).toMatch(/^\d+$/);
    }
  });

  it("a rotina do HubSpot continua configurada", () => {
    expect(config.crons?.map((cron) => cron.path)).toContain("/api/cron/outbox");
  });

  it("funções na região do banco, e só uma (limite do Hobby)", () => {
    // Supabase em us-west-2 (Oregon) → pdx1 (Portland). Em iad1 cada consulta
    // atravessava o continente. Se o banco mudar de região, mude aqui também.
    expect(config.regions).toEqual(["pdx1"]);
  });
});

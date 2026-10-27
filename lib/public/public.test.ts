import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {} }));
const { clientIp, visitorKey } = await import("./quota");
const { leadSchema, normalizePhone } = await import("./lead");

describe("visitante do chat público", () => {
  it("usa o primeiro IP informado pela Vercel", () => {
    const headers = new Headers({ "x-forwarded-for": "200.1.2.3, 10.0.0.1" });
    expect(clientIp(headers)).toBe("200.1.2.3");
  });

  it("chave não contém o IP e muda a cada dia", () => {
    const hoje = visitorKey("200.1.2.3", "2026-10-27", "segredo");
    expect(hoje).not.toContain("200.1.2.3");
    expect(hoje).toHaveLength(32);
    expect(visitorKey("200.1.2.3", "2026-10-28", "segredo")).not.toBe(hoje);
    expect(visitorKey("200.1.2.3", "2026-10-27", "segredo")).toBe(hoje);
  });
});

describe("formulário de contato", () => {
  const valido = {
    name: "Maria Souza",
    email: "Maria@Empresa.com.br",
    phone: "(62) 99999-8888",
    company: "Empresa",
    consent: "on",
  };

  it("aceita contato completo e normaliza e-mail e telefone", () => {
    const lead = leadSchema.parse(valido);
    expect(lead.email).toBe("maria@empresa.com.br");
    expect(normalizePhone(lead.phone)).toBe("62999998888");
  });

  it("sem consentimento não entra", () => {
    expect(leadSchema.safeParse({ ...valido, consent: undefined }).success).toBe(false);
  });

  it("e-mail e telefone inválidos são recusados", () => {
    expect(leadSchema.safeParse({ ...valido, email: "maria" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...valido, phone: "123" }).success).toBe(false);
  });

  it("robô que preenche o campo escondido é recusado", () => {
    const result = leadSchema.safeParse({ ...valido, website: "http://spam" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path[0]).toBe("website");
  });

  it("telefone é opcional", () => {
    expect(leadSchema.safeParse({ ...valido, phone: "" }).success).toBe(true);
  });
});

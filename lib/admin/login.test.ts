import { describe, expect, it } from "vitest";
import { LOGIN_REASONS, loginErrorMessage, safeRedirect } from "./login";

describe("safeRedirect", () => {
  it("aceita caminho interno", () => {
    expect(safeRedirect("/admin/conversas")).toBe("/admin/conversas");
  });

  it("sem destino vai para o painel", () => {
    expect(safeRedirect(null)).toBe("/admin");
    expect(safeRedirect("")).toBe("/admin");
  });

  it("recusa endereço externo", () => {
    expect(safeRedirect("https://site-falso.com")).toBe("/admin");
    expect(safeRedirect("//site-falso.com")).toBe("/admin");
    expect(safeRedirect("/\\site-falso.com")).toBe("/admin");
  });
});

describe("mensagens de login", () => {
  it("credencial errada", () => {
    expect(loginErrorMessage("Invalid login credentials")).toBe("E-mail ou senha inválidos.");
  });

  it("e-mail não confirmado diz onde resolver", () => {
    expect(loginErrorMessage("Email not confirmed")).toMatch(/Authentication → Users/);
  });

  it("falha de rede não vira 'senha inválida'", () => {
    expect(loginErrorMessage("Failed to fetch")).toMatch(/serviço de login/);
  });

  it("erro desconhecido mostra o texto original", () => {
    expect(loginErrorMessage("algo novo")).toMatch(/algo novo/);
  });

  it("motivo de usuário sem perfil explica o que fazer", () => {
    expect(LOGIN_REASONS.sem_perfil).toMatch(/não tem acesso ao console/);
  });
});

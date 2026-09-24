import { Suspense } from "react";
import { LoginForm } from "./login-form";

/**
 * Login do console. Não há cadastro aberto: usuários são criados no painel do
 * Supabase e promovidos a admin por SQL (ver docs/setup.md).
 *
 * O formulário fica num componente cliente separado porque lê a query string,
 * o que exige limite de Suspense no prerender.
 */
export default function Entrar() {
  return (
    <main className="login">
      <h1>Console</h1>
      <p className="muted">IA da Reforma Tributária — Invent Software</p>
      <Suspense fallback={<p className="muted">Carregando…</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}

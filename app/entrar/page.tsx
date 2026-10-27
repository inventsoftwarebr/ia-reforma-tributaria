import { Suspense } from "react";
import { InventLogo } from "@/components/InventLogo";
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
    <main className="console login">
      <div className="login-card">
        <InventLogo height={40} />
        <h1>Console</h1>
        <p className="muted" style={{ margin: 0 }}>
          IA da Reforma Tributária
        </p>
        <Suspense fallback={<p className="muted">Carregando…</p>}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}

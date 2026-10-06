"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { LOGIN_REASONS, loginErrorMessage, safeRedirect } from "@/lib/admin/login";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const params = useSearchParams();
  const motivo = params.get("erro");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(motivo ? (LOGIN_REASONS[motivo] ?? null) : null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(event: React.FormEvent) {
    event.preventDefault();
    setEnviando(true);
    setErro(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

      if (error) {
        setErro(loginErrorMessage(error.message));
        setEnviando(false);
        return;
      }

      // Navegação completa, não client-side: o servidor recebe o cookie de
      // sessão recém-gravado, e se recusar o acesso esta página recarrega do
      // zero mostrando o motivo — em vez de ficar presa em "Entrando…".
      window.location.assign(safeRedirect(params.get("redirect")));
    } catch (error) {
      setErro(loginErrorMessage(error instanceof Error ? error.message : String(error)));
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={entrar} className="stack" style={{ marginTop: "1.5rem" }}>
      <label className="stack" style={{ gap: "0.25rem" }}>
        <span className="muted">E-mail</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
      </label>

      <label className="stack" style={{ gap: "0.25rem" }}>
        <span className="muted">Senha</span>
        <input
          type="password"
          value={senha}
          onChange={(event) => setSenha(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      {erro ? (
        <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>
          {erro}
        </p>
      ) : null}

      <button type="submit" data-variant="primary" disabled={enviando}>
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

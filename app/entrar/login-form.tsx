"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(event: React.FormEvent) {
    event.preventDefault();
    setEnviando(true);
    setErro(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    if (error) {
      setErro("E-mail ou senha inválidos.");
      setEnviando(false);
      return;
    }

    router.push(params.get("redirect") ?? "/admin");
    router.refresh();
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

      {erro ? <p style={{ color: "var(--danger)", margin: 0 }}>{erro}</p> : null}

      <button type="submit" data-variant="primary" disabled={enviando}>
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

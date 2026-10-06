"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  LOGIN_REASONS,
  LOGIN_SLOW,
  LOGIN_WATCHDOG_MS,
  loginErrorMessage,
  safeRedirect,
} from "@/lib/admin/login";
import { createClient } from "@/lib/supabase/client";

type Fase = "parado" | "autenticando" | "abrindo";

export function LoginForm() {
  const params = useSearchParams();
  const motivo = params.get("erro");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(
    motivo ? (LOGIN_REASONS[motivo] ?? null) : null,
  );
  const [fase, setFase] = useState<Fase>("parado");
  const faseRef = useRef<Fase>("parado");
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(watchdog.current), []);

  function mudarFase(proxima: Fase) {
    faseRef.current = proxima;
    setFase(proxima);
  }

  function parar(mensagem: string) {
    clearTimeout(watchdog.current);
    setErro(mensagem);
    mudarFase("parado");
  }

  async function entrar(event: React.FormEvent) {
    event.preventDefault();
    setErro(null);
    mudarFase("autenticando");

    // Nunca deixar a pessoa olhando um botão girando sem saber o motivo: passou
    // do prazo, solta o botão e diz em que etapa parou.
    clearTimeout(watchdog.current);
    watchdog.current = setTimeout(() => {
      if (faseRef.current !== "parado") parar(LOGIN_SLOW[faseRef.current]);
    }, LOGIN_WATCHDOG_MS);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: senha,
      });
      if (faseRef.current !== "autenticando") return;

      if (error) {
        parar(loginErrorMessage(error.message));
        return;
      }

      // Navegação completa, não client-side: o servidor recebe o cookie de
      // sessão recém-gravado, e se recusar o acesso esta página recarrega do
      // zero mostrando o motivo. O watchdog segue valendo até o painel abrir.
      mudarFase("abrindo");
      window.location.assign(safeRedirect(params.get("redirect")));
    } catch (error) {
      if (faseRef.current !== "autenticando") return;
      parar(loginErrorMessage(error instanceof Error ? error.message : String(error)));
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
        <div role="alert" className="stack" style={{ gap: "0.25rem" }}>
          <p style={{ color: "var(--danger)", margin: 0 }}>{erro}</p>
          {fase === "parado" && erro.includes("/api/health") ? (
            <a href="/api/health" target="_blank" rel="noreferrer">
              Abrir o diagnóstico (/api/health)
            </a>
          ) : null}
        </div>
      ) : null}

      <button type="submit" data-variant="primary" disabled={fase !== "parado"}>
        {fase === "autenticando"
          ? "Entrando…"
          : fase === "abrindo"
            ? "Abrindo o painel…"
            : "Entrar"}
      </button>
    </form>
  );
}

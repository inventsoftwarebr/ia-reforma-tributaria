"use client";

/**
 * Tela de erro do console — quase sempre a conexão com o banco. Sem ela, o
 * Next mostra uma página genérica em inglês sem pista do que fazer.
 */
export function ConsoleError({ digest }: { digest?: string }) {
  return (
    <main className="shell">
      <h1>Não foi possível carregar o console</h1>
      <p className="notice" style={{ marginTop: "1rem" }}>
        O servidor não conseguiu buscar os dados. A causa mais comum é a conexão com o banco
        (variável <code>DATABASE_URL</code> na Vercel).
      </p>
      <p>
        Abra <a href="/api/health">/api/health</a> para ver o diagnóstico e envie um print para
        quem cuida do sistema.
      </p>
      {digest ? (
        <p className="muted">
          Código para procurar nos logs da Vercel: <code>{digest}</code>
        </p>
      ) : null}
    </main>
  );
}

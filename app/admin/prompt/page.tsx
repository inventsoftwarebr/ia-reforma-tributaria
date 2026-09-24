import { requireAgent } from "@/lib/admin/auth";
import { activatePromptVersion } from "@/lib/admin/actions";
import { listPromptVersions } from "@/lib/admin/queries";
import { DEFAULT_POLICY, PROMPT_KEY, PROMPT_VERSION } from "@/lib/ai/prompt";
import { brazilDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function Prompt() {
  const user = await requireAgent();
  const versoes = await listPromptVersions();

  async function ativar(formData: FormData) {
    "use server";
    await activatePromptVersion(String(formData.get("id")));
  }

  return (
    <main>
      <h1>Prompt</h1>
      <p className="muted">
        O que vive aqui é a <strong>política</strong>: tom, escopo, regras de citação. O contexto
        (trechos da base e estado da conversa) é montado em código e não pode ser afrouxado pelo
        console — é de lá que os guard-rails dependem.
      </p>

      {versoes.length === 0 ? (
        <p className="notice" style={{ marginTop: "1rem" }}>
          Nenhuma versão no banco: o agente está usando a política padrão do código (
          <code>
            {PROMPT_KEY} {PROMPT_VERSION}
          </code>
          ). Para versionar pelo console, insira a primeira linha em <code>prompt_versions</code>{" "}
          com o texto abaixo como ponto de partida.
        </p>
      ) : (
        <table style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Versão</th>
              <th>Criada</th>
              <th>Notas</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {versoes.map((versao) => (
              <tr key={versao.id}>
                <td>
                  <strong>{versao.version}</strong>
                  {versao.active ? (
                    <>
                      {" "}
                      <span className="tag" data-tone="ok">
                        ativa
                      </span>
                    </>
                  ) : null}
                </td>
                <td className="muted">{brazilDateTime(versao.createdAt)}</td>
                <td className="muted">{versao.notes ?? "—"}</td>
                <td>
                  {!versao.active && user.role === "admin" ? (
                    <form action={ativar}>
                      <input type="hidden" name="id" value={versao.id} />
                      <button type="submit">ativar</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Política em uso</h2>
      <pre
        className="card"
        style={{ whiteSpace: "pre-wrap", fontSize: "0.82rem", overflowX: "auto" }}
      >
        {versoes.find((versao) => versao.active)?.content ?? DEFAULT_POLICY}
      </pre>
    </main>
  );
}

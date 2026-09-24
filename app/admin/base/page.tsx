import { requireAgent } from "@/lib/admin/auth";
import { markSourceReviewed, setSourceStatus } from "@/lib/admin/actions";
import { listSources } from "@/lib/admin/queries";
import { brazilDate } from "@/lib/time";
import { REVISAO_PENDENTE } from "@/lib/tax/schedule";

export const dynamic = "force-dynamic";

const AUTHORITY_TONE: Record<string, string> = {
  oficial: "ok",
  invent: "brand",
  secundaria: "warn",
};

export default async function Base() {
  const user = await requireAgent();
  const fontes = await listSources();
  const hoje = new Date();

  async function arquivar(formData: FormData) {
    "use server";
    await setSourceStatus(String(formData.get("id")), "archived");
  }

  async function reativar(formData: FormData) {
    "use server";
    await setSourceStatus(String(formData.get("id")), "active");
  }

  async function revisar(formData: FormData) {
    "use server";
    await markSourceReviewed(String(formData.get("id")), String(formData.get("revisor")));
  }

  return (
    <main>
      <h1>Base de conhecimento</h1>
      <p className="muted">
        A ingestão é por linha de comando (<code>pnpm kb:ingest</code>). Aqui você acompanha
        vigência, revisão e o que está no ar.
      </p>

      {REVISAO_PENDENTE ? (
        <p className="notice" style={{ marginTop: "1rem" }}>
          O cronograma em <code>lib/tax/schedule.ts</code> está marcado como{" "}
          <strong>revisão fiscal pendente</strong>: toda resposta com número sai com aviso de
          conteúdo não homologado. Depois da revisão, zere <code>REVISAO_PENDENTE</code>.
        </p>
      ) : null}

      {fontes.length === 0 ? (
        <p className="notice" style={{ marginTop: "1rem" }}>
          Nenhuma fonte indexada. Enquanto a base estiver vazia o agente recusa qualquer pergunta
          que dependa de norma — é o comportamento correto, mas não atende ninguém.
        </p>
      ) : (
        <table style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Fonte</th>
              <th>Autoridade</th>
              <th>Vigência</th>
              <th>Trechos</th>
              <th>Revisão</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fontes.map((fonte) => {
              const vencida =
                fonte.effectiveTo !== null && new Date(fonte.effectiveTo) < hoje;

              return (
                <tr key={fonte.id}>
                  <td>
                    <strong>{fonte.citationLabel}</strong>
                    <br />
                    <span className="muted">{fonte.title}</span>
                    <br />
                    <span className="muted">{fonte.kind}</span>
                  </td>
                  <td>
                    <span className="tag" data-tone={AUTHORITY_TONE[fonte.authority] ?? ""}>
                      {fonte.authority}
                    </span>
                    {fonte.status === "archived" ? (
                      <>
                        {" "}
                        <span className="tag">arquivada</span>
                      </>
                    ) : null}
                  </td>
                  <td className="muted">
                    {fonte.effectiveFrom ?? "—"} → {fonte.effectiveTo ?? "vigente"}
                    {vencida ? (
                      <>
                        <br />
                        <span className="tag" data-tone="danger">
                          vencida
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td>{fonte.chunks}</td>
                  <td className="muted">
                    {fonte.reviewedBy ? (
                      <>
                        {fonte.reviewedBy}
                        <br />
                        {fonte.reviewedAt ? brazilDate(fonte.reviewedAt) : ""}
                      </>
                    ) : (
                      <span className="tag" data-tone="warn">
                        sem revisão
                      </span>
                    )}
                  </td>
                  <td>
                    {user.role === "admin" ? (
                      <div className="stack" style={{ gap: "0.4rem" }}>
                        <form action={fonte.status === "active" ? arquivar : reativar}>
                          <input type="hidden" name="id" value={fonte.id} />
                          <button type="submit">
                            {fonte.status === "active" ? "arquivar" : "reativar"}
                          </button>
                        </form>
                        <form action={revisar} className="row" style={{ gap: "0.3rem" }}>
                          <input type="hidden" name="id" value={fonte.id} />
                          <input
                            name="revisor"
                            placeholder="quem revisou"
                            required
                            style={{ width: "9rem" }}
                          />
                          <button type="submit">ok</button>
                        </form>
                      </div>
                    ) : (
                      <span className="muted">só admin</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}

import { requireAgent } from "@/lib/admin/auth";
import { markSourceReviewed, setSourceStatus } from "@/lib/admin/actions";
import { setSourceAutoUpdate } from "@/lib/admin/kb-actions";
import { listSources } from "@/lib/admin/queries";
import { KIND_LABELS } from "@/lib/kb/console";
import { OFFICIAL_CATALOG } from "@/lib/kb/official";
import { STARTER_SOURCES } from "@/lib/kb/starter";
import { brazilDate, brazilDateTime } from "@/lib/time";
import { REVISAO_PENDENTE } from "@/lib/tax/schedule";
import { withTimeout } from "@/lib/timeout";
import { AddSourceForm } from "./AddSourceForm";
import { CheckNow } from "./CheckNow";
import { ContinueIndexing } from "./ContinueIndexing";
import { SourceCard } from "./SourceCard";

export const dynamic = "force-dynamic";
// Importar a LC 214 do Planalto (buscar, ler e preparar) pode levar mais de 10s.
export const maxDuration = 60;

const AUTHORITY_TONE: Record<string, string> = {
  oficial: "ok",
  invent: "brand",
  secundaria: "warn",
};

export default async function Base() {
  const user = await requireAgent();
  const fontes = await withTimeout(listSources(), 20_000, "banco");
  const hoje = new Date();
  const admin = user.role === "admin";
  const porSlug = new Map(fontes.map((fonte) => [fonte.slug, fonte]));
  const situacao = (slug: string) => {
    const fonte = porSlug.get(slug);
    return fonte
      ? {
          chunks: fonte.chunks,
          indexed: fonte.indexed,
          lastCheck: fonte.lastCheckedAt
            ? `${brazilDateTime(fonte.lastCheckedAt)} (${fonte.lastCheckStatus ?? "—"})`
            : null,
        }
      : null;
  };

  async function alternarAtualizacao(formData: FormData) {
    "use server";
    await setSourceAutoUpdate(
      String(formData.get("id")),
      formData.get("ligar") === "sim",
    );
  }

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
        A IA prioriza o que está aqui e cita a fonte. Normas vêm direto dos sites oficiais
        e são conferidas todo dia; material da Invent entra pelo formulário. Depois de
        adicionar, teste no <a href="/admin/simulador">Simulador</a>.
      </p>

      <h2>Normas oficiais da Reforma</h2>
      <p className="muted">
        Importadas do site do Planalto. Todo dia o sistema confere se o texto mudou (lei
        alterada, dispositivo revogado) e atualiza a base sozinho; a fonte volta a “sem
        revisão” para o time fiscal conferir a mudança.
      </p>
      <div className="kb-grid">
        {OFFICIAL_CATALOG.map((entry) => (
          <SourceCard
            key={entry.slug}
            slug={entry.slug}
            origin="oficial"
            title={entry.title}
            citation={entry.citationLabel}
            description={entry.description}
            url={entry.url}
            imported={situacao(entry.slug)}
            canEdit={admin}
          />
        ))}
      </div>
      {admin ? (
        <div style={{ marginTop: "0.75rem" }}>
          <CheckNow />
        </div>
      ) : null}

      <h2>Pacote inicial da Invent (rascunho)</h2>
      <p className="muted">
        Explicações em linguagem simples e o institucional da Invent, escritos para a IA
        ter base desde já. Entram como “sem revisão”: o time fiscal e o marketing devem
        conferir antes de o número oficial do WhatsApp ser ligado.
      </p>
      <div className="kb-grid">
        {STARTER_SOURCES.map((starter) => (
          <SourceCard
            key={starter.slug}
            slug={starter.slug}
            origin="pacote"
            title={starter.title}
            citation={starter.citationLabel}
            description={starter.description}
            imported={situacao(starter.slug)}
            canEdit={admin}
          />
        ))}
      </div>

      {admin ? (
        <>
          <h2>Adicionar fonte</h2>
          <p className="muted">
            Outras normas e páginas oficiais (Receita Federal, Comitê Gestor do IBS,
            Ministério da Fazenda), manuais e material da Invent (apresentações, e-books,
            FAQ).
          </p>
          <AddSourceForm />
        </>
      ) : null}

      <h2>Tudo o que está na base</h2>

      {REVISAO_PENDENTE ? (
        <p className="notice" style={{ marginTop: "1rem" }}>
          O cronograma em <code>lib/tax/schedule.ts</code> está marcado como{" "}
          <strong>revisão fiscal pendente</strong>: toda resposta com número sai com aviso
          de conteúdo não homologado. Depois da revisão, zere{" "}
          <code>REVISAO_PENDENTE</code>.
        </p>
      ) : null}

      {fontes.length === 0 ? (
        <p className="notice" style={{ marginTop: "1rem" }}>
          Nenhuma fonte indexada. Enquanto a base estiver vazia, a IA responde só com
          conhecimento geral, sem citar norma da base. Importe as normas oficiais abaixo.
        </p>
      ) : (
        <table style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Fonte</th>
              <th>Autoridade</th>
              <th>Vigência</th>
              <th>Trechos</th>
              <th>Atualização</th>
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
                    <span className="muted">{KIND_LABELS[fonte.kind] ?? fonte.kind}</span>
                    {fonte.version ? (
                      <>
                        <br />
                        <span className="muted" style={{ fontSize: "0.85rem" }}>
                          {fonte.version}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className="tag"
                      data-tone={AUTHORITY_TONE[fonte.authority] ?? ""}
                    >
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
                  <td>
                    {fonte.indexed < fonte.chunks ? (
                      <>
                        <span className="tag" data-tone="warn">
                          {fonte.indexed}/{fonte.chunks}
                        </span>
                        {admin ? (
                          <ContinueIndexing
                            sourceId={fonte.id}
                            total={fonte.chunks}
                            indexed={fonte.indexed}
                          />
                        ) : null}
                      </>
                    ) : (
                      fonte.chunks
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: "0.85rem" }}>
                    {fonte.autoUpdate ? (
                      <>
                        <span className="tag" data-tone="ok">
                          diária
                        </span>
                        {fonte.lastCheckedAt ? (
                          <>
                            <br />
                            {brazilDateTime(fonte.lastCheckedAt)}: {fonte.lastCheckStatus}
                          </>
                        ) : null}
                      </>
                    ) : fonte.url ? (
                      "manual"
                    ) : (
                      "—"
                    )}
                    {admin && fonte.url ? (
                      <form action={alternarAtualizacao}>
                        <input type="hidden" name="id" value={fonte.id} />
                        <input
                          type="hidden"
                          name="ligar"
                          value={fonte.autoUpdate ? "nao" : "sim"}
                        />
                        <button type="submit" style={{ marginTop: "0.3rem" }}>
                          {fonte.autoUpdate ? "desligar" : "ligar diária"}
                        </button>
                      </form>
                    ) : null}
                  </td>
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
                    {admin ? (
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

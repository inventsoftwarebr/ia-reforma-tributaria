import { requireAgent } from "@/lib/admin/auth";
import { overview, refusalsByReason } from "@/lib/admin/queries";
import { outboxSummary } from "@/lib/hubspot/outbox";

export const dynamic = "force-dynamic";

const REFUSAL_LABEL: Record<string, string> = {
  numeric_claim_without_support: "número sem respaldo na base",
  fabricated_citation: "citou norma que não foi recuperada",
  empty_answer: "resposta vazia do modelo",
  sem_motivo: "sem motivo registrado",
};

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export default async function Painel() {
  await requireAgent();
  const [dados, recusas, outbox] = await Promise.all([
    overview(),
    refusalsByReason(),
    outboxSummary(),
  ]);

  const aceite =
    dados.simuladorOfertado === 0
      ? "—"
      : `${Math.round((dados.simuladorAceito / dados.simuladorOfertado) * 100)}%`;

  return (
    <main>
      <h1>Painel</h1>
      <p className="muted">Últimos 7 dias.</p>

      <div className="cards" style={{ marginTop: "1rem" }}>
        <Card label="Conversas" value={String(dados.conversas7d)} />
        <Card label="Respostas" value={String(dados.respostas7d)} />
        <Card
          label="Recusas"
          value={`${dados.recusas7d} (${dados.taxaRecusa}%)`}
          hint="recusa alta = lacuna de curadoria"
        />
        <Card label="Latência média" value={`${(dados.latenciaMediaMs / 1000).toFixed(1)}s`} />
        <Card label="Tokens" value={dados.tokens7d.toLocaleString("pt-BR")} />
        <Card label="Handoffs" value={String(dados.handoffs)} />
        <Card
          label="Simulador"
          value={aceite}
          hint={`${dados.simuladorAceito} aceites em ${dados.simuladorOfertado} ofertas`}
        />
      </div>

      <h2>Base de conhecimento</h2>
      <div className="cards">
        <Card label="Fontes ativas" value={String(dados.fontesAtivas)} />
        <Card label="Trechos indexados" value={String(dados.trechos)} />
        <Card
          label="Fontes vencidas"
          value={String(dados.fontesVencidas)}
          hint="vigência terminou; revisar"
        />
      </div>

      {dados.fontesAtivas === 0 ? (
        <p className="notice" style={{ marginTop: "1rem" }}>
          A base está vazia: sem trechos, o agente recusa tudo que envolva norma. Rode{" "}
          <code>pnpm kb:ingest</code> com o material curado pelo time fiscal.
        </p>
      ) : null}

      <h2>Motivos de recusa</h2>
      {recusas.length === 0 ? (
        <p className="muted">Nenhuma recusa nos últimos 7 dias.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Motivo</th>
              <th>Ocorrências</th>
            </tr>
          </thead>
          <tbody>
            {recusas.map((linha) => (
              <tr key={linha.reason}>
                <td>{REFUSAL_LABEL[linha.reason] ?? linha.reason}</td>
                <td>{linha.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Operação</h2>
      <div className="cards">
        <Card
          label="Falhas abertas"
          value={String(dados.falhasAbertas)}
          hint="turnos que caíram na fila morta"
        />
        <Card label="HubSpot pendente" value={String(outbox.pending)} />
        <Card label="HubSpot falho" value={String(outbox.failed)} hint="tentativas esgotadas" />
      </div>
    </main>
  );
}

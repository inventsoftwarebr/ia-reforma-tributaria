import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/admin/auth";
import { setConversationStatus } from "@/lib/admin/actions";
import { conversationDetail } from "@/lib/admin/queries";
import { brazilDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function Conversa({ params }: { params: Promise<{ id: string }> }) {
  await requireAgent();
  const { id } = await params;
  const conversa = await conversationDetail(id);

  if (!conversa) notFound();

  const pausar = async () => {
    "use server";
    await setConversationStatus(id, "handoff");
  };

  const retomar = async () => {
    "use server";
    await setConversationStatus(id, "active");
  };

  const sinais = Object.entries(conversa.leadSignals).filter(([, value]) => Boolean(value));

  return (
    <main>
      <h1>{conversa.pushName ?? conversa.phoneE164}</h1>
      <p className="muted">
        {conversa.phoneE164} · status <strong>{conversa.status}</strong>
        {conversa.optedOut ? " · opt-out registrado" : ""}
      </p>

      <div className="row" style={{ margin: "1rem 0" }}>
        {conversa.status === "handoff" ? (
          <form action={retomar}>
            <button type="submit">Devolver para o bot</button>
          </form>
        ) : (
          <form action={pausar}>
            <button type="submit" data-variant="primary">
              Assumir e pausar o bot
            </button>
          </form>
        )}
        {conversa.simulatorAcceptedAt ? (
          <span className="tag" data-tone="brand">
            recebeu o simulador
          </span>
        ) : null}
        {conversa.handoffRequestedAt ? (
          <span className="tag" data-tone="warn">
            pediu especialista
          </span>
        ) : null}
      </div>

      {sinais.length > 0 ? (
        <>
          <h2>Sinais do lead</h2>
          <table>
            <tbody>
              {sinais.map(([chave, valor]) => (
                <tr key={chave}>
                  <th style={{ width: "10rem" }}>{chave}</th>
                  <td>{String(valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h2>Transcrição</h2>
      <div className="bubbles">
        {conversa.transcript.map((mensagem) => (
          <div key={mensagem.id} className="bubble" data-direction={mensagem.direction}>
            {mensagem.body || <em className="muted">({mensagem.kind} sem texto)</em>}
            <span className="meta">
              {brazilDateTime(mensagem.createdAt)} · {mensagem.kind}
              {mensagem.status === "failed" ? " · falha no envio" : ""}
            </span>
          </div>
        ))}
      </div>

      <h2>Execuções do agente</h2>
      {conversa.runs.length === 0 ? (
        <p className="muted">Nenhuma execução registrada.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Modelo</th>
              <th>Prompt</th>
              <th>Trechos</th>
              <th>Latência</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {conversa.runs.map((run) => (
              <tr key={run.id}>
                <td className="muted">{brazilDateTime(run.createdAt)}</td>
                <td>{run.model}</td>
                <td>{run.promptVersion}</td>
                <td>{run.retrievedCount}</td>
                <td>{(run.latencyMs / 1000).toFixed(1)}s</td>
                <td>
                  {run.refused ? (
                    <span className="tag" data-tone="warn">
                      recusou: {run.refusalReason ?? "—"}
                    </span>
                  ) : (
                    <span className="tag" data-tone="ok">
                      respondeu
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

import Link from "next/link";
import { requireAgent } from "@/lib/admin/auth";
import { listConversations } from "@/lib/admin/queries";
import { brazilDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  active: "ok",
  idle: "",
  handoff: "warn",
  closed: "",
};

export default async function Conversas() {
  await requireAgent();
  const conversas = await listConversations();

  return (
    <main>
      <h1>Conversas</h1>
      <p className="muted">As 50 mais recentes.</p>

      {conversas.length === 0 ? (
        <p className="muted" style={{ marginTop: "1rem" }}>
          Nenhuma conversa ainda. Quando o webhook receber a primeira mensagem, ela aparece aqui.
        </p>
      ) : (
        <table style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Contato</th>
              <th>Status</th>
              <th>Mensagens</th>
              <th>Última</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {conversas.map((conversa) => (
              <tr key={conversa.id}>
                <td>
                  {conversa.pushName ?? "—"}
                  <br />
                  <span className="muted">{conversa.phoneE164}</span>
                </td>
                <td>
                  <span className="tag" data-tone={STATUS_TONE[conversa.status] ?? ""}>
                    {conversa.status}
                  </span>
                  {conversa.optedOut ? (
                    <>
                      {" "}
                      <span className="tag" data-tone="danger">
                        opt-out
                      </span>
                    </>
                  ) : null}
                </td>
                <td>{conversa.mensagens}</td>
                <td className="muted">{brazilDateTime(conversa.lastMessageAt)}</td>
                <td>
                  <Link href={`/admin/conversas/${conversa.id}`}>abrir</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

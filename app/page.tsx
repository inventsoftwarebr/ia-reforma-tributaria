import Link from "next/link";

export default function Home() {
  return (
    <main className="shell">
      <h1>IA da Reforma Tributária</h1>
      <p className="muted">
        Serviço da Invent Software. O atendimento acontece no WhatsApp; esta página existe para
        operação.
      </p>

      <h2>Endpoints</h2>
      <ul>
        <li>
          <code>POST /api/whatsapp/inbound</code> — webhook do gateway, exige segredo
        </li>
        <li>
          <code>POST /api/jobs/turn</code> — worker do turno, exige assinatura da fila
        </li>
        <li>
          <code>GET /api/cron/outbox</code> — drenagem do HubSpot, exige segredo do cron
        </li>
      </ul>

      <h2>Console</h2>
      <p>
        <Link href="/admin">Abrir o console</Link> para conversas, base de conhecimento, prompt e
        métricas.
      </p>
    </main>
  );
}

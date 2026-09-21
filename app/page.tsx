/**
 * Página de status. O console admin (conversas, base de conhecimento, prompt e
 * métricas) entra na fase 3 — ver docs/arquitetura.md.
 */
export default function Home() {
  return (
    <main
      style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", lineHeight: 1.6 }}
    >
      <h1>IA da Reforma Tributária</h1>
      <p>Serviço da Invent Software. O atendimento acontece no WhatsApp.</p>
      <p>
        Webhook do gateway: <code>/api/whatsapp/inbound</code>
      </p>
    </main>
  );
}

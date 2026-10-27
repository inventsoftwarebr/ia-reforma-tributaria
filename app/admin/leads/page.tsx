import { requireAgent } from "@/lib/admin/auth";
import { setWebLeadStatus } from "@/lib/admin/actions";
import { listWebLeads } from "@/lib/admin/queries";
import { brazilDateTime } from "@/lib/time";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";

export default async function Leads() {
  await requireAgent();
  const leads = await withTimeout(listWebLeads(), 15_000, "banco");
  const novos = leads.filter((lead) => lead.status === "novo").length;

  async function alternar(formData: FormData) {
    "use server";
    await setWebLeadStatus(
      String(formData.get("id")),
      formData.get("status") === "respondido" ? "respondido" : "novo",
    );
  }

  return (
    <main>
      <h1>Contatos do site</h1>
      <p className="muted">
        Pessoas que pediram um especialista no chat público ({novos} aguardando retorno).
        Todas aceitaram ser contatadas; o texto do consentimento fica gravado com o
        pedido.
      </p>

      {leads.length === 0 ? (
        <p className="notice" style={{ marginTop: "1rem" }}>
          Nenhum pedido ainda. Eles aparecem aqui quando alguém preenche o formulário no
          chat do site.
        </p>
      ) : (
        <table style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Contato</th>
              <th>Empresa</th>
              <th>Pedido</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td className="muted">{brazilDateTime(lead.createdAt)}</td>
                <td>
                  <strong>{lead.name}</strong>
                  <br />
                  <a href={`mailto:${lead.email}`}>{lead.email}</a>
                  {lead.phone ? (
                    <>
                      <br />
                      <a
                        href={`https://wa.me/${lead.phone.length <= 11 ? `55${lead.phone}` : lead.phone}`}
                      >
                        {lead.phone}
                      </a>
                    </>
                  ) : null}
                </td>
                <td>{lead.company ?? "—"}</td>
                <td style={{ maxWidth: "28rem" }}>{lead.message ?? "—"}</td>
                <td>
                  <form action={alternar}>
                    <input type="hidden" name="id" value={lead.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={lead.status === "novo" ? "respondido" : "novo"}
                    />
                    <span
                      className="tag"
                      data-tone={lead.status === "novo" ? "warn" : "ok"}
                    >
                      {lead.status}
                    </span>{" "}
                    <button type="submit">
                      {lead.status === "novo" ? "marcar respondido" : "reabrir"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

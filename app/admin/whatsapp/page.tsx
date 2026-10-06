import { requireAgent } from "@/lib/admin/auth";
import { configureWhatsAppWebhook } from "@/lib/admin/actions";
import { lastMessages } from "@/lib/admin/queries";
import { serverEnv } from "@/lib/env";
import { brazilDateTime } from "@/lib/time";
import { withTimeout } from "@/lib/timeout";
import type { Check } from "@/lib/whatsapp/evolution-admin";
import { evolutionConfig, whatsappStatus } from "@/lib/whatsapp/status";

export const dynamic = "force-dynamic";

function Linha({ titulo, check }: { titulo: string; check: Check }) {
  return (
    <tr>
      <td>{titulo}</td>
      <td>
        <span className="tag" data-tone={check.ok ? "ok" : "danger"}>
          {check.ok ? "ok" : "atenção"}
        </span>
      </td>
      <td>{check.text}</td>
    </tr>
  );
}

export default async function WhatsApp({
  searchParams,
}: {
  searchParams: Promise<{ resultado?: string; msg?: string }>;
}) {
  const user = await requireAgent();
  const { resultado, msg } = await searchParams;
  const [status, ultimas] = await withTimeout(
    Promise.all([whatsappStatus(), lastMessages()]),
    25_000,
    "whatsapp",
  );
  const instancia = evolutionConfig().instance;
  const tudoOk = status.conexao.ok && status.webhook.ok && status.destino.ok;
  const podeConfigurar = user.role === "admin" && status.destino.ok && !status.webhook.ok;

  return (
    <main>
      <h1>WhatsApp</h1>
      <p className="muted">
        Instância <code>{instancia || "—"}</code> na Evolution API.
      </p>

      {resultado ? (
        <p className="notice" style={{ marginTop: "1rem" }}>
          {resultado === "ok" ? "Pronto: " : "Não foi possível configurar: "}
          {msg}
        </p>
      ) : null}

      <table style={{ marginTop: "1rem" }}>
        <tbody>
          <Linha titulo="Conexão" check={status.conexao} />
          <Linha titulo="Webhook" check={status.webhook} />
          {status.webhook.atual && !status.webhook.ok ? (
            <tr>
              <td>Destino atual</td>
              <td />
              <td>
                <code>{status.webhook.atual}</code>
                <div className="muted" style={{ fontSize: "0.85rem" }}>
                  Anote este endereço antes de trocar: é para ele que se volta, no
                  Evolution Manager, se precisar desfazer.
                </div>
              </td>
            </tr>
          ) : null}
          <Linha
            titulo="Endereço do site"
            check={
              status.destino.ok ? { ok: true, text: status.destino.text } : status.destino
            }
          />
        </tbody>
      </table>

      {podeConfigurar ? (
        <form action={configureWhatsAppWebhook} style={{ marginTop: "1rem" }}>
          <p>
            O botão abaixo aponta o webhook da instância para este site, com o segredo{" "}
            <code>EVOLUTION_WEBHOOK_SECRET</code> e o evento <code>MESSAGES_UPSERT</code>.
          </p>
          <p className="notice">
            Atenção: cada instância tem um único webhook. Se esta instância é o número que
            hoje atende pelo n8n, o n8n para de receber as mensagens a partir daqui.
            Comece por um número de teste.
          </p>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
            <input type="checkbox" name="confirmo" value="sim" required />
            <span>
              Entendo que, a partir deste clique, as mensagens desta instância deixam de
              ir para o destino atual e passam a ser respondidas por este sistema.
            </span>
          </label>
          <button type="submit" data-variant="primary" style={{ marginTop: "0.75rem" }}>
            Configurar webhook automaticamente
          </button>
        </form>
      ) : null}

      <h2>Teste</h2>
      {tudoOk ? (
        <p>
          Mande <em>“O que é a CBS?”</em> de outro celular para o número da instância e
          recarregue esta página.
        </p>
      ) : (
        <p className="muted">Resolva os itens marcados com “atenção” antes de testar.</p>
      )}
      <div className="cards">
        <div className="card">
          <div className="label">Última mensagem recebida</div>
          <div className="value" style={{ fontSize: "1rem" }}>
            {ultimas.recebida ? brazilDateTime(ultimas.recebida) : "nenhuma ainda"}
          </div>
        </div>
        <div className="card">
          <div className="label">Última resposta enviada</div>
          <div className="value" style={{ fontSize: "1rem" }}>
            {ultimas.enviada ? brazilDateTime(ultimas.enviada) : "nenhuma ainda"}
          </div>
        </div>
      </div>
      <p className="muted" style={{ marginTop: "1rem" }}>
        Fila: {serverEnv().QSTASH_TOKEN ? "QStash" : "sem QStash (responde direto)"}.
      </p>
    </main>
  );
}

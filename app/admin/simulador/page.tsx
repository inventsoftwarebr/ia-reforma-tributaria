import { requireAgent } from "@/lib/admin/auth";
import { activeSourceCount } from "@/lib/admin/queries";
import { withTimeout } from "@/lib/timeout";
import { Simulador } from "./Simulador";

export const dynamic = "force-dynamic";
// A resposta do modelo (com busca e ferramentas) pode passar de 10s.
export const maxDuration = 60;

export default async function SimuladorPage() {
  await requireAgent();
  const fontes = await withTimeout(activeSourceCount(), 15_000, "banco");

  return (
    <main>
      <h1>Simulador</h1>
      <p className="muted">
        Converse com a IA como um cliente faria no WhatsApp. É o mesmo caminho de verdade
        (base de conhecimento, prompt ativo, modelo e regras de segurança), mas nada é
        enviado, gravado ou mandado ao HubSpot.
      </p>
      {fontes === 0 ? (
        <p className="notice" style={{ marginTop: "1rem" }}>
          A base de conhecimento está vazia: a IA vai recusar perguntas que dependem da
          norma. Isso é o comportamento correto até o material do time fiscal ser
          carregado.
        </p>
      ) : null}
      <Simulador />
    </main>
  );
}

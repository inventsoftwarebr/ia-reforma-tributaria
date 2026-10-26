"use client";

import { useEffect, useRef, useState } from "react";
import { simulateQuestion } from "@/lib/admin/actions";
import type { SimulateResult } from "@/lib/simulator/run";
import { INITIAL_STATE, type SimulatedState, TOOL_LABELS } from "@/lib/simulator/state";

type Entry =
  | { role: "user"; text: string }
  | { role: "assistant"; blocks: string[]; details: SimulateResult["details"] };

const SUGESTOES = [
  "O que é a CBS?",
  "Quando o IBS começa a ser cobrado?",
  "Como fica o crédito de PIS e Cofins na transição?",
  "Quero falar com um especialista da Invent",
];

const REFUSAL_LABEL: Record<string, string> = {
  numeric_claim_without_support: "citou número sem respaldo na base ou no cronograma",
  fabricated_citation: "citou norma que não estava nos trechos recuperados",
  empty_answer: "o modelo devolveu resposta vazia",
};

/** Negrito do WhatsApp (*assim*) vira negrito na tela. */
function WhatsAppText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        /^\*[^*\n]+\*$/.test(part) ? (
          <strong key={index}>{part.slice(1, -1)}</strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Detalhes({ details }: { details: SimulateResult["details"] }) {
  return (
    <details className="sim-details">
      <summary>
        {details.error
          ? "erro técnico"
          : details.refused
            ? "recusou pelas regras de segurança"
            : "detalhes da resposta"}
      </summary>
      <ul>
        {details.error ? <li>Erro: {details.error}</li> : null}
        {details.note ? <li>{details.note}</li> : null}
        {details.refused ? (
          <li>
            Motivo da recusa:{" "}
            {details.refusalReason
              ? (REFUSAL_LABEL[details.refusalReason] ?? details.refusalReason)
              : "—"}
          </li>
        ) : null}
        <li>
          Fontes encontradas na base:{" "}
          {details.sources.length === 0 ? "nenhuma" : details.sources.join("; ")}
        </li>
        <li>
          Ferramentas:{" "}
          {details.tools.length === 0
            ? "nenhuma"
            : details.tools.map((tool) => TOOL_LABELS[tool] ?? tool).join("; ")}
        </li>
        <li>
          {(details.latencyMs / 1000).toFixed(1)}s ·{" "}
          {details.tokens.toLocaleString("pt-BR")} tokens · {details.model} · prompt{" "}
          {details.promptVersion}
        </li>
      </ul>
    </details>
  );
}

export function Simulador() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [state, setState] = useState<SimulatedState>(INITIAL_STATE);
  const [pergunta, setPergunta] = useState("");
  const [pensando, setPensando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, pensando]);

  async function enviar(texto: string) {
    const question = texto.trim();
    if (!question || pensando) return;

    // Histórico no formato do agente: cada resposta é a junção dos blocos.
    const history = entries
      .map((entry) =>
        entry.role === "user"
          ? { role: "user" as const, content: entry.text }
          : { role: "assistant" as const, content: entry.blocks.join("\n\n") },
      )
      .slice(-20);

    setEntries((atual) => [...atual, { role: "user", text: question }]);
    setPergunta("");
    setFalha(null);
    setPensando(true);
    try {
      const result = await simulateQuestion({ question, history, state });
      setEntries((atual) => [
        ...atual,
        { role: "assistant", blocks: result.blocks, details: result.details },
      ]);
      setState(result.state);
    } catch {
      setFalha(
        "Não foi possível falar com o servidor. Confira a conexão e tente de novo.",
      );
    } finally {
      setPensando(false);
    }
  }

  function recomecar() {
    setEntries([]);
    setState(INITIAL_STATE);
    setFalha(null);
  }

  return (
    <section className="sim">
      <div className="sim-chat" aria-live="polite">
        {entries.length === 0 ? (
          <div className="sim-empty">
            <p className="muted">Comece com uma pergunta ou escolha uma sugestão:</p>
            <div className="sim-suggestions">
              {SUGESTOES.map((sugestao) => (
                <button key={sugestao} type="button" onClick={() => enviar(sugestao)}>
                  {sugestao}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {entries.map((entry, index) =>
          entry.role === "user" ? (
            <div key={index} className="sim-row sim-row-user">
              <div className="sim-bubble sim-user">{entry.text}</div>
            </div>
          ) : (
            <div key={index} className="sim-row">
              <div className="sim-stack">
                {entry.blocks.map((block, blockIndex) => (
                  <div key={blockIndex} className="sim-bubble sim-bot">
                    <WhatsAppText text={block} />
                  </div>
                ))}
                <Detalhes details={entry.details} />
              </div>
            </div>
          ),
        )}

        {pensando ? (
          <div className="sim-row">
            <div className="sim-bubble sim-bot muted">digitando…</div>
          </div>
        ) : null}
        <div ref={fim} />
      </div>

      {state.handoff ? (
        <p className="notice">
          Nesta conversa a pessoa pediu um especialista. No WhatsApp, o bot pararia de
          responder e o lead iria para o HubSpot. Aqui a conversa continua para você
          seguir testando.
        </p>
      ) : null}
      {falha ? (
        <p role="alert" style={{ color: "var(--danger)" }}>
          {falha}
        </p>
      ) : null}

      <form
        className="sim-form"
        onSubmit={(event) => {
          event.preventDefault();
          void enviar(pergunta);
        }}
      >
        <textarea
          value={pergunta}
          onChange={(event) => setPergunta(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void enviar(pergunta);
            }
          }}
          placeholder="Escreva como um cliente escreveria… (Enter envia, Shift+Enter quebra linha)"
          rows={2}
          maxLength={2000}
          disabled={pensando}
        />
        <div className="sim-actions">
          <button
            type="button"
            onClick={recomecar}
            disabled={pensando || entries.length === 0}
          >
            Nova conversa
          </button>
          <button
            type="submit"
            data-variant="primary"
            disabled={pensando || !pergunta.trim()}
          >
            {pensando ? "Aguardando…" : "Enviar"}
          </button>
        </div>
      </form>
    </section>
  );
}

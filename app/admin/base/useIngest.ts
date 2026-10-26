"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { indexSourceStep } from "@/lib/admin/kb-actions";
import type { IngestStart } from "@/lib/kb/console";

export type IngestStatus =
  | { phase: "idle" }
  | { phase: "preparing"; message: string }
  | { phase: "indexing"; done: number; total: number; message: string }
  | { phase: "done"; message: string }
  | { phase: "error"; message: string };

const RATE_LIMIT_WAIT_MS = 30_000;
/** ~10 minutos esperando sem nenhum avanço. */
const MAX_PAUSES = 20;

/**
 * Conduz a importação: prepara a fonte e chama a indexação em passos até
 * acabar, mostrando o progresso. Documento grande (a LC 214) leva alguns
 * minutos; se o Gemini pedir pausa, espera e continua sozinho.
 */
export function useIngest() {
  const router = useRouter();
  const [status, setStatus] = useState<IngestStatus>({ phase: "idle" });

  async function run(start: () => Promise<IngestStart>, preparingMessage: string) {
    setStatus({ phase: "preparing", message: preparingMessage });
    let begin: IngestStart;
    try {
      begin = await start();
    } catch {
      setStatus({
        phase: "error",
        message: "Não foi possível falar com o servidor. Tente de novo.",
      });
      return;
    }
    if (!begin.ok) {
      setStatus({ phase: "error", message: begin.error });
      return;
    }

    let total = begin.chunks;
    let remaining = begin.pending;
    let message = begin.message;
    setStatus({ phase: "indexing", done: total - remaining, total, message });

    let pausasSeguidas = 0;
    while (remaining > 0) {
      const remainingAntes = remaining;
      let step;
      try {
        step = await indexSourceStep(begin.sourceId);
      } catch {
        setStatus({
          phase: "error",
          message:
            "A conexão caiu no meio da indexação. O que já foi feito está salvo: use “Continuar indexação” na tabela.",
        });
        router.refresh();
        return;
      }
      if (!step.ok) {
        setStatus({ phase: "error", message: step.error });
        router.refresh();
        return;
      }
      total = step.total;
      remaining = step.remaining;
      // Pausas seguidas sem avanço: o Gemini está fora; melhor parar e avisar.
      pausasSeguidas =
        step.paused && step.remaining === remainingAntes ? pausasSeguidas + 1 : 0;
      if (pausasSeguidas > MAX_PAUSES) {
        setStatus({
          phase: "error",
          message:
            "O Gemini segue indisponível. O que já foi indexado está salvo: use “Continuar indexação” mais tarde (ou deixe para a rotina diária, que termina sozinha).",
        });
        router.refresh();
        return;
      }
      message = step.paused
        ? "O Gemini pediu uma pausa (limite de uso ou instabilidade) — continuando em 30 segundos. Pode deixar esta página aberta."
        : "Indexando…";
      setStatus({ phase: "indexing", done: total - remaining, total, message });
      if (step.paused)
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
    }

    setStatus({
      phase: "done",
      message: `${begin.message} Pronto: ${total} trechos disponíveis para a IA. Teste no Simulador.`,
    });
    router.refresh();
  }

  return {
    status,
    run,
    busy: status.phase === "preparing" || status.phase === "indexing",
  };
}

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

    while (remaining > 0) {
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
      message = step.rateLimited
        ? "Limite por minuto do Gemini atingido — continuando em 30 segundos. Pode deixar esta página aberta."
        : "Indexando…";
      setStatus({ phase: "indexing", done: total - remaining, total, message });
      if (step.rateLimited)
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

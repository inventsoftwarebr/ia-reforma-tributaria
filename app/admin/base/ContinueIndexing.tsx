"use client";

import { IngestProgress } from "./IngestProgress";
import { useIngest } from "./useIngest";

/** Retoma uma indexação interrompida (página fechada, conexão caída). */
export function ContinueIndexing(props: {
  sourceId: string;
  total: number;
  indexed: number;
}) {
  const { status, run, busy } = useIngest();
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(
            async () => ({
              ok: true,
              sourceId: props.sourceId,
              chunks: props.total,
              pending: props.total - props.indexed,
              reused: 0,
              message: "Indexação retomada.",
            }),
            "Retomando…",
          )
        }
      >
        {busy ? "Indexando…" : "continuar indexação"}
      </button>
      <IngestProgress status={status} />
    </div>
  );
}

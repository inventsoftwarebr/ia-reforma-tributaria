"use client";

import type { IngestStatus } from "./useIngest";

export function IngestProgress({ status }: { status: IngestStatus }) {
  if (status.phase === "idle") return null;

  if (status.phase === "error") {
    return (
      <p role="alert" style={{ color: "var(--danger)", margin: "0.5rem 0 0" }}>
        {status.message}
      </p>
    );
  }

  if (status.phase === "indexing") {
    const percent =
      status.total === 0 ? 100 : Math.round((status.done / status.total) * 100);
    return (
      <div style={{ marginTop: "0.5rem" }}>
        <div className="kb-progress" aria-hidden="true">
          <div style={{ width: `${percent}%` }} />
        </div>
        <p className="muted" style={{ margin: "0.3rem 0 0", fontSize: "0.85rem" }}>
          {status.done} de {status.total} trechos indexados ({percent}%) ·{" "}
          {status.message}
        </p>
      </div>
    );
  }

  return (
    <p
      className={status.phase === "done" ? undefined : "muted"}
      style={{
        margin: "0.5rem 0 0",
        fontSize: "0.9rem",
        color: status.phase === "done" ? "var(--ok)" : undefined,
      }}
    >
      {status.message}
    </p>
  );
}

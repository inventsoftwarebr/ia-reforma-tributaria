"use client";

import { useState } from "react";
import { checkOfficialNow } from "@/lib/admin/kb-actions";

/** A conferência diária dos sites oficiais, disparada na hora. */
export function CheckNow() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; summary: string } | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          try {
            setResult(await checkOfficialNow());
          } catch {
            setResult({ ok: false, summary: "não foi possível falar com o servidor" });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Conferindo os sites…" : "Conferir sites oficiais agora"}
      </button>
      {result ? (
        <p
          className="muted"
          style={{ fontSize: "0.85rem", color: result.ok ? undefined : "var(--danger)" }}
        >
          {result.summary}
        </p>
      ) : null}
    </div>
  );
}

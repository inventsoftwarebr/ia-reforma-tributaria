"use client";

import { importCatalogSource, importStarterSource } from "@/lib/admin/kb-actions";
import { IngestProgress } from "./IngestProgress";
import { useIngest } from "./useIngest";

export interface SourceCardProps {
  slug: string;
  origin: "oficial" | "pacote";
  title: string;
  citation: string;
  description: string;
  url?: string;
  /** Situação na base, se já importada. */
  imported: { chunks: number; indexed: number; lastCheck: string | null } | null;
  canEdit: boolean;
}

export function SourceCard(props: SourceCardProps) {
  const { status, run, busy } = useIngest();
  const start = () =>
    props.origin === "oficial"
      ? importCatalogSource(props.slug)
      : importStarterSource(props.slug);
  const pending = props.imported ? props.imported.chunks - props.imported.indexed : 0;

  return (
    <div className="kb-card">
      <h3>{props.title}</h3>
      <span className="muted" style={{ fontSize: "0.85rem" }}>
        Citada como <strong>{props.citation}</strong>
        {props.url ? (
          <>
            {" · "}
            <a href={props.url} target="_blank" rel="noreferrer">
              site oficial
            </a>
          </>
        ) : null}
      </span>
      <p style={{ margin: 0 }}>{props.description}</p>

      {props.imported ? (
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          <span className="tag" data-tone={pending > 0 ? "warn" : "ok"}>
            {pending > 0
              ? `indexando: ${props.imported.indexed}/${props.imported.chunks}`
              : "na base"}
          </span>{" "}
          {props.imported.chunks} trechos
          {props.imported.lastCheck
            ? ` · última conferência: ${props.imported.lastCheck}`
            : ""}
        </span>
      ) : (
        <span className="tag" data-tone="warn" style={{ alignSelf: "flex-start" }}>
          ainda não importada
        </span>
      )}

      {props.canEdit ? (
        <button
          type="button"
          data-variant={props.imported ? undefined : "primary"}
          disabled={busy}
          style={{ alignSelf: "flex-start" }}
          onClick={() =>
            void run(
              start,
              props.origin === "oficial"
                ? "Buscando o texto no site oficial…"
                : "Preparando o material…",
            )
          }
        >
          {busy
            ? "Importando…"
            : !props.imported
              ? "Importar"
              : pending > 0
                ? "Continuar indexação"
                : props.origin === "oficial"
                  ? "Atualizar agora"
                  : "Reimportar"}
        </button>
      ) : null}
      <IngestProgress status={status} />
    </div>
  );
}

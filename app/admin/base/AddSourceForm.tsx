"use client";

import { useState } from "react";
import { addSource } from "@/lib/admin/kb-actions";
import { AUTHORITY_LABELS, KIND_LABELS } from "@/lib/kb/console";
import { IngestProgress } from "./IngestProgress";
import { useIngest } from "./useIngest";

type Mode = "file" | "url" | "text";

const OFFICIAL_HOST = /^https:\/\/([^/]+\.)?(gov\.br|leg\.br)(\/|$)/i;

export function AddSourceForm() {
  const { status, run, busy } = useIngest();
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [authority, setAuthority] = useState("oficial");
  const [kind, setKind] = useState("nota_tecnica");

  const officialLink = OFFICIAL_HOST.test(url.trim());

  return (
    <form
      className="kb-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void run(
          () => addSource(data),
          mode === "url"
            ? "Buscando o documento no site…"
            : mode === "file"
              ? "Lendo o arquivo…"
              : "Preparando o texto…",
        );
      }}
    >
      <div className="kb-modes" role="radiogroup" aria-label="De onde vem o documento">
        {(
          [
            ["url", "Link de um site"],
            ["file", "Arquivo (PDF, Word, página salva)"],
            ["text", "Colar texto"],
          ] as const
        ).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            {label}
          </label>
        ))}
      </div>

      {mode === "url" ? (
        <label>
          <span className="muted">Link do documento</span>
          <input
            name="url"
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.gov.br/receitafederal/..."
          />
        </label>
      ) : null}

      {mode === "file" ? (
        <label>
          <span className="muted">Arquivo (até 4 MB)</span>
          <input
            name="file"
            type="file"
            required
            accept=".pdf,.docx,.htm,.html,.txt,.md"
          />
        </label>
      ) : null}

      {mode === "text" ? (
        <label>
          <span className="muted">
            Texto. Para material próprio, use títulos com <code>## Pergunta</code>: cada
            título vira um trecho que a IA pode citar.
          </span>
          <textarea name="text" rows={10} required minLength={50} />
        </label>
      ) : null}

      <div className="kb-fields">
        <label>
          <span className="muted">Título</span>
          <input
            name="title"
            required
            minLength={3}
            placeholder="Ex.: Perguntas e respostas da CBS"
          />
        </label>
        <label>
          <span className="muted">Como a IA cita</span>
          <input
            name="citationLabel"
            required
            placeholder="Ex.: IN RFB 2.250/2026, Manual RFB"
          />
        </label>
        <label>
          <span className="muted">Tipo</span>
          <select
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="muted">Autoridade</span>
          <select
            name="authority"
            value={authority}
            onChange={(event) => setAuthority(event.target.value)}
          >
            {Object.entries(AUTHORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="muted">Corte do texto</span>
          <select name="shape" defaultValue="auto">
            <option value="auto">Automático pelo tipo</option>
            <option value="legal">Por artigo (texto de lei)</option>
            <option value="markdown">Por título/seção</option>
          </select>
        </label>
        <label>
          <span className="muted">Publicado por (opcional)</span>
          <input name="publisher" placeholder="Ex.: Receita Federal" />
        </label>
        <label>
          <span className="muted">Vale a partir de (opcional)</span>
          <input name="effectiveFrom" type="date" />
        </label>
        <label>
          <span className="muted">Vale até (opcional)</span>
          <input name="effectiveTo" type="date" />
        </label>
        <label>
          <span className="muted">Versão (opcional)</span>
          <input name="version" placeholder="Ex.: atualizada em 10/2026" />
        </label>
        {mode !== "url" ? (
          <label>
            <span className="muted">Link de referência (opcional)</span>
            <input name="url" type="url" placeholder="https://..." />
          </label>
        ) : null}
      </div>

      {mode === "url" ? (
        <label className="kb-modes">
          <input type="checkbox" name="autoUpdate" defaultChecked />
          <span>Conferir este link todo dia e atualizar a base se o texto mudar</span>
        </label>
      ) : null}

      {mode === "url" && authority === "oficial" && url && !officialLink ? (
        <p className="notice" style={{ margin: 0 }}>
          Só sites de governo (gov.br) ou do Legislativo (leg.br) podem entrar como
          “Oficial”. Para outros sites, escolha “Invent” ou “Secundária”.
        </p>
      ) : null}
      {authority === "secundaria" ? (
        <p className="muted" style={{ margin: 0 }}>
          Fonte secundária serve de contexto: a IA nunca a apresenta como norma.
        </p>
      ) : null}
      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
        Se já existir uma fonte com o mesmo título, ela é substituída por esta versão (e
        volta a ficar “sem revisão”).
      </p>

      <div>
        <button type="submit" data-variant="primary" disabled={busy}>
          {busy ? "Adicionando…" : "Adicionar à base"}
        </button>
        <IngestProgress status={status} />
      </div>
    </form>
  );
}

"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { askPublic, submitLead } from "@/lib/public/actions";
import { CONSENT_TEXT } from "@/lib/public/lead";
import { INITIAL_STATE, type SimulatedState } from "@/lib/simulator/state";
import styles from "./site.module.css";

type Entry = { role: "user"; text: string } | { role: "assistant"; blocks: string[] };

const SUGESTOES = [
  "O que muda com a Reforma Tributária?",
  "O que é a CBS e o que é o IBS?",
  "Como fica a nota fiscal com IBS e CBS?",
  "O que é o split payment?",
  "Como a Reforma afeta empresas do Simples?",
  "Como a Invent ajuda minha empresa a se adaptar?",
];

/** Negrito do WhatsApp (*assim*) e links viram formatação de verdade. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|https?:\/\/[^\s<>()]+)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (/^\*[^*\n]+\*$/.test(part))
          return <strong key={index}>{part.slice(1, -1)}</strong>;
        if (/^https?:\/\//.test(part)) {
          const url = part.replace(/[.,;:!?]+$/, "");
          const rest = part.slice(url.length);
          return (
            <Fragment key={index}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {url.replace(/^https?:\/\//, "").replace(/\?.*$/, "")}
              </a>
              {rest}
            </Fragment>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

function ContactCard({ suggestion, onDone }: { suggestion: string; onDone: () => void }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className={styles.card} role="status">
        <p className={styles.success}>Recebemos seu contato.</p>
        <p style={{ margin: 0 }}>
          Um especialista da Invent vai falar com você em breve. Enquanto isso, pode
          continuar perguntando por aqui.
        </p>
      </div>
    );
  }

  return (
    <form
      className={styles.card}
      onSubmit={async (event) => {
        event.preventDefault();
        setSending(true);
        setError(null);
        try {
          const result = await submitLead(new FormData(event.currentTarget));
          if (result.ok) {
            setSent(true);
            onDone();
          } else {
            setError(result.error);
          }
        } catch {
          setError("não foi possível enviar agora; tente de novo em instantes");
        } finally {
          setSending(false);
        }
      }}
    >
      <h2>Falar com um especialista da Invent</h2>
      <div className={styles.fields}>
        <label className={styles.field}>
          Nome
          <input id="lead-name" name="name" required minLength={2} autoComplete="name" />
        </label>
        <label className={styles.field}>
          E-mail
          <input
            id="lead-email"
            name="email"
            type="email"
            required
            autoComplete="email"
          />
        </label>
        <label className={styles.field}>
          WhatsApp (opcional)
          <input
            id="lead-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(62) 99999-0000"
          />
        </label>
        <label className={styles.field}>
          Empresa (opcional)
          <input id="lead-company" name="company" autoComplete="organization" />
        </label>
      </div>
      <label className={styles.field}>
        Como podemos ajudar? (opcional)
        <textarea id="lead-message" name="message" rows={2} defaultValue={suggestion} />
      </label>
      <div className={styles.honeypot} aria-hidden="true">
        <label>
          Site
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className={styles.consent}>
        <input id="lead-consent" type="checkbox" name="consent" required />
        <span>{CONSENT_TEXT}</span>
      </label>
      {error ? (
        <p className={styles.error} role="alert">
          Não foi possível enviar: {error}.
        </p>
      ) : null}
      <div>
        <button type="submit" className={styles.send} disabled={sending}>
          {sending ? "Enviando…" : "Enviar contato"}
        </button>
      </div>
    </form>
  );
}

export function SiteChat() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [state, setState] = useState<SimulatedState>(INITIAL_STATE);
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  const [contact, setContact] = useState<"closed" | "open" | "sent">("closed");
  const [lastQuestion, setLastQuestion] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (entries.length > 0 || contact === "open") {
      end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [entries, thinking, contact]);

  async function ask(text: string) {
    const clean = text.trim();
    if (!clean || thinking) return;

    const history = entries
      .map((entry) =>
        entry.role === "user"
          ? { role: "user" as const, content: entry.text }
          : { role: "assistant" as const, content: entry.blocks.join("\n\n") },
      )
      .slice(-12);

    setEntries((current) => [...current, { role: "user", text: clean }]);
    setQuestion("");
    setLastQuestion(clean);
    setThinking(true);
    try {
      const answer = await askPublic({ question: clean, history, state });
      setEntries((current) => [...current, { role: "assistant", blocks: answer.blocks }]);
      setState(answer.state);
      if (answer.askContact && contact === "closed") setContact("open");
    } catch {
      setEntries((current) => [
        ...current,
        {
          role: "assistant",
          blocks: ["Não consegui responder agora. Confira sua conexão e tente de novo."],
        },
      ]);
    } finally {
      setThinking(false);
      input.current?.focus();
    }
  }

  const empty = entries.length === 0;

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático da marca */}
          <img className={styles.logo} src="/brand/logo.svg" alt="Invent Software" />
          <span className={styles.product}>IA da Reforma Tributária</span>
          <span className={styles.spacer} />
          {contact === "closed" ? (
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setContact("open")}
            >
              Falar com especialista
            </button>
          ) : null}
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.column} style={{ flex: 1 }}>
          {empty ? (
            <section className={styles.hero}>
              <span className={styles.eyebrow}>Invent Software · Reforma Tributária</span>
              <h1 className={styles.title}>
                Tire suas dúvidas sobre a{" "}
                <span className={styles.titleMark}>Reforma Tributária</span>
              </h1>
              <p className={styles.lead}>
                IBS, CBS, Imposto Seletivo, transição, nota fiscal e créditos. A IA
                responde com base na legislação e no conhecimento do time fiscal da
                Invent.
              </p>
              <div className={styles.sources} aria-label="Base da IA">
                <span>EC 132/2023</span>
                <span>LC 214/2025</span>
                <span>Atualizada todo dia nos sites oficiais</span>
              </div>
            </section>
          ) : null}

          {empty ? (
            <div className={styles.suggestions}>
              {SUGESTOES.map((sugestao) => (
                <button
                  key={sugestao}
                  type="button"
                  className={styles.suggestion}
                  onClick={() => void ask(sugestao)}
                >
                  {sugestao}
                </button>
              ))}
            </div>
          ) : null}

          <div className={styles.thread} aria-live="polite">
            {entries.map((entry, index) =>
              entry.role === "user" ? (
                <div key={index} className={`${styles.row} ${styles.rowUser}`}>
                  <div className={`${styles.bubble} ${styles.bubbleUser}`}>
                    {entry.text}
                  </div>
                </div>
              ) : (
                <div key={index} className={styles.row}>
                  <span className={styles.avatar} aria-hidden="true">
                    IA
                  </span>
                  <div className={styles.stack}>
                    {entry.blocks.map((block, blockIndex) => (
                      <div
                        key={blockIndex}
                        className={`${styles.bubble} ${styles.bubbleBot}`}
                      >
                        <RichText text={block} />
                      </div>
                    ))}
                  </div>
                </div>
              ),
            )}
            {thinking ? (
              <div className={styles.row}>
                <span className={styles.avatar} aria-hidden="true">
                  IA
                </span>
                <div className={`${styles.bubble} ${styles.bubbleBot} ${styles.typing}`}>
                  <i />
                  <i />
                  <i />
                  <span className="sr-only" style={{ position: "absolute", left: -9999 }}>
                    A IA está escrevendo
                  </span>
                </div>
              </div>
            ) : null}
            {contact !== "closed" ? (
              <ContactCard suggestion={lastQuestion} onDone={() => setContact("sent")} />
            ) : null}
            <div ref={end} />
          </div>
        </div>

        <div className={styles.composerWrap}>
          <div className={styles.column}>
            <form
              className={styles.composer}
              onSubmit={(event) => {
                event.preventDefault();
                void ask(question);
              }}
            >
              <textarea
                id="pergunta"
                ref={input}
                className={styles.input}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void ask(question);
                  }
                }}
                rows={1}
                maxLength={1000}
                placeholder="Pergunte sobre a Reforma…"
                aria-label="Sua pergunta"
              />
              <button
                type="submit"
                className={styles.send}
                disabled={thinking || !question.trim()}
              >
                Enviar
              </button>
            </form>
            <p className={styles.fineprint}>
              Respostas geradas por IA podem conter erros: confirme com seu contador. Não
              informe dados pessoais ou sigilosos na conversa.
            </p>
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.headerInner}>
          <span>© Invent Software</span>
          <a href="/entrar">Acesso da equipe</a>
        </div>
      </footer>
    </>
  );
}

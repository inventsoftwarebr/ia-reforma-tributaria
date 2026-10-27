"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { askPublic, submitLead } from "@/lib/public/actions";
import { CONSENT_TEXT } from "@/lib/public/lead";
import { INITIAL_STATE, type SimulatedState } from "@/lib/simulator/state";
import styles from "./site.module.css";

type Entry = { role: "user"; text: string } | { role: "assistant"; blocks: string[] };

const SUGESTOES = [
  "O que muda com a Reforma Tributária?",
  "O que são a CBS e o IBS?",
  "Como fica a NF-e com IBS e CBS?",
  "O que é o split payment?",
  "Como a Reforma afeta empresas do Simples Nacional?",
  "Como a Invent ajuda minha empresa a se adaptar?",
];

/* eslint-disable @next/next/no-img-element -- logos oficiais em PNG estático */

/** Logo oficial: assinatura positiva no tema claro, negativa no escuro. */
function Logo() {
  return (
    <picture>
      <source srcSet="/brand/invent-negativo.png" media="(prefers-color-scheme: dark)" />
      <img
        className={styles.logo}
        src="/brand/invent-positivo.png"
        alt="Invent Software"
      />
    </picture>
  );
}

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

function Required() {
  return (
    <span className={styles.required} aria-hidden="true">
      *
    </span>
  );
}

function ContactCard({ suggestion, onDone }: { suggestion: string; onDone: () => void }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className={styles.card} role="status">
        <p className={styles.alertSuccess}>
          <span className={styles.alertTitle}>Contato solicitado</span>
          Um especialista da Invent vai falar com você em breve. Enquanto isso, continue
          perguntando por aqui.
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
          setError("a conexão falhou; tente de novo em instantes");
        } finally {
          setSending(false);
        }
      }}
    >
      <div>
        <h2 className={styles.cardTitle}>Fale com um especialista da Invent</h2>
        <p className={styles.cardText}>
          Deixe seu contato e o time da Invent retorna para entender o cenário da sua
          empresa.
        </p>
      </div>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="lead-name">
            Nome
            <Required />
          </label>
          <input id="lead-name" name="name" required minLength={2} autoComplete="name" />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="lead-email">
            E-mail corporativo
            <Required />
          </label>
          <input
            id="lead-email"
            name="email"
            type="email"
            required
            autoComplete="email"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="lead-phone">
            WhatsApp
          </label>
          <input
            id="lead-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(62) 99999-0000"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="lead-company">
            Empresa
          </label>
          <input id="lead-company" name="company" autoComplete="organization" />
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="lead-message">
          Como podemos ajudar
        </label>
        <textarea id="lead-message" name="message" rows={2} defaultValue={suggestion} />
      </div>
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor="lead-website">Site</label>
        <input id="lead-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <label className={styles.consent} htmlFor="lead-consent">
        <input id="lead-consent" type="checkbox" name="consent" required />
        <span>{CONSENT_TEXT}</span>
      </label>
      {error ? (
        <p className={styles.alertError} role="alert">
          <span className={styles.alertTitle}>O contato não foi enviado</span>
          {error.charAt(0).toUpperCase() + error.slice(1)}.
        </p>
      ) : null}
      <div>
        <button type="submit" className={styles.btnPrimary} disabled={sending}>
          {sending ? "Solicitando…" : "Solicitar contato"}
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
          blocks: [
            "A conexão falhou antes da resposta. Confira sua internet e pergunte de novo.",
          ],
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
          <Logo />
          <span className={styles.divider} aria-hidden="true" />
          <span className={styles.product}>IA da Reforma Tributária</span>
          <span className={styles.spacer} />
          {contact === "closed" ? (
            <button
              type="button"
              className={styles.btnSecondary}
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
              <span className={styles.eyebrow}>
                IA da Reforma Tributária, por Invent Software
              </span>
              <h1 className={styles.title}>
                Entenda a <span className={styles.titleMark}>Reforma Tributária</span> e
                prepare sua empresa
              </h1>
              <p className={styles.lead}>
                Pergunte sobre CBS, IBS, Imposto Seletivo, transição, NF-e e créditos. A
                IA responde com base na legislação e no conhecimento do time fiscal da
                Invent.
              </p>
              <div className={styles.sources}>
                <span>Base oficial:</span>
                <span className={styles.norm}>EC 132/2023</span>
                <span className={styles.norm}>LC 214/2025</span>
                <span>conferida todo dia nos sites do governo</span>
              </div>
            </section>
          ) : null}

          {empty ? (
            <section aria-labelledby="sugestoes">
              <h2 id="sugestoes" className={styles.suggestionsTitle}>
                Comece por uma destas perguntas
              </h2>
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
            </section>
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
                    <img src="/brand/invent-simbolo.png" alt="" />
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
                  <img src="/brand/invent-simbolo.png" alt="" />
                </span>
                <div className={`${styles.bubble} ${styles.bubbleBot} ${styles.typing}`}>
                  <i />
                  <i />
                  <i />
                  <span className={styles.srOnly}>A IA está escrevendo a resposta</span>
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
              <label htmlFor="pergunta" className={styles.srOnly}>
                Sua pergunta sobre a Reforma Tributária
              </label>
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
                placeholder="Pergunte sobre a Reforma Tributária"
              />
              <button
                type="submit"
                className={styles.btnPrimary}
                disabled={thinking || !question.trim()}
              >
                Perguntar
              </button>
            </form>
            <p className={styles.fineprint}>
              Respostas geradas por IA podem conter erros. Confirme com seu contador e não
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

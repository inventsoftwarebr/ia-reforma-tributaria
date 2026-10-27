import type { Metadata } from "next";
import { SiteChat } from "./SiteChat";
import styles from "./site.module.css";

/**
 * Chat público da IA da Reforma Tributária, no site. Mesma IA, base e regras
 * do WhatsApp; sem login, com limite de uso e sem gravar a conversa, só o
 * pedido de contato, com consentimento (lib/public/actions.ts).
 *
 * Identidade visual Invent Software: tokens em site.module.css, fontes
 * carregadas em app/layout.tsx.
 */

// A resposta da IA (busca, ferramentas, modelo) pode passar de 10 segundos.
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "IA da Reforma Tributária | Invent Software",
  description:
    "Entenda a Reforma Tributária e prepare sua empresa: CBS, IBS, Imposto Seletivo, transição e NF-e, com base na legislação e no time fiscal da Invent Software.",
};

export default function Home() {
  return (
    <div className={styles.site}>
      <SiteChat />
    </div>
  );
}

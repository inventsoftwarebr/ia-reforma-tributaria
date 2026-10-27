import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { SiteChat } from "./SiteChat";
import styles from "./site.module.css";

/**
 * Chat público da IA da Reforma Tributária, no site. Mesma IA, base e regras
 * do WhatsApp; sem login, com limite de uso e sem gravar a conversa — só o
 * pedido de contato, com consentimento (lib/public/actions.ts).
 */

const font = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-site",
  display: "swap",
});

// A resposta da IA (busca, ferramentas, modelo) pode passar de 10 segundos.
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "IA da Reforma Tributária | Invent Software",
  description:
    "Tire suas dúvidas sobre a Reforma Tributária: IBS, CBS, Imposto Seletivo, transição e nota fiscal, com base na legislação e no time fiscal da Invent Software.",
};

export default function Home() {
  return (
    <div className={`${styles.site} ${font.variable}`}>
      <SiteChat />
    </div>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "IA da Reforma Tributária — Invent Software",
  description:
    "Atendimento por WhatsApp que tira dúvidas sobre a Reforma Tributária, com resposta citando a norma.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

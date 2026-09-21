import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "IA da Reforma Tributária — Invent Software",
  description:
    "Agente de WhatsApp da Invent Software para dúvidas sobre a Reforma Tributária.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

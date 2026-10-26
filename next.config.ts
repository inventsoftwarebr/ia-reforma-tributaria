import type { NextConfig } from "next";
import { serverEnv } from "./lib/env";

/**
 * Na Vercel, valida todas as variáveis no build: faltando ou errada, o deploy
 * falha com a lista do que corrigir. Sem isso o build passa e o erro só
 * aparece quando chega a primeira mensagem do WhatsApp.
 *
 * Fora da Vercel (máquina local, CI) não valida, para o build rodar sem
 * credenciais reais.
 */
if (process.env.VERCEL === "1") {
  serverEnv();
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Rotas que tocam Postgres, postgres-js ou o AI SDK rodam em Node.
  serverExternalPackages: ["postgres", "unpdf", "mammoth"],
  experimental: {
    // Upload de PDF/Word na base de conhecimento (limite da Vercel: 4,5 MB).
    serverActions: { bodySizeLimit: "4.5mb" },
  },
};

export default nextConfig;

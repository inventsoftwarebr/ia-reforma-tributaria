import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Rotas que tocam Postgres, postgres-js ou o AI SDK rodam em Node (CLAUDE.md §11).
  serverExternalPackages: ["postgres"],
};

export default nextConfig;

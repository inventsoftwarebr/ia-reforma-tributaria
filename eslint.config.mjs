import next from "eslint-config-next";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "legacy/**", "db/migrations/**"] },
  ...next,
  ...nextTypescript,
  {
    rules: {
      // CLAUDE.md: sem console.log em produção. lib/observability é a única
      // porta de saída de log e desativa a regra localmente.
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];

export default config;

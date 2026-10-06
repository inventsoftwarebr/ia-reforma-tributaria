"use client";

import { ConsoleError } from "@/components/ConsoleError";

/** Erro dentro de uma página do console (a moldura com o menu já carregou). */
export default function ErroPaginaConsole({ error }: { error: Error & { digest?: string } }) {
  return <ConsoleError digest={error.digest} />;
}

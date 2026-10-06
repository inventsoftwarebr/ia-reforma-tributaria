"use client";

import { ConsoleError } from "@/components/ConsoleError";

/**
 * Erro na moldura do console (app/admin/layout.tsx), onde roda a checagem de
 * login com consulta ao banco. Erro de layout não é pego pelo error.tsx da
 * mesma pasta, só pelo do nível de cima — por isso este arquivo existe.
 */
export default function ErroGeral({ error }: { error: Error & { digest?: string } }) {
  return <ConsoleError digest={error.digest} />;
}

import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Fora do middleware: rotas de webhook e de fila (autenticadas por segredo
  // próprio), arquivos estáticos e imagens.
  matcher: [
    "/((?!api/whatsapp|api/jobs|api/cron|api/health|_next/static|_next/image|favicon.ico).*)",
  ],
};

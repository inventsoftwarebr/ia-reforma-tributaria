import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { logWarn } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

/**
 * Autorização do console.
 *
 * O console lê o banco pela conexão de serviço, que ignora RLS — então a
 * checagem de papel acontece aqui, e é obrigatória em toda página e em toda
 * Server Action (a action nunca confia no guard da página que a renderizou).
 * O RLS segue valendo como segunda camada para acesso direto à API do Supabase.
 */

export interface SessionUser {
  id: string;
  email: string | null;
  role: "admin" | "agent";
}

type Session =
  | { status: "anonymous" }
  | { status: "no_profile"; email: string | null }
  | { status: "ok"; user: SessionUser };

/**
 * "Não logado" e "logado sem perfil" são situações diferentes e precisam de
 * mensagens diferentes: a segunda acontece com usuário criado antes do
 * bootstrap do banco, e a pessoa só vê a tela de login de novo se ninguém
 * disser o motivo.
 */
async function session(): Promise<Session> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { status: "anonymous" };

  const [profile] = await db
    .select({ role: profiles.role, email: profiles.email })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  if (!profile) {
    logWarn("admin.login_without_profile", { userId: user.id });
    return { status: "no_profile", email: user.email ?? null };
  }

  return {
    status: "ok",
    user: { id: user.id, email: profile.email ?? user.email ?? null, role: profile.role },
  };
}

export async function currentUser(): Promise<SessionUser | null> {
  const current = await session();
  return current.status === "ok" ? current.user : null;
}

export async function requireAgent(): Promise<SessionUser> {
  const current = await session();
  if (current.status === "anonymous") redirect("/entrar?redirect=/admin");
  if (current.status === "no_profile") redirect("/entrar?erro=sem_perfil");
  return current.user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireAgent();
  if (user.role !== "admin") redirect("/admin?erro=sem_permissao");
  return user;
}

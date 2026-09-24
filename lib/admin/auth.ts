import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
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

export async function currentUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [profile] = await db
    .select({ role: profiles.role, email: profiles.email })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  if (!profile) return null;

  return { id: user.id, email: profile.email ?? user.email ?? null, role: profile.role };
}

export async function requireAgent(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/entrar?redirect=/admin");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireAgent();
  if (user.role !== "admin") redirect("/admin?erro=sem_permissao");
  return user;
}

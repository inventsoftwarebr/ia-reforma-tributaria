import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { serverEnv } from "@/lib/env";

/**
 * Cliente Supabase para Server Component, Server Action e Route Handler.
 * Padrão canônico do @supabase/ssr: ler e escrever os cookies da request.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = serverEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component não pode escrever cookie: o refresh do token
          // acontece no middleware, então aqui é seguro ignorar.
        }
      },
    },
  });
}

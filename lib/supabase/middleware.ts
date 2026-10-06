import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { withTimeout } from "@/lib/timeout";

/**
 * Refresh do JWT a cada request e proteção do console.
 *
 * Sem isso o token expira no meio da navegação e o usuário cai para o login
 * sem motivo aparente.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const isConsole = request.nextUrl.pathname.startsWith("/admin");

  let user: unknown = null;
  try {
    ({
      data: { user },
    } = await withTimeout(supabase.auth.getUser(), 8_000, "auth"));
  } catch {
    // Auth fora do ar não pode travar o site inteiro. No console, a checagem
    // do layout tenta de novo e, se falhar, mostra a tela de erro com o
    // caminho do diagnóstico — melhor que mandar para o login sem motivo.
    return response;
  }

  if (isConsole && !user) {
    const login = request.nextUrl.clone();
    login.pathname = "/entrar";
    login.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  return response;
}

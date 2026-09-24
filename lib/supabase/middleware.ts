import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isConsole = request.nextUrl.pathname.startsWith("/admin");

  if (isConsole && !user) {
    const login = request.nextUrl.clone();
    login.pathname = "/entrar";
    login.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  return response;
}

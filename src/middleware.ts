import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

// Tempo máximo que o middleware aguarda o Supabase antes de deixar o request
// passar. Abaixo dos 25s da Vercel para evitar MIDDLEWARE_INVOCATION_TIMEOUT.
// A validação de auth real acontece em requireAuth() dentro de cada route handler.
const MIDDLEWARE_AUTH_TIMEOUT_MS = 5_000;

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Se Supabase nao estiver configurado, passa sem processar
  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() é o método recomendado pelo Supabase no middleware pois garante que
  // o cookie de sessão seja renovado corretamente no response. É envolto em timeout
  // para evitar MIDDLEWARE_INVOCATION_TIMEOUT caso o Supabase esteja lento:
  // se expirar, o request passa sem travar — a auth real está em requireAuth().
  try {
    await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("MIDDLEWARE_AUTH_TIMEOUT")), MIDDLEWARE_AUTH_TIMEOUT_MS),
      ),
    ]);
  } catch {
    // Supabase lento ou indisponível: deixa o request passar.
    // Route handlers validam a sessão independentemente via requireAuth().
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

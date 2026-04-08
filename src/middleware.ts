import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  // Middleware "pass-through":
  // a autenticacao real e feita por requireAuth() nos route handlers protegidos.
  // Isso evita dependencia global de auth externa em todas as requests.
  return NextResponse.next({ request });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

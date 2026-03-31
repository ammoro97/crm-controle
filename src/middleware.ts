import { NextRequest, NextResponse } from "next/server";

// Auth de páginas é gerenciada client-side pelo AppShell (Supabase localStorage).
// Auth de API é gerenciada server-side pelo requireAuth() em cada route handler.
// Este middleware não bloqueia rotas para evitar conflito com o fluxo Supabase.
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

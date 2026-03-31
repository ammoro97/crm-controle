import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "crm_auth_token";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API routes handle their own auth via requireAuth()
  if (pathname.startsWith("/api/")) return NextResponse.next();

  // Public page
  if (pathname.startsWith("/login")) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

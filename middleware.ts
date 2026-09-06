import { NextRequest, NextResponse } from "next/server";

export const AUTH_COOKIE = "dock_auth";

async function expectedCookieValue(): Promise<string | null> {
  const password = process.env.SITE_PASSWORD;
  if (!password) return null;
  const secret = process.env.SITE_PASSWORD_SECRET || password;
  const data = new TextEncoder().encode(`${password}:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(digest).toString("hex");
}

export async function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  if (pathname === "/gate" || pathname === "/api/gate") {
    return NextResponse.next();
  }

  const expected = await expectedCookieValue();
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;

  if (expected && cookie === expected) {
    return NextResponse.next();
  }

  const gateUrl = new URL("/gate", req.url);
  gateUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(gateUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|icon-192.png|icon-512.png).*)"],
};

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
  // Keep the query string too, or a scanned ?pair=<code> link would lose
  // its code when the phone has to unlock first.
  gateUrl.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(gateUrl);
}

export const config = {
  // The manifest and touch icon are fetched by the browser/OS without cookies,
  // so gating them would break installing Dock to a home screen.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icon-192.png|icon-512.png|manifest.webmanifest).*)",
  ],
};

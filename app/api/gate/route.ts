import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/middleware";

async function signedValue(password: string): Promise<string> {
  const secret = process.env.SITE_PASSWORD_SECRET || password;
  const data = new TextEncoder().encode(`${password}:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(digest).toString("hex");
}

export async function POST(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) {
    return NextResponse.json({ ok: true }); // no password configured, nothing to check
  }

  const body = await req.json().catch(() => null);
  const submitted = body?.password;

  if (typeof submitted !== "string" || submitted !== sitePassword) {
    return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 401 });
  }

  const value = await signedValue(sitePassword);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    // ~10 years — effectively "remember this device forever".
    maxAge: 60 * 60 * 24 * 365 * 10,
  });
  return res;
}

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/middleware";
import { redis } from "@/lib/redis";

async function signedValue(password: string): Promise<string> {
  const secret = process.env.SITE_PASSWORD_SECRET || password;
  const data = new TextEncoder().encode(`${password}:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(digest).toString("hex");
}

// Crude but effective brute-force guard: a fixed number of wrong
// passwords per IP within a short window. This piggybacks on the same
// Upstash Redis instance the live relay already uses, so it costs
// nothing extra to set up, and it simply doesn't apply if Redis isn't
// configured (better to allow unlimited attempts than to break login
// entirely for a Redis-less deployment).
const MAX_ATTEMPTS = 10;
const WINDOW_SECONDS = 5 * 60;

function attemptKey(ip: string) {
  return `dock:gate-attempts:${ip}`;
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: NextRequest) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) {
    return NextResponse.json({ ok: true }); // no password configured, nothing to check
  }

  const ip = clientIp(req);
  const key = attemptKey(ip);

  if (redis) {
    const attempts = await redis.incr(key);
    if (attempts === 1) await redis.expire(key, WINDOW_SECONDS);
    if (attempts > MAX_ATTEMPTS) {
      return NextResponse.json(
        { ok: false, error: "Too many attempts. Try again in a few minutes." },
        { status: 429 }
      );
    }
  }

  const body = await req.json().catch(() => null);
  const submitted = body?.password;

  if (typeof submitted !== "string" || submitted !== sitePassword) {
    return NextResponse.json({ ok: false, error: "Wrong password" }, { status: 401 });
  }

  if (redis) {
    redis.del(key).catch(() => {});
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

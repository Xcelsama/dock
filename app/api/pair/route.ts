import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { newPairCode, sessionKey, PAIR_WAIT_TTL_SECONDS } from "@/lib/pair";

export const dynamic = "force-dynamic";

// POST /api/pair — start a pairing session, returns the code to show as QR.
export async function POST() {
  if (!redis) {
    return NextResponse.json(
      { error: "Pairing needs Upstash Redis (it only relays connection setup, never files). See the README." },
      { status: 503 }
    );
  }

  const code = newPairCode();
  await redis.set(sessionKey(code), 1, { ex: PAIR_WAIT_TTL_SECONDS });
  return NextResponse.json({ code, ttl: PAIR_WAIT_TTL_SECONDS });
}

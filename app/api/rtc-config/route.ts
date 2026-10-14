import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ICE servers for device-to-device transfers. STUN lets two devices find
// each other's public address; TURN (optional, set TURN_* env vars) relays
// the encrypted traffic when a direct path is impossible, e.g. some
// mobile-carrier or corporate networks. Without TURN those pairs can't
// connect at all.
export async function GET() {
  const iceServers: { urls: string | string[]; username?: string; credential?: string }[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
  ];

  const turnUrls = (process.env.TURN_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;
  const relay = turnUrls.length > 0 && Boolean(username && credential);

  if (relay) iceServers.push({ urls: turnUrls, username, credential });

  return NextResponse.json(
    { iceServers, relay },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}

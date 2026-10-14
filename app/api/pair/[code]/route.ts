import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import {
  isPairCode,
  sessionKey,
  mailboxKey,
  PairRole,
  PAIR_JOINED_TTL_SECONDS,
  PAIR_MAX_MESSAGES,
  PAIR_MAX_MESSAGE_BYTES,
  PAIR_WAIT_TTL_SECONDS,
} from "@/lib/pair";

export const dynamic = "force-dynamic";

const SIGNAL_TYPES = new Set(["join", "offer", "answer", "ice", "bye"]);

function parseRole(value: unknown): PairRole | null {
  return value === "host" || value === "guest" ? value : null;
}

// GET /api/pair/[code]?role=host|guest&after=N
// Returns the signaling messages addressed to `role` after index N. Index
// based (not pop-based) so a lost response can never lose a message.
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toLowerCase();
  const role = parseRole(req.nextUrl.searchParams.get("role"));
  if (!redis || !role || !isPairCode(code)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const after = Math.max(0, Math.floor(Number(req.nextUrl.searchParams.get("after")) || 0));

  const [exists, msgs] = await redis
    .pipeline()
    .exists(sessionKey(code))
    .lrange(mailboxKey(code, role), after, -1)
    .exec<[number, unknown[]]>();

  if (!exists) {
    return NextResponse.json({ error: "Expired." }, { status: 404 });
  }

  return NextResponse.json({ msgs, next: after + msgs.length });
}

// POST /api/pair/[code] — { to: "host" | "guest", msg: { type, ... } }
export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toLowerCase();
  if (!redis || !isPairCode(code)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const to = parseRole(body?.to);
  const msg = body?.msg;
  if (!to || !msg || typeof msg.type !== "string" || !SIGNAL_TYPES.has(msg.type)) {
    return NextResponse.json({ error: "Invalid message." }, { status: 400 });
  }
  if (JSON.stringify(msg).length > PAIR_MAX_MESSAGE_BYTES) {
    return NextResponse.json({ error: "Message too large." }, { status: 413 });
  }

  const exists = await redis.exists(sessionKey(code));
  if (!exists) {
    return NextResponse.json({ error: "Expired." }, { status: 404 });
  }

  const box = mailboxKey(code, to);
  const length = await redis.rpush(box, msg);
  if (length > PAIR_MAX_MESSAGES) {
    await redis.del(box);
    return NextResponse.json({ error: "Too many messages." }, { status: 429 });
  }

  // Once someone scans, the clock only needs to cover the handshake.
  const ttl = msg.type === "join" ? PAIR_JOINED_TTL_SECONDS : PAIR_WAIT_TTL_SECONDS;
  await Promise.all([
    redis.expire(box, PAIR_WAIT_TTL_SECONDS),
    msg.type === "join" ? redis.expire(sessionKey(code), ttl) : Promise.resolve(),
  ]);

  return NextResponse.json({ ok: true });
}

// DELETE /api/pair/[code] — tidy up once the devices are connected.
export async function DELETE(_req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.toLowerCase();
  if (redis && isPairCode(code)) {
    await redis.del(sessionKey(code), mailboxKey(code, "host"), mailboxKey(code, "guest"));
  }
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import {
  redis,
  INDEX_KEY,
  ITEM_PREFIX,
  TTL_SECONDS,
  MAX_BROADCAST_BYTES,
  clampTtl,
} from "@/lib/redis";
import { RelayRecord } from "@/lib/types";

export async function GET(req: NextRequest) {
  if (!redis) {
    return NextResponse.json({ items: [] as RelayRecord[] });
  }

  const ids = await redis.zrange<string[]>(INDEX_KEY, 0, -1, { rev: true });
  if (!ids.length) {
    return NextResponse.json({ items: [] as RelayRecord[] });
  }

  // The client already has full copies of items it knows about (it sends
  // their ids via ?known=). Every poll used to re-fetch the full base64
  // body of every live item, known or not — that's what was blowing past
  // Upstash's max request size once a couple of photos were sitting in
  // the relay. Now we only mget the ones the client is actually missing.
  const knownParam = req.nextUrl.searchParams.get("known") ?? "";
  const known = new Set(knownParam.split(",").filter(Boolean));
  const missingIds = ids.filter((id) => !known.has(id));

  if (!missingIds.length) {
    return NextResponse.json({ items: [] as RelayRecord[] });
  }

  // Fetching everything missing in one mget is what blew past Upstash's
  // 10MB max request size once the backlog got big — a giant mget just
  // fails outright, and since nothing gets delivered, nothing ever
  // becomes "known," so the same oversized batch gets retried forever.
  // Instead, pull items one at a time up to a safe byte budget. Whatever
  // doesn't fit this round simply stays "missing" and gets picked up on
  // the next poll, a few seconds later — so it self-heals over a couple
  // of cycles no matter how large the backlog is, instead of failing.
  const SAFE_RESPONSE_BYTES = 7 * 1024 * 1024; // headroom under the 10MB cap

  const items: RelayRecord[] = [];
  const stale: string[] = [];
  let approxBytes = 0;

  for (const id of missingIds) {
    if (approxBytes >= SAFE_RESPONSE_BYTES) break;

    const value = await redis.get<RelayRecord | null>(`${ITEM_PREFIX}${id}`);
    if (!value) {
      stale.push(id);
      continue;
    }
    items.push(value);
    approxBytes += JSON.stringify(value).length;
  }

  // Redis already expired the stray keys via TTL, this just tidies the
  // index. Not awaited on purpose, doesn't need to hold up the response.
  if (stale.length) {
    redis.zrem(INDEX_KEY, ...stale).catch(() => {});
  }

  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  if (!redis) {
    return NextResponse.json(
      { error: "Live sharing isn't configured yet." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { id, kind, name, size, mime, createdAt, text, content, ttlSeconds } =
    body as Partial<RelayRecord> & { ttlSeconds?: number };

  if (!id || !kind || !name || !createdAt) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  if (typeof size === "number" && size > MAX_BROADCAST_BYTES) {
    return NextResponse.json(
      { error: "Too large to share live." },
      { status: 413 }
    );
  }

  const record: RelayRecord = {
    id,
    kind,
    name,
    size: size ?? 0,
    mime: mime ?? null,
    createdAt,
    text: text ?? null,
    content: content ?? null,
  };

  // Caller can request a shorter or longer expiry per item (see the TTL
  // picker in the UI). Clamped server-side so a tampered request can't
  // pin an item in Redis indefinitely or expire it instantly.
  const ttl = ttlSeconds !== undefined ? clampTtl(ttlSeconds) : TTL_SECONDS;

  await redis.set(`${ITEM_PREFIX}${id}`, record, { ex: ttl });
  await redis.zadd(INDEX_KEY, {
    score: Date.parse(createdAt) || Date.now(),
    member: id,
  });

  return NextResponse.json({ ok: true });
}

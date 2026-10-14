import { NextRequest, NextResponse } from "next/server";
import {
  redis,
  INDEX_KEY,
  ITEM_PREFIX,
  SAVED_VERSION_KEY,
  TTL_SECONDS,
  clampTtl,
} from "@/lib/redis";
import { MAX_BROADCAST_BYTES } from "@/lib/relay-limits";
import { RelayRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

// Items that the client is missing are fetched one at a time up to this
// budget. A single giant mget blew past Upstash's 10 MB request cap when
// the backlog got big; whatever doesn't fit this round is picked up on the
// next poll, so it self-heals.
const SAFE_RESPONSE_BYTES = 7 * 1024 * 1024;

export async function GET(req: NextRequest) {
  if (!redis) {
    return NextResponse.json({ items: [] as RelayRecord[], savedVersion: null });
  }

  // One round trip for both the id list and the saved-version counter.
  const [ids, version] = await redis
    .pipeline()
    .zrange(INDEX_KEY, 0, -1, { rev: true })
    .get(SAVED_VERSION_KEY)
    .exec<[string[], number | null]>();

  const savedVersion = Number(version ?? 0);

  // The client sends the ids it already holds (?known=) so we only fetch
  // bodies it's actually missing.
  const knownParam = req.nextUrl.searchParams.get("known") ?? "";
  const known = new Set(knownParam.split(",").filter(Boolean));
  const missingIds = ids.filter((id) => !known.has(id));

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
  // index. Not awaited on purpose.
  if (stale.length) {
    redis.zrem(INDEX_KEY, ...stale).catch(() => {});
  }

  return NextResponse.json({ items, savedVersion });
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
    return NextResponse.json({ error: "Too large to share live." }, { status: 413 });
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

  // Clamped server-side so a tampered request can't pin an item in Redis
  // indefinitely or expire it instantly.
  const ttl = ttlSeconds !== undefined ? clampTtl(ttlSeconds) : TTL_SECONDS;

  await redis.set(`${ITEM_PREFIX}${id}`, record, { ex: ttl });
  await redis.zadd(INDEX_KEY, {
    score: Date.parse(createdAt) || Date.now(),
    member: id,
  });

  return NextResponse.json({ ok: true });
}

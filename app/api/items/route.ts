import { NextRequest, NextResponse } from "next/server";
import {
  redis,
  INDEX_KEY,
  ITEM_PREFIX,
  TTL_SECONDS,
  MAX_BROADCAST_BYTES,
} from "@/lib/redis";
import { RelayRecord } from "@/lib/types";

export async function GET() {
  if (!redis) {
    return NextResponse.json({ items: [] as RelayRecord[] });
  }

  const ids = await redis.zrange<string[]>(INDEX_KEY, 0, -1, { rev: true });
  if (!ids.length) {
    return NextResponse.json({ items: [] as RelayRecord[] });
  }

  const keys = ids.map((id) => `${ITEM_PREFIX}${id}`);
  const raw = await redis.mget<(RelayRecord | null)[]>(...keys);

  const items: RelayRecord[] = [];
  const stale: string[] = [];

  raw.forEach((value, i) => {
    if (value) items.push(value);
    else stale.push(ids[i]);
  });

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

  const { id, kind, name, size, mime, createdAt, text, content } = body as Partial<RelayRecord>;

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

  await redis.set(`${ITEM_PREFIX}${id}`, record, { ex: TTL_SECONDS });
  await redis.zadd(INDEX_KEY, {
    score: Date.parse(createdAt) || Date.now(),
    member: id,
  });

  return NextResponse.json({ ok: true });
}

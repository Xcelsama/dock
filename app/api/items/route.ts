import { NextRequest, NextResponse } from "next/server";
import {
  redis,
  INDEX_KEY,
  ITEM_PREFIX,
  BLOB_PREFIX,
  TTL_SECONDS,
  MAX_TTL_SECONDS,
  clampTtl,
} from "@/lib/redis";
import { MAX_BROADCAST_BYTES } from "@/lib/relay-limits";
import { listLive, StoredItem } from "@/lib/live-list";
import { RelayUpload } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/items?known=<ids>&since=<ISO>
// Lists what's live as metadata only. The file bytes are not in this
// response: they're fetched from /api/items/<id>/content when a file is
// opened, previewed or downloaded. That keeps a poll tiny however many large
// files are sitting in the relay, and means a fresh page load no longer
// downloads every live file just to draw the list.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // The client sends the ids it already holds (?known=) so we only describe
  // what it's missing.
  const known = new Set((params.get("known") ?? "").split(",").filter(Boolean));
  const sinceParam = params.get("since");
  const since = sinceParam ? Date.parse(sinceParam) : null;

  const listing = await listLive({ since: Number.isFinite(since) ? since : null, known });
  return NextResponse.json(listing);
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
    body as Partial<RelayUpload> & { ttlSeconds?: number };

  if (!id || !kind || !name || !createdAt) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  if (typeof size === "number" && size > MAX_BROADCAST_BYTES) {
    return NextResponse.json({ error: "Too large to share live." }, { status: 413 });
  }

  const record: StoredItem = {
    id,
    kind,
    name,
    size: size ?? 0,
    mime: mime ?? null,
    createdAt,
    text: text ?? null,
    hasContent: Boolean(content),
  };

  // Clamped server-side so a tampered request can't pin an item in Redis
  // indefinitely or expire it instantly.
  const ttl = ttlSeconds !== undefined ? clampTtl(ttlSeconds) : TTL_SECONDS;

  // One round trip for everything. The bytes go in first, so by the time an
  // id shows up in the index its file is already there. The last command
  // sweeps ids older than the longest possible TTL (a day of slack on top):
  // those items are certainly gone, and the windowed list never looks that
  // far back to notice.
  const pipe = redis.pipeline();
  if (content) pipe.set(`${BLOB_PREFIX}${id}`, { c: content }, { ex: ttl });
  pipe.set(`${ITEM_PREFIX}${id}`, record, { ex: ttl });
  pipe.zadd(INDEX_KEY, { score: Date.parse(createdAt) || Date.now(), member: id });
  pipe.zremrangebyscore(INDEX_KEY, "-inf", Date.now() - (MAX_TTL_SECONDS + 24 * 60 * 60) * 1000);
  await pipe.exec();

  return NextResponse.json({ ok: true });
}

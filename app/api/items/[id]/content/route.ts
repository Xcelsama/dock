import { NextRequest, NextResponse } from "next/server";
import { redis, ITEM_PREFIX, BLOB_PREFIX } from "@/lib/redis";
import type { StoredItem } from "@/lib/live-list";

export const dynamic = "force-dynamic";

// A live item's id is a UUID made on the device that added it. Anything else
// can't be one of ours, so it's a quick 404 before touching Redis.
const ID_RE = /^[0-9a-z-]{8,64}$/i;

function attachmentHeader(name: string): string {
  // ASCII fallback for old clients plus the RFC 5987 form for everything else.
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// GET /api/items/[id]/content[?download=1]
// The bytes of a live file. Metadata and bytes are fetched in the same round
// trip, then decoded from base64 and served as a normal file, so images
// preview with a plain <img src> and the browser can cache them.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!redis) {
    return NextResponse.json({ error: "Live sharing isn't configured yet." }, { status: 503 });
  }
  if (!ID_RE.test(params.id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const [meta, blob] = await redis
    .pipeline()
    .get(`${ITEM_PREFIX}${params.id}`)
    .get(`${BLOB_PREFIX}${params.id}`)
    .exec<[StoredItem | null, { c?: string } | null]>();

  // Items shared before the bytes were split out keep them inside the record.
  const base64 = blob?.c ?? meta?.content ?? null;
  if (!meta || !base64) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const bytes = Buffer.from(base64, "base64");
  const download = req.nextUrl.searchParams.get("download") === "1";

  const headers: Record<string, string> = {
    "Content-Type": meta.mime || "application/octet-stream",
    "Content-Length": String(bytes.byteLength),
    // The bytes behind an id never change, so the browser can keep them. If
    // the item expires, a copy already on this device is simply still there.
    "Cache-Control": download ? "no-store" : "private, max-age=86400, immutable",
    // These bytes come from other people's devices and are served from this
    // origin, so a page-like file (html, svg) opened directly must not be
    // able to run script against the app.
    "Content-Security-Policy": "sandbox",
  };
  if (download) headers["Content-Disposition"] = attachmentHeader(meta.name);

  return new NextResponse(new Uint8Array(bytes), { headers });
}

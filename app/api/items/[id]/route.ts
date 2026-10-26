import { NextRequest, NextResponse } from "next/server";
import { redis, INDEX_KEY, ITEM_PREFIX, BLOB_PREFIX } from "@/lib/redis";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!redis) {
    return NextResponse.json({ ok: true });
  }
  // Metadata, bytes and index entry go in one round trip.
  await redis
    .pipeline()
    .del(`${ITEM_PREFIX}${params.id}`)
    .del(`${BLOB_PREFIX}${params.id}`)
    .zrem(INDEX_KEY, params.id)
    .exec();
  return NextResponse.json({ ok: true });
}

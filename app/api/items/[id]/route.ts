import { NextRequest, NextResponse } from "next/server";
import { redis, INDEX_KEY, ITEM_PREFIX } from "@/lib/redis";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!redis) {
    return NextResponse.json({ ok: true });
  }
  await redis.del(`${ITEM_PREFIX}${params.id}`);
  await redis.zrem(INDEX_KEY, params.id);
  return NextResponse.json({ ok: true });
}

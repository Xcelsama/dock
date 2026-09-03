import { NextResponse } from "next/server";
import { redisConfigured } from "@/lib/redis";

export async function GET() {
  return NextResponse.json({ redisConfigured });
}

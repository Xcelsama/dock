import { NextResponse } from "next/server";
import { redisConfigured } from "@/lib/redis";
import { supabaseAdminConfigured } from "@/lib/supabase-admin";

export async function GET() {
  return NextResponse.json({
    redisConfigured,
    supabaseConfigured: supabaseAdminConfigured,
  });
}

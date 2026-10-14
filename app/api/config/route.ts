import { NextResponse } from "next/server";
import { redisConfigured } from "@/lib/redis";
import { supabaseAdminConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { redisConfigured, supabaseConfigured: supabaseAdminConfigured },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}

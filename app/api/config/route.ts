import { NextResponse } from "next/server";
import { redisConfigured } from "@/lib/redis";
import { savedConfigured } from "@/lib/saved-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    // `supabaseConfigured` keeps its old name so the app code needn't change;
    // it now means "permanent storage (Redis + R2) is ready".
    { redisConfigured, supabaseConfigured: savedConfigured },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}

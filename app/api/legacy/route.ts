import { NextRequest, NextResponse } from "next/server";
import { legacyConfigured, listLegacy, LEGACY_UNAVAILABLE } from "@/lib/legacy";

export const dynamic = "force-dynamic";

// GET /api/legacy?before=<ISO>&limit=50 — items still sitting in the old Supabase project.
export async function GET(req: NextRequest) {
  if (!legacyConfigured) {
    return NextResponse.json({ configured: false, items: [], hasMore: false });
  }

  const { searchParams } = req.nextUrl;
  const before = searchParams.get("before");
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));

  try {
    const { items, hasMore } = await listLegacy({ before, limit });
    return NextResponse.json({ configured: true, items, hasMore }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "";
    return NextResponse.json(
      { configured: true, items: [], hasMore: false, error: LEGACY_UNAVAILABLE, detail },
      { status: 502 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { listLive } from "@/lib/live-list";
import { listSavedWindow, parseSince } from "@/lib/saved-list";
import { startOfYesterday } from "@/lib/window";

export const dynamic = "force-dynamic";

// GET /api/bootstrap?since=<ISO>
// Everything the home screen needs to paint, in one request: what's live in
// the relay, the recent saved items, and every pin. Before this the page made
// three separate calls (config, live, saved), and on a serverless host each
// one could be its own cold start. Here the relay and the database are asked
// at the same time and the browser waits on a single response.
export async function GET(req: NextRequest) {
  const since = parseSince(req.nextUrl.searchParams.get("since")) ?? startOfYesterday().toISOString();

  const [live, saved] = await Promise.all([
    listLive({ since: Date.parse(since) }).catch(() => null),
    listSavedWindow(since),
  ]);

  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  return NextResponse.json(
    {
      live: live ?? { configured: true, items: [], savedVersion: null, hasOlder: false },
      saved: saved.window,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

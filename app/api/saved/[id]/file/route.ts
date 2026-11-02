import { NextRequest, NextResponse } from "next/server";
import { savedConfigured, getSaved, UUID_RE } from "@/lib/saved-store";
import { r2SignedGetUrl, SIGNED_URL_TTL_SECONDS } from "@/lib/r2";
import { legacyConfigured, legacySignedUrl, LEGACY_UNAVAILABLE } from "@/lib/legacy";

export const dynamic = "force-dynamic";

function redirectTo(url: string, download: boolean) {
  return NextResponse.redirect(url, {
    status: 302,
    headers: {
      "Cache-Control": download ? "no-store" : `private, max-age=${SIGNED_URL_TTL_SECONDS - 600}`,
    },
  });
}

// GET /api/saved/[id]/file[?download=1]
// Stable same-origin URL for a saved file. New files redirect to a signed R2
// URL (R2 has no egress fees). If the id isn't in the new storage, the old
// Supabase project is checked, so files saved there earlier still open.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!savedConfigured && !legacyConfigured) {
    return NextResponse.json({ error: "Storage isn't configured yet." }, { status: 503 });
  }

  const download = req.nextUrl.searchParams.get("download") === "1";

  // 1) New storage (Redis record + R2 file)
  if (savedConfigured) {
    const row = await getSaved(params.id).catch(() => null);
    if (row?.storagePath) {
      try {
        const url = await r2SignedGetUrl(row.storagePath, {
          downloadName: download ? row.name : undefined,
          contentType: row.mime,
        });
        return redirectTo(url, download);
      } catch {
        return NextResponse.json({ error: "Couldn't open file." }, { status: 502 });
      }
    }
  }

  // 2) Old Supabase project, only reached when the id isn't in the new storage
  if (legacyConfigured) {
    try {
      const url = await legacySignedUrl(params.id, download);
      if (url) return redirectTo(url, download);
    } catch {
      return NextResponse.json({ error: LEGACY_UNAVAILABLE }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

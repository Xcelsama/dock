import { NextRequest, NextResponse } from "next/server";
import {
  supabaseAdmin,
  BUCKET,
  TABLE,
  SIGNED_URL_TTL_SECONDS,
  UUID_RE,
} from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// GET /api/saved/[id]/file[?download=1]
// Stable URL for a saved file. Mints a signed Supabase URL and redirects to
// it. The redirect itself is cached for a bit less than the signed URL's
// lifetime, so repeat views of the same image hit the browser cache
// instead of re-downloading it. `download=1` asks Supabase to send the file
// as an attachment, so no cross-origin blob fetching is needed client-side.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase isn't configured yet." }, { status: 503 });
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { data: row } = await supabaseAdmin
    .from(TABLE)
    .select("storage_path, name")
    .eq("id", params.id)
    .single();

  if (!row?.storage_path) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const download = req.nextUrl.searchParams.get("download") === "1";
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(
      row.storage_path,
      SIGNED_URL_TTL_SECONDS,
      download ? { download: row.name } : undefined
    );

  if (error || !data) {
    return NextResponse.json({ error: "Couldn't open file." }, { status: 502 });
  }

  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    headers: {
      "Cache-Control": download
        ? "no-store"
        : `private, max-age=${SIGNED_URL_TTL_SECONDS - 600}`,
    },
  });
}

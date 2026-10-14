import { NextRequest, NextResponse } from "next/server";
import {
  supabaseAdmin,
  BUCKET,
  TABLE,
  UUID_RE,
  toSavedRecord,
} from "@/lib/supabase-admin";
import { bumpSavedVersion } from "@/lib/redis";
import { ItemKind } from "@/lib/types";

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

function isItemKind(value: unknown): value is ItemKind {
  return (
    value === "text" ||
    value === "image" ||
    value === "pdf" ||
    value === "zip" ||
    value === "file"
  );
}

// GET /api/saved?limit=30&before=<ISO timestamp>&trash=1
// Cursor-based pagination on created_at: pass the createdAt of the last
// item you already have as `before` to get the next page. No signed URLs
// are minted here any more (that was one Supabase round trip per item per
// poll); files are reached through /api/saved/[id]/file instead.
export async function GET(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ items: [], hasMore: false });
  }

  const { searchParams } = req.nextUrl;
  const trash = searchParams.get("trash") === "1";
  const before = searchParams.get("before");
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get("limit")) || DEFAULT_PAGE_SIZE)
  );

  let query = supabaseAdmin
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit + 1); // fetch one extra to know if there's a next page

  query = trash ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return NextResponse.json({ items: page.map(toSavedRecord), hasMore });
}

// POST /api/saved — multipart/form-data.
// Fields: id (optional client uuid, keeps the item's identity stable
// across "local" -> "saved"), kind, name, mime (optional), textContent
// (optional), file (optional binary). Everything goes through the
// service-role client server-side.
//
// Note: on Vercel a request body is capped at ~4.5 MB, so larger files
// can't be saved through this route (the client shows a clear message).
export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase isn't configured yet." },
      { status: 503 }
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const id = form.get("id");
  const kind = form.get("kind");
  const name = form.get("name");
  const mime = form.get("mime");
  const textContent = form.get("textContent");
  const file = form.get("file");

  if (!isItemKind(kind) || typeof name !== "string" || !name) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  let storagePath: string | null = null;
  let size = 0;

  if (file instanceof File) {
    storagePath = `${Date.now()}-${safeName(name)}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    size = bytes.byteLength;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: typeof mime === "string" && mime ? mime : file.type || undefined,
        // Paths are unique per upload and never overwritten, so the bytes
        // are safe for browsers to cache for a long time.
        cacheControl: "31536000",
        upsert: false,
      });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
  } else if (typeof textContent === "string") {
    size = new Blob([textContent]).size;
  }

  const { data, error: insertError } = await supabaseAdmin
    .from(TABLE)
    .insert({
      ...(typeof id === "string" && UUID_RE.test(id) ? { id } : {}),
      kind,
      name,
      size,
      mime: typeof mime === "string" && mime ? mime : null,
      storage_path: storagePath,
      text_content: typeof textContent === "string" ? textContent : null,
    })
    .select()
    .single();

  if (insertError) {
    // Don't leave an orphaned file behind if the row couldn't be written.
    if (storagePath) {
      await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  bumpSavedVersion();
  return NextResponse.json({ item: toSavedRecord(data) });
}

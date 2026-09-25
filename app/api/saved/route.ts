import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, BUCKET, TABLE, signedUrlFor } from "@/lib/supabase-admin";
import { SavedRecord, ItemKind } from "@/lib/types";

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
// item you already have as `before` to get the next page. Keeps the
// query fast and the payload small no matter how many items pile up
// over months of use, instead of the old "select everything, every
// poll" approach.
export async function GET(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ items: [] as SavedRecord[], hasMore: false });
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

  const items: SavedRecord[] = await Promise.all(
    page.map(async (row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      size: row.size,
      mime: row.mime,
      createdAt: row.created_at,
      textContent: row.text_content,
      storagePath: row.storage_path,
      remoteUrl: await signedUrlFor(row.storage_path),
      deletedAt: row.deleted_at,
    }))
  );

  return NextResponse.json({ items, hasMore });
}

// POST /api/saved — multipart/form-data.
// Fields: kind, name, mime (optional), textContent (optional),
// file (optional binary). Everything goes through the service-role
// client server-side; the browser never touches Supabase directly.
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
        contentType: typeof mime === "string" ? mime : file.type || undefined,
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
      kind,
      name,
      size,
      mime: typeof mime === "string" ? mime : null,
      storage_path: storagePath,
      text_content: typeof textContent === "string" ? textContent : null,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const record: SavedRecord = {
    id: data.id,
    kind: data.kind,
    name: data.name,
    size: data.size,
    mime: data.mime,
    createdAt: data.created_at,
    textContent: data.text_content,
    storagePath: data.storage_path,
    remoteUrl: await signedUrlFor(data.storage_path),
    deletedAt: data.deleted_at,
  };

  return NextResponse.json({ item: record });
}

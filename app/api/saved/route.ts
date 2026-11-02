import { NextRequest, NextResponse } from "next/server";
import { r2Put } from "@/lib/r2";
import {
  savedConfigured,
  createSaved,
  getSaved,
  listPage,
  toSavedRecord,
  UUID_RE,
  type SavedRow,
} from "@/lib/saved-store";
import { bumpSavedVersion } from "@/lib/redis";
import { listSavedWindow, parseSince } from "@/lib/saved-list";
import { ItemKind } from "@/lib/types";

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
// Text lives in Redis, whose request size is limited; files have no such limit here.
const MAX_TEXT_BYTES = 500_000;

function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

function isItemKind(value: unknown): value is ItemKind {
  return value === "text" || value === "image" || value === "pdf" || value === "zip" || value === "file";
}

// GET /api/saved?since=<ISO>                      home list (recent window + pins)
// GET /api/saved?limit=30&before=<ISO>&trash=1    paged list / Trash
export async function GET(req: NextRequest) {
  if (!savedConfigured) {
    return NextResponse.json({ items: [], hasMore: false });
  }

  const { searchParams } = req.nextUrl;
  const trash = searchParams.get("trash") === "1";
  const before = searchParams.get("before");

  const since = parseSince(searchParams.get("since"));
  if (since && !trash && !before) {
    const result = await listSavedWindow(since);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(result.window);
  }

  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("limit")) || DEFAULT_PAGE_SIZE));

  try {
    const { items, hasMore } = await listPage({ trash, before, limit });
    return NextResponse.json({ items: items.map(toSavedRecord), hasMore });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't load items." },
      { status: 500 }
    );
  }
}

// POST /api/saved — multipart/form-data.
// Fields: id (optional client uuid), kind, name, mime, textContent, file, pinned ("1").
// Note: on Vercel a request body is capped at ~4.5 MB.
export async function POST(req: NextRequest) {
  if (!savedConfigured) {
    return NextResponse.json({ error: "Storage isn't configured yet." }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const idRaw = form.get("id");
  const kind = form.get("kind");
  const name = form.get("name");
  const mime = form.get("mime");
  const textContent = form.get("textContent");
  const file = form.get("file");
  const pinned = form.get("pinned") === "1";

  if (!isItemKind(kind) || typeof name !== "string" || !name) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  const id = typeof idRaw === "string" && UUID_RE.test(idRaw) ? idRaw : crypto.randomUUID();

  // Saving the same item twice returns what's already there.
  const existing = await getSaved(id).catch(() => null);
  if (existing) return NextResponse.json({ item: toSavedRecord(existing) });

  let storagePath: string | null = null;
  let size = 0;
  const mimeStr = typeof mime === "string" && mime ? mime : null;

  if (file instanceof File) {
    storagePath = `${id}/${safeName(name)}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    size = bytes.byteLength;
    try {
      await r2Put(storagePath, bytes, mimeStr || file.type || undefined);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Upload failed." },
        { status: 500 }
      );
    }
  } else if (typeof textContent === "string") {
    size = new Blob([textContent]).size;
    if (size > MAX_TEXT_BYTES) {
      return NextResponse.json(
        { error: "That text is too long to save (limit about 500 KB). Save it as a file instead." },
        { status: 413 }
      );
    }
  }

  const now = new Date().toISOString();
  const row: SavedRow = {
    id,
    kind,
    name,
    size,
    mime: mimeStr,
    storagePath,
    textContent: typeof textContent === "string" ? textContent : null,
    createdAt: now,
    deletedAt: null,
    pinnedAt: pinned ? now : null,
  };

  try {
    await createSaved(row);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Save failed." }, { status: 500 });
  }

  await bumpSavedVersion();
  return NextResponse.json({ item: toSavedRecord(row) });
}

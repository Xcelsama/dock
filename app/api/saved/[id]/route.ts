import { NextRequest, NextResponse } from "next/server";
import {
  savedConfigured,
  getSaved,
  setPinned,
  setTrashed,
  deleteSaved,
  toSavedRecord,
  UUID_RE,
} from "@/lib/saved-store";
import { r2Delete } from "@/lib/r2";
import { bumpSavedVersion } from "@/lib/redis";

// PATCH /api/saved/[id] — { action: "trash" | "restore" | "pin" | "unpin" }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!savedConfigured) {
    return NextResponse.json({ error: "Storage isn't configured yet." }, { status: 503 });
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "trash" && action !== "restore" && action !== "pin" && action !== "unpin") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  try {
    const row = await getSaved(params.id);
    if (!row) {
      return NextResponse.json({ error: "That item isn't in Dock any more." }, { status: 404 });
    }

    const isPinAction = action === "pin" || action === "unpin";
    // A trashed item can't be pinned; restore it first.
    if (isPinAction && row.deletedAt) {
      return NextResponse.json({ error: "That item isn't in Dock any more." }, { status: 404 });
    }

    const next = isPinAction
      ? await setPinned(row, action === "pin")
      : await setTrashed(row, action === "trash");

    await bumpSavedVersion();
    return NextResponse.json({ item: toSavedRecord(next) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Update failed." }, { status: 500 });
  }
}

// DELETE /api/saved/[id] — permanent. Removes the file and the record.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!savedConfigured) return NextResponse.json({ ok: true });
  if (!UUID_RE.test(params.id)) return NextResponse.json({ ok: true });

  try {
    const row = await getSaved(params.id);
    if (row?.storagePath) await r2Delete(row.storagePath);
    await deleteSaved(params.id);
    await bumpSavedVersion();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Delete failed." }, { status: 500 });
  }
}

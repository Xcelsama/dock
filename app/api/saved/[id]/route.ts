import { NextRequest, NextResponse } from "next/server";
import {
  supabaseAdmin,
  BUCKET,
  TABLE,
  toSavedRecord,
  UUID_RE,
  isMissingPinColumn,
  PIN_MIGRATION_MESSAGE,
} from "@/lib/supabase-admin";
import { bumpSavedVersion } from "@/lib/redis";

// PATCH /api/saved/[id] — { action: "trash" | "restore" | "pin" | "unpin" }
// Trash and restore are soft-delete only. The row and its file stay put;
// deleted_at just hides it from the normal list and shows it in Trash
// instead, so an accidental Remove doesn't permanently destroy something
// you saved on purpose.
//
// Pin and unpin set or clear pinned_at. Pinned items are always loaded at
// the top of the list, however old they are. Trashing a pinned item keeps
// its pin, so Restore puts it back where it was.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase isn't configured yet." },
      { status: 503 }
    );
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "trash" && action !== "restore" && action !== "pin" && action !== "unpin") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const isPinAction = action === "pin" || action === "unpin";
  const patch: Record<string, string | null> = isPinAction
    ? { pinned_at: action === "pin" ? new Date().toISOString() : null }
    : { deleted_at: action === "trash" ? new Date().toISOString() : null };

  let query = supabaseAdmin.from(TABLE).update(patch).eq("id", params.id);
  // A trashed item can't be pinned; restore it first.
  if (isPinAction) query = query.is("deleted_at", null);

  const { data, error } = await query.select().maybeSingle();

  if (error) {
    const message = isPinAction && isMissingPinColumn(error) ? PIN_MIGRATION_MESSAGE : error.message;
    return NextResponse.json({ error: message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "That item isn't in Dock any more." }, { status: 404 });
  }

  await bumpSavedVersion();
  return NextResponse.json({ item: toSavedRecord(data) });
}

// DELETE /api/saved/[id] — permanent. Removes the storage object (if
// any) and the row itself. Only reachable from the Trash view in the
// UI, never from the main list's Remove button.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: true });
  }

  const { data: row } = await supabaseAdmin
    .from(TABLE)
    .select("storage_path")
    .eq("id", params.id)
    .single();

  if (row?.storage_path) {
    await supabaseAdmin.storage.from(BUCKET).remove([row.storage_path]);
  }

  const { error } = await supabaseAdmin.from(TABLE).delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await bumpSavedVersion();
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, BUCKET, TABLE, signedUrlFor } from "@/lib/supabase-admin";
import { SavedRecord } from "@/lib/types";

// PATCH /api/saved/[id] — { action: "trash" | "restore" }
// Soft-delete only. The row and its file stay put; deleted_at just
// hides it from the normal list and shows it in Trash instead, so an
// accidental Remove doesn't permanently destroy something you saved on
// purpose.
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

  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "trash" && action !== "restore") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const deleted_at = action === "trash" ? new Date().toISOString() : null;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ deleted_at })
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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

  return NextResponse.json({ ok: true });
}

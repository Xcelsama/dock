import { createClient } from "@supabase/supabase-js";
import { SavedRecord } from "@/lib/types";

// Deliberately NOT prefixed with NEXT_PUBLIC_: this client only ever runs
// on the server (inside route handlers), using the service role key,
// which bypasses Row Level Security entirely. Nothing here is safe to
// send to the browser.
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdminConfigured = Boolean(url && serviceKey);

export const supabaseAdmin = supabaseAdminConfigured
  ? createClient(url as string, serviceKey as string, {
      auth: { persistSession: false },
    })
  : null;

export const BUCKET = "dock-files";
export const TABLE = "dock_items";

// Signed URLs are minted on demand by /api/saved/[id]/file, only when the
// browser actually asks for the file.
export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function toSavedRecord(row: any): SavedRecord {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    size: row.size,
    mime: row.mime,
    createdAt: row.created_at,
    textContent: row.text_content,
    // Stable, same-origin path: the <img> src doesn't change between polls,
    // so the browser can cache it. The route behind it mints the signed URL.
    remoteUrl: row.storage_path ? `/api/saved/${row.id}/file` : null,
    deletedAt: row.deleted_at,
    pinnedAt: row.pinned_at ?? null,
  };
}

// Postgres "undefined column" (42703), or PostgREST's schema-cache version of
// it (PGRST204). Both mean the one-time pin migration hasn't been run yet.
export function isMissingPinColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    (typeof error.message === "string" && error.message.includes("pinned_at"))
  );
}

export const PIN_MIGRATION_MESSAGE =
  "Pinning needs a one-time database update. Run supabase/pin-migration.sql in the Supabase SQL editor (see the README).";

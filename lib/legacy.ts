import { createClient } from "@supabase/supabase-js";
import { BUCKET, TABLE, SIGNED_URL_TTL_SECONDS, UUID_RE, toSavedRecord } from "@/lib/supabase-admin";
import type { SavedRecord } from "@/lib/types";

// Read-only access to the OLD Supabase project, so files saved there before the
// move to R2 stay reachable. Nothing here is used on the normal Dock screen:
// it only runs for the Old files tab (/legacy) and as a fallback when a file id
// isn't found in the new storage. Any failure (for example the project is still
// restricted) is reported to that tab and goes no further.

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const legacyConfigured = Boolean(url && key);

const client = legacyConfigured
  ? createClient(url as string, key as string, { auth: { persistSession: false } })
  : null;

export const LEGACY_UNAVAILABLE =
  "The old Supabase storage isn't reachable right now (it may still be restricted). Try again after it's restored.";

export async function listLegacy(opts: {
  before?: string | null;
  limit: number;
}): Promise<{ items: SavedRecord[]; hasMore: boolean }> {
  if (!client) throw new Error("Old Supabase storage isn't configured.");

  let query = client
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts.limit + 1);
  if (opts.before) query = query.lt("created_at", opts.before);

  const { data, error } = await query;
  if (error) throw new Error(error.message || LEGACY_UNAVAILABLE);

  const rows = data ?? [];
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  return { items: page.map(toSavedRecord), hasMore };
}

/** Signed URL for an old file, or null when the id/file isn't in the old project. */
export async function legacySignedUrl(id: string, download: boolean): Promise<string | null> {
  if (!client || !UUID_RE.test(id)) return null;

  const { data: row, error } = await client
    .from(TABLE)
    .select("storage_path, name")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message || LEGACY_UNAVAILABLE);
  if (!row?.storage_path) return null;

  const { data, error: signError } = await client.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, download ? { download: row.name } : undefined);
  if (signError || !data) throw new Error(signError?.message || LEGACY_UNAVAILABLE);
  return data.signedUrl;
}

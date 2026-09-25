import { createClient } from "@supabase/supabase-js";

// Deliberately NOT prefixed with NEXT_PUBLIC_: this client only ever runs
// on the server (inside route handlers), using the service role key,
// which bypasses Row Level Security entirely. Nothing here is safe to
// send to the browser — that was the bug in the previous version, where
// NEXT_PUBLIC_SUPABASE_ANON_KEY shipped inside the client JS bundle and,
// combined with open RLS policies, let anyone who pulled that bundle talk
// to Supabase directly, skipping the site's password gate altogether.
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

// How long a signed URL for a saved file stays valid. Short-lived on
// purpose — these are minted fresh on every list/save request, never
// stored, so there's no reason for them to outlive the page load that
// asked for them by much.
export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export async function signedUrlFor(storagePath: string | null): Promise<string | null> {
  if (!storagePath || !supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  return data.signedUrl;
}

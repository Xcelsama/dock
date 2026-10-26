import { supabaseAdmin, TABLE, toSavedRecord, isMissingPinColumn } from "@/lib/supabase-admin";
import type { SavedWindow } from "@/lib/types";

// The first screen never needs more than this many recent items. Anything
// beyond it is paged in on request.
export const WINDOW_LIMIT = 100;
// Pins are meant to be a short list; this just keeps a runaway one bounded.
export const MAX_PINNED = 100;

export type WindowResult = { ok: true; window: SavedWindow } | { ok: false; error: string };

/**
 * The saved list for the home screen, in one go: everything created on or
 * after `since` (the device's "start of yesterday"), plus every pinned item
 * whatever its age. The three queries run side by side, so this costs one
 * database round trip rather than three.
 */
export async function listSavedWindow(since: string): Promise<WindowResult> {
  if (!supabaseAdmin) {
    return {
      ok: true,
      window: { configured: false, since, items: [], pinned: [], pinsReady: false, hasMore: false, nextBefore: null },
    };
  }

  const recentQuery = supabaseAdmin
    .from(TABLE)
    .select("*")
    .is("deleted_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(WINDOW_LIMIT + 1); // one extra tells us the window was cut short

  const olderQuery = supabaseAdmin
    .from(TABLE)
    .select("id")
    .is("deleted_at", null)
    .lt("created_at", since)
    .limit(1);

  const pinnedQuery = supabaseAdmin
    .from(TABLE)
    .select("*")
    .is("deleted_at", null)
    .not("pinned_at", "is", null)
    .order("pinned_at", { ascending: false })
    .limit(MAX_PINNED);

  const [recent, older, pinned] = await Promise.all([recentQuery, olderQuery, pinnedQuery]);

  if (recent.error) return { ok: false, error: recent.error.message };

  const rows = recent.data ?? [];
  const truncated = rows.length > WINDOW_LIMIT;
  const page = truncated ? rows.slice(0, WINDOW_LIMIT) : rows;
  const hasOlder = (older.data?.length ?? 0) > 0;

  // A pinned query that fails (most often: the database hasn't had the pin
  // migration yet) must not take the whole list down. `pinsReady: false`
  // tells the app to leave its pin state alone.
  const pinsReady = !pinned.error;
  if (pinned.error && !isMissingPinColumn(pinned.error)) {
    console.error("pinned query failed:", pinned.error.message);
  }

  return {
    ok: true,
    window: {
      configured: true,
      since,
      items: page.map(toSavedRecord),
      pinned: pinsReady ? (pinned.data ?? []).map(toSavedRecord) : [],
      pinsReady,
      hasMore: truncated || hasOlder,
      // Cut short: carry on from the oldest row we returned. Otherwise the
      // next page starts right where the window ends.
      nextBefore: truncated ? page[page.length - 1].created_at : since,
    },
  };
}

/** Parses the `since` query value. Returns the canonical ISO string, or null. */
export function parseSince(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

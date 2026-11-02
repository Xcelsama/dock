import { savedConfigured, listRecentAndPins, toSavedRecord } from "@/lib/saved-store";
import type { SavedWindow } from "@/lib/types";

export const WINDOW_LIMIT = 100;
export const MAX_PINNED = 100;

export type WindowResult = { ok: true; window: SavedWindow } | { ok: false; error: string };

/**
 * The saved list for the home screen: everything created on or after `since`,
 * plus every pinned item whatever its age.
 */
export async function listSavedWindow(since: string): Promise<WindowResult> {
  if (!savedConfigured) {
    return {
      ok: true,
      window: { configured: false, since, items: [], pinned: [], pinsReady: false, hasMore: false, nextBefore: null },
    };
  }

  try {
    const { recent, pinned, truncated, hasOlder } = await listRecentAndPins(
      Date.parse(since),
      WINDOW_LIMIT,
      MAX_PINNED
    );
    return {
      ok: true,
      window: {
        configured: true,
        since,
        items: recent.map(toSavedRecord),
        pinned: pinned.map(toSavedRecord),
        pinsReady: true,
        hasMore: truncated || hasOlder,
        nextBefore: truncated ? recent[recent.length - 1].createdAt : since,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't load saved items." };
  }
}

/** Parses the `since` query value. Returns the canonical ISO string, or null. */
export function parseSince(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

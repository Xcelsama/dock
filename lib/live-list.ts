import { redis, INDEX_KEY, ITEM_PREFIX, SAVED_VERSION_KEY } from "@/lib/redis";
import type { LiveListing, RelayRecord } from "@/lib/types";

// What sits under dock:item:<id>. New items keep only metadata here; items
// shared before the bytes were split out still carry `content` inline, so
// both shapes have to be readable until those expire (7 days at most).
export type StoredItem = Omit<RelayRecord, "hasContent"> & {
  hasContent?: boolean;
  content?: string | null;
};

// One call never describes more than this many live items.
const MAX_LISTED = 200;
// Ids per MGET. Metadata is tiny so one call usually covers everything.
const MGET_CHUNK = 50;

function toRecord(stored: StoredItem): RelayRecord {
  const { content, hasContent, ...rest } = stored;
  return { ...rest, hasContent: hasContent ?? Boolean(content) };
}

// Fetches metadata for the given ids, newest-first order preserved. A chunk
// that fails (almost always old-format items still carrying megabytes of
// file bytes inline) is retried one id at a time so a single heavy item can't
// take the whole list down with it.
async function fetchMetadata(ids: string[]): Promise<(StoredItem | null)[]> {
  if (!redis) return [];
  const out: (StoredItem | null)[] = [];
  for (let i = 0; i < ids.length; i += MGET_CHUNK) {
    const chunk = ids.slice(i, i + MGET_CHUNK);
    try {
      const rows = await redis.mget<(StoredItem | null)[]>(...chunk.map((id) => `${ITEM_PREFIX}${id}`));
      out.push(...rows);
    } catch {
      for (const id of chunk) {
        out.push(await redis.get<StoredItem | null>(`${ITEM_PREFIX}${id}`).catch(() => null));
      }
    }
  }
  return out;
}

/**
 * Lists what's live in the relay, metadata only.
 *
 * - `since` (ms epoch): only items created at or after it. Leave it out to
 *   list everything, which is what "Show older items" does.
 * - `known`: ids the caller already holds, so their bodies aren't repeated.
 */
export async function listLive(opts: { since?: number | null; known?: Set<string> } = {}): Promise<LiveListing> {
  if (!redis) return { configured: false, items: [], savedVersion: null, hasOlder: false };

  const since = typeof opts.since === "number" && Number.isFinite(opts.since) ? opts.since : null;

  // One round trip for the id list, the saved-version counter and (when
  // windowed) whether anything older is waiting behind the window.
  const pipe = redis.pipeline();
  pipe.zrange(INDEX_KEY, since ?? "-inf", "+inf", { byScore: true });
  pipe.get(SAVED_VERSION_KEY);
  if (since !== null) pipe.zcount(INDEX_KEY, "-inf", `(${since}`);
  const results = await pipe.exec<[string[], number | null, number?]>();

  const ascending = results[0] ?? [];
  const savedVersion = Number(results[1] ?? 0);
  let hasOlder = since !== null && Number(results[2] ?? 0) > 0;

  // Newest first, capped.
  const ids = ascending.slice().reverse().slice(0, MAX_LISTED);
  const known = opts.known ?? new Set<string>();
  const missing = ids.filter((id) => !known.has(id));

  const stored = missing.length ? await fetchMetadata(missing) : [];
  const items: RelayRecord[] = [];
  const stale: string[] = [];

  missing.forEach((id, i) => {
    const value = stored[i];
    if (!value) stale.push(id);
    else items.push(toRecord(value));
  });

  // Items Redis already expired just leave their id behind in the index.
  // Awaited so the cleanup isn't lost when the function is frozen.
  if (stale.length) {
    await redis.zrem(INDEX_KEY, ...stale).catch(() => {});
    // An id that only ever pointed at expired items doesn't count as "older".
    if (since === null) hasOlder = false;
  }

  return { configured: true, items, savedVersion, hasOlder };
}

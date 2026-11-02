import { redis } from "@/lib/redis";
import { r2Configured } from "@/lib/r2";
import type { SavedRecord } from "@/lib/types";

// Saved items: metadata + text live in Redis (Upstash), files live in R2.
// Redis layout:
//   dock:saved:item:<id>   JSON record
//   dock:saved:idx         zset of active ids,        score = created ms
//   dock:saved:pins        zset of pinned active ids, score = pinned ms
//   dock:saved:trash       zset of trashed ids,       score = created ms

export const savedConfigured = Boolean(redis) && r2Configured;

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ITEM = "dock:saved:item:";
const IDX = "dock:saved:idx";
const PINS = "dock:saved:pins";
const TRASH = "dock:saved:trash";

export interface SavedRow {
  id: string;
  kind: SavedRecord["kind"];
  name: string;
  size: number;
  mime: string | null;
  storagePath: string | null;
  textContent: string | null;
  createdAt: string;
  deletedAt: string | null;
  pinnedAt: string | null;
}

export function toSavedRecord(row: SavedRow): SavedRecord {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    size: row.size,
    mime: row.mime,
    createdAt: row.createdAt,
    textContent: row.textContent,
    remoteUrl: row.storagePath ? `/api/saved/${row.id}/file` : null,
    deletedAt: row.deletedAt,
    pinnedAt: row.pinnedAt,
  };
}

function r() {
  if (!redis) throw new Error("Redis isn't configured.");
  return redis;
}

export async function getSaved(id: string): Promise<SavedRow | null> {
  const row = await r().get<SavedRow>(`${ITEM}${id}`);
  return row ?? null;
}

async function getMany(ids: string[]): Promise<SavedRow[]> {
  if (!ids.length) return [];
  const rows = await r().mget<(SavedRow | null)[]>(...ids.map((id) => `${ITEM}${id}`));
  return rows.filter((x): x is SavedRow => Boolean(x));
}

export async function createSaved(row: SavedRow): Promise<void> {
  const p = r().pipeline();
  p.set(`${ITEM}${row.id}`, row);
  p.zadd(IDX, { score: Date.parse(row.createdAt), member: row.id });
  if (row.pinnedAt) p.zadd(PINS, { score: Date.parse(row.pinnedAt), member: row.id });
  await p.exec();
}

export async function setPinned(row: SavedRow, pinned: boolean): Promise<SavedRow> {
  const next: SavedRow = { ...row, pinnedAt: pinned ? new Date().toISOString() : null };
  const p = r().pipeline();
  p.set(`${ITEM}${row.id}`, next);
  if (pinned) p.zadd(PINS, { score: Date.parse(next.pinnedAt as string), member: row.id });
  else p.zrem(PINS, row.id);
  await p.exec();
  return next;
}

export async function setTrashed(row: SavedRow, trashed: boolean): Promise<SavedRow> {
  const next: SavedRow = { ...row, deletedAt: trashed ? new Date().toISOString() : null };
  const created = Date.parse(row.createdAt);
  const p = r().pipeline();
  p.set(`${ITEM}${row.id}`, next);
  if (trashed) {
    p.zrem(IDX, row.id);
    p.zrem(PINS, row.id); // pinnedAt stays on the record, so Restore re-pins it
    p.zadd(TRASH, { score: created, member: row.id });
  } else {
    p.zrem(TRASH, row.id);
    p.zadd(IDX, { score: created, member: row.id });
    if (row.pinnedAt) p.zadd(PINS, { score: Date.parse(row.pinnedAt), member: row.id });
  }
  await p.exec();
  return next;
}

export async function deleteSaved(id: string): Promise<void> {
  const p = r().pipeline();
  p.del(`${ITEM}${id}`);
  p.zrem(IDX, id);
  p.zrem(PINS, id);
  p.zrem(TRASH, id);
  await p.exec();
}

/** Newest first. `before` is an exclusive created-at cursor. */
export async function listPage(opts: {
  trash: boolean;
  before?: string | null;
  limit: number;
}): Promise<{ items: SavedRow[]; hasMore: boolean }> {
  const key = opts.trash ? TRASH : IDX;
  // Upstash only takes a score bound shaped like "(123" (exclusive) or "+inf",
  // not just any string, so we tell TypeScript exactly which shapes `max` can be.
  const max: `(${number}` | "+inf" = opts.before ? `(${Date.parse(opts.before)}` : "+inf";
  const ids = await r().zrange<string[]>(key, max, "-inf", {
    byScore: true,
    rev: true,
    offset: 0,
    count: opts.limit + 1,
  });
  const hasMore = ids.length > opts.limit;
  const items = await getMany(hasMore ? ids.slice(0, opts.limit) : ids);
  return { items, hasMore };
}

/** Recent window + all pins, fetched together. */
export async function listRecentAndPins(sinceMs: number, windowLimit: number, maxPins: number) {
  const [recentIds, olderIds, pinIds] = await Promise.all([
    r().zrange<string[]>(IDX, "+inf", sinceMs, {
      byScore: true,
      rev: true,
      offset: 0,
      count: windowLimit + 1,
    }),
    r().zrange<string[]>(IDX, `(${sinceMs}`, "-inf", {
      byScore: true,
      rev: true,
      offset: 0,
      count: 1,
    }),
    r().zrange<string[]>(PINS, 0, maxPins - 1, { rev: true }),
  ]);

  const truncated = recentIds.length > windowLimit;
  const keepRecent = truncated ? recentIds.slice(0, windowLimit) : recentIds;
  const all = Array.from(new Set([...keepRecent, ...pinIds]));
  const rows = await getMany(all);
  const byId = new Map(rows.map((x) => [x.id, x]));

  return {
    recent: keepRecent.map((id) => byId.get(id)).filter((x): x is SavedRow => Boolean(x)),
    pinned: pinIds.map((id) => byId.get(id)).filter((x): x is SavedRow => Boolean(x)),
    truncated,
    hasOlder: olderIds.length > 0,
  };
}

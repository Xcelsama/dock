import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

export const redisConfigured = Boolean(url && token);

export const redis = redisConfigured
  ? new Redis({ url: url as string, token: token as string })
  : null;

export const INDEX_KEY = "dock:index";
export const ITEM_PREFIX = "dock:item:";

// Bumped whenever anything in Supabase changes (save / trash / restore /
// delete). Devices see it in their regular poll and only re-fetch the saved
// list when it moved, instead of hitting Supabase every few seconds.
export const SAVED_VERSION_KEY = "dock:saved-version";

export function bumpSavedVersion() {
  if (redis) redis.incr(SAVED_VERSION_KEY).catch(() => {});
}

// How long an unsaved item stays visible to other devices before it
// quietly expires, when no per-item TTL is chosen. Adjust with
// DOCK_TTL_SECONDS if you want the default shorter or longer.
export const TTL_SECONDS = Number(process.env.DOCK_TTL_SECONDS ?? 86400);

// Per-item TTL is user-choosable in the UI (1h / 24h / 7d), but the API
// clamps whatever it's given to this range so a bad request can't pin
// something in Redis forever or expire it before it can even sync.
export const MIN_TTL_SECONDS = 5 * 60; // 5 minutes
export const MAX_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export function clampTtl(seconds: unknown): number {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.floor(n)));
}

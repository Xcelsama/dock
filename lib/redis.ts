import { Redis } from "@upstash/redis";
import { MAX_BROADCAST_BYTES } from "@/lib/relay-limits";

export { MAX_BROADCAST_BYTES };

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

export const redisConfigured = Boolean(url && token);

export const redis = redisConfigured
  ? new Redis({ url: url as string, token: token as string })
  : null;

export const INDEX_KEY = "dock:index";
export const ITEM_PREFIX = "dock:item:";

// How long an unsaved item stays visible to other devices before it
// quietly expires. Adjust with DOCK_TTL_SECONDS if you want it shorter
// or longer.
export const TTL_SECONDS = Number(process.env.DOCK_TTL_SECONDS ?? 86400);

import { createClient, type RedisClientType } from "redis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redis: RedisClientType = createClient({ url: redisUrl });

redis.on("error", (error) => {
	console.error("Redis client error:", error);
});

let connectionPromise: Promise<RedisClientType> | undefined;

export async function getRedis(): Promise<RedisClientType> {
	if (redis.isOpen) {
		return redis;
	}

	connectionPromise ??= redis.connect().then(() => redis);
	return connectionPromise;
}

export async function closeRedis(): Promise<void> {
	connectionPromise = undefined;

	if (redis.isOpen) {
		await redis.quit();
	}
}

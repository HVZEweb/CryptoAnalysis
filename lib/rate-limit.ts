interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

let redisClient: import("redis").RedisClientType | null = null;
let redisReady = false;

async function getRedis() {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { createClient } = await import("redis");
    redisClient = createClient({ url });
    redisClient.on("error", () => undefined);
    await redisClient.connect();
    redisReady = true;
    return redisClient;
  } catch {
    redisReady = false;
    return null;
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const redis = redisReady || process.env.REDIS_URL ? await getRedis() : null;

  if (redis) {
    const rKey = `rl:${key}`;
    const count = await redis.incr(rKey);
    if (count === 1) await redis.pExpire(rKey, windowMs);
    if (count > limit) {
      const ttl = await redis.pTTL(rKey);
      return { allowed: false, retryAfterSec: Math.ceil(Math.max(ttl, 1000) / 1000) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || now > entry.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (entry.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  entry.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

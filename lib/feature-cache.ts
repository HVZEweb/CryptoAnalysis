/**
 * Redis-backed cache for ML features and market regime (graceful file fallback).
 */

import { getCached, setCached } from "@/lib/cache";
import type { MlFeatureVector } from "@/services/ml-features";
import type { MarketRegime } from "@/types";

const TTL_MS = 5 * 60_000;

let redisClient: import("redis").RedisClientType | null = null;

async function getRedis() {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { createClient } = await import("redis");
    redisClient = createClient({ url });
    redisClient.on("error", () => undefined);
    await redisClient.connect();
    return redisClient;
  } catch {
    return null;
  }
}

async function redisGet<T>(key: string): Promise<T | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function redisSet<T>(key: string, data: T, ttlMs: number): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(data), { PX: ttlMs });
  } catch {
    // ignore
  }
}

export async function getCachedMlFeatures(key: string): Promise<MlFeatureVector | null> {
  const rk = `mlfeat:${key}`;
  const fromRedis = await redisGet<MlFeatureVector>(rk);
  if (fromRedis) return fromRedis;
  return getCached<MlFeatureVector>(rk);
}

export async function setCachedMlFeatures(key: string, features: MlFeatureVector): Promise<void> {
  const rk = `mlfeat:${key}`;
  await Promise.all([redisSet(rk, features, TTL_MS), setCached(rk, features, TTL_MS)]);
}

export async function getCachedRegime(key: string): Promise<MarketRegime | null> {
  const rk = `regime:${key}`;
  const fromRedis = await redisGet<MarketRegime>(rk);
  if (fromRedis) return fromRedis;
  return getCached<MarketRegime>(rk);
}

export async function setCachedRegime(key: string, regime: MarketRegime): Promise<void> {
  const rk = `regime:${key}`;
  await Promise.all([redisSet(rk, regime, TTL_MS), setCached(rk, regime, TTL_MS)]);
}

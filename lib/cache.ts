import fs from "fs/promises";
import path from "path";

const CACHE_DIR = path.join(process.cwd(), ".cache");

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    const raw = await fs.readFile(filePath, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() > entry.expiresAt) {
      await fs.unlink(filePath).catch(() => undefined);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCached<T>(key: string, data: T, ttlMs: number): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttlMs };
  await fs.writeFile(
    path.join(CACHE_DIR, `${key}.json`),
    JSON.stringify(entry),
    "utf-8"
  );
}

import fs from "fs/promises";
import path from "path";

const CACHE_DIR = path.join(process.cwd(), ".cache", "news-impact");
const COOLDOWN_PATH = path.join(CACHE_DIR, "coin-cooldown.json");
const FINGERPRINT_PATH = path.join(CACHE_DIR, "fingerprints.json");
const TITLE_CACHE_PATH = path.join(CACHE_DIR, "recent-titles.json");

export const COIN_COOLDOWN_MS = 10 * 60_000;

interface CoinCooldownEntry {
  coin: string;
  at: string;
  newsId: string;
}

interface FingerprintEntry {
  fingerprint: string;
  at: string;
  title: string;
}

interface TitleCacheEntry {
  title: string;
  at: string;
}

export class DedupCooldownStore {
  private coinCooldown = new Map<string, number>();
  private fingerprints = new Map<string, FingerprintEntry>();
  private recentTitles: TitleCacheEntry[] = [];
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    await fs.mkdir(CACHE_DIR, { recursive: true });

    try {
      const cooldownRaw = await fs.readFile(COOLDOWN_PATH, "utf-8");
      const entries = JSON.parse(cooldownRaw) as CoinCooldownEntry[];
      for (const e of entries) this.coinCooldown.set(e.coin, new Date(e.at).getTime());
    } catch {
      // fresh
    }

    try {
      const fpRaw = await fs.readFile(FINGERPRINT_PATH, "utf-8");
      const fps = JSON.parse(fpRaw) as FingerprintEntry[];
      for (const f of fps) this.fingerprints.set(f.fingerprint, f);
    } catch {
      // fresh
    }

    try {
      const titlesRaw = await fs.readFile(TITLE_CACHE_PATH, "utf-8");
      this.recentTitles = JSON.parse(titlesRaw) as TitleCacheEntry[];
    } catch {
      this.recentTitles = [];
    }

    this.loaded = true;
  }

  async persist(): Promise<void> {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const cooldownEntries: CoinCooldownEntry[] = [...this.coinCooldown.entries()].map(([coin, ts]) => ({
      coin,
      at: new Date(ts).toISOString(),
      newsId: "",
    }));
    await fs.writeFile(COOLDOWN_PATH, JSON.stringify(cooldownEntries), "utf-8");

    const fps = [...this.fingerprints.values()].slice(-500);
    await fs.writeFile(FINGERPRINT_PATH, JSON.stringify(fps), "utf-8");

    await fs.writeFile(TITLE_CACHE_PATH, JSON.stringify(this.recentTitles.slice(-200)), "utf-8");
  }

  isFingerprintSeen(fingerprint: string): boolean {
    return this.fingerprints.has(fingerprint);
  }

  markFingerprint(fingerprint: string, title: string): void {
    this.fingerprints.set(fingerprint, { fingerprint, at: new Date().toISOString(), title });
  }

  isCoinOnCooldown(coin: string, now = Date.now()): boolean {
    const last = this.coinCooldown.get(coin.toUpperCase());
    return last != null && now - last < COIN_COOLDOWN_MS;
  }

  markCoinImpact(coin: string, now = Date.now()): void {
    this.coinCooldown.set(coin.toUpperCase(), now);
  }

  hasSimilarRecentTitle(title: string, isSimilar: (a: string, b: string) => boolean): boolean {
    const cutoff = Date.now() - COIN_COOLDOWN_MS;
    return this.recentTitles.some(
      (t) => new Date(t.at).getTime() > cutoff && isSimilar(t.title, title)
    );
  }

  addRecentTitle(title: string): void {
    this.recentTitles.push({ title, at: new Date().toISOString() });
    if (this.recentTitles.length > 200) {
      this.recentTitles = this.recentTitles.slice(-200);
    }
  }
}

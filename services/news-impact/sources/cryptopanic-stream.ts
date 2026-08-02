import axios from "axios";
import { createHash } from "crypto";
import type { RawNewsSignal } from "@/services/news-impact/types";
import { IMPACT_KEYWORDS } from "@/services/news-impact/news-fetcher-keywords";

const POLL_MS = parseInt(process.env.CRYPTOPANIC_POLL_MS ?? "", 10) || 25_000;

let cache: RawNewsSignal[] = [];
let lastPollAt = 0;
let polling = false;

function hashId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function keywordHits(text: string): string[] {
  const lower = text.toLowerCase();
  return IMPACT_KEYWORDS.filter((k) => lower.includes(k.trim()));
}

function significanceFromHits(hits: string[], title: string, boost = 0): number {
  let score = hits.length * 12 + boost;
  const lower = title.toLowerCase();
  if (/\b(breaking|urgent|just in|announces|approved)\b/.test(lower)) score += 15;
  if (/\b(hack|exploit|drained|etf approved|binance lists)\b/.test(lower)) score += 25;
  return Math.min(100, score);
}

async function pollOnce(): Promise<RawNewsSignal[]> {
  const token = process.env.CRYPTOPANIC_API_KEY?.trim();
  if (!token) return [];

  const plan = process.env.CRYPTOPANIC_API_PLAN?.trim() || "developer";
  const baseUrl = `https://cryptopanic.com/api/${plan}/v2/posts/`;

  const { data } = await axios.get<{
    results?: Array<{
      id?: number;
      title: string;
      url: string;
      published_at: string;
      source?: { title?: string };
      currencies?: Array<{ code: string }>;
      votes?: { important?: number; liked?: number };
    }>;
  }>(baseUrl, {
    params: {
      auth_token: token,
      public: true,
      kind: "news",
      filter: "rising",
      regions: "en",
    },
    timeout: 8_000,
  });

  const out: RawNewsSignal[] = [];
  for (const post of data.results ?? []) {
    const hits = keywordHits(post.title);
    if (hits.length === 0) continue;

    const hintCoins = (post.currencies ?? []).map((c) => c.code.toUpperCase()).slice(0, 3);
    const voteBoost = (post.votes?.important ?? 0) > 2 ? 8 : 0;

    out.push({
      id: hashId(["cryptopanic", String(post.id ?? post.title), post.url]),
      title: post.title,
      url: post.url,
      source: post.source?.title ?? "CryptoPanic",
      sourceType: "cryptopanic",
      publishedAt: post.published_at,
      keywordHits: hits,
      significanceScore: significanceFromHits(hits, post.title, 12 + voteBoost),
      sourcePriority: 88,
      hintCoins,
    });
  }

  return out;
}

/** Incremental CryptoPanic poller — acts as lightweight stream between ticks */
export async function fetchCryptopanicStream(): Promise<RawNewsSignal[]> {
  const token = process.env.CRYPTOPANIC_API_KEY?.trim();
  if (!token) return cache;

  const now = Date.now();
  if (now - lastPollAt < POLL_MS) return cache;

  if (polling) return cache;
  polling = true;

  try {
    const fresh = await pollOnce();
    lastPollAt = now;

    const byId = new Map<string, RawNewsSignal>();
    for (const s of [...fresh, ...cache]) byId.set(s.id, s);
    cache = [...byId.values()]
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, 40);

    return cache;
  } catch {
    return cache;
  } finally {
    polling = false;
  }
}

export function resetCryptopanicStreamForTests(): void {
  cache = [];
  lastPollAt = 0;
  polling = false;
}

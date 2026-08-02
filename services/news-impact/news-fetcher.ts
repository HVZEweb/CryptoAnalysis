import axios from "axios";
import { createHash } from "crypto";
import type { NewsImpactSource, RawNewsSignal } from "@/services/news-impact/types";
import { IMPACT_KEYWORDS } from "@/services/news-impact/news-fetcher-keywords";
import { fetchCryptopanicStream } from "@/services/news-impact/sources/cryptopanic-stream";
import { fetchTelegramChannels } from "@/services/news-impact/sources/telegram";
import { fetchTwitterSignalsFast } from "@/services/news-impact/sources/twitter";

export { IMPACT_KEYWORDS } from "@/services/news-impact/news-fetcher-keywords";

const RSS_SOURCES: Array<{ url: string; label: string }> = [
  { url: "https://cointelegraph.com/rss", label: "CoinTelegraph" },
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", label: "CoinDesk" },
  { url: "https://www.theblock.co/rss.xml", label: "The Block" },
  { url: "https://cryptoslate.com/feed/", label: "CryptoSlate" },
  { url: "https://decrypt.co/feed", label: "Decrypt" },
  { url: "https://bitcoinmagazine.com/.rss/full/", label: "Bitcoin Magazine" },
];

const GOOGLE_NEWS_QUERIES = [
  {
    q: '(binance OR coinbase OR okx) (listing OR lists OR "will list") when:1h',
    label: "Listings",
  },
  {
    q: '(hack OR exploit OR drained OR "rug pull" OR depeg) crypto when:1h',
    label: "Security",
  },
  {
    q: '(SEC OR CFTC) (crypto OR bitcoin OR ethereum OR ripple OR ETF) when:1h',
    label: "Regulation",
  },
  {
    q: '("ETF approved" OR "ETF approval" OR "rate cut" OR "rate hike") crypto when:1h',
    label: "Macro",
  },
];

const SOURCE_PRIORITY: Record<NewsImpactSource, number> = {
  twitter: 100,
  telegram: 95,
  cryptopanic: 88,
  rss: 55,
  "google-news": 35,
};

function hashId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function stripHtml(text: string): string {
  return text.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
}

function keywordHits(text: string): string[] {
  const lower = text.toLowerCase();
  return IMPACT_KEYWORDS.filter((k) => lower.includes(k.trim()));
}

function significanceFromHits(hits: string[], title: string, sourceBoost = 0): number {
  let score = hits.length * 12 + sourceBoost;
  const lower = title.toLowerCase();
  if (/\b(breaking|urgent|just in|announces|approved)\b/.test(lower)) score += 15;
  if (/\b(hack|exploit|drained|etf approved|binance lists)\b/.test(lower)) score += 25;
  return Math.min(100, score);
}

function buildRawSignal(
  partial: Omit<RawNewsSignal, "significanceScore"> & { significanceBoost?: number }
): RawNewsSignal {
  const priority = partial.sourcePriority ?? SOURCE_PRIORITY[partial.sourceType];
  const boost = partial.significanceBoost ?? 0;
  return {
    ...partial,
    sourcePriority: priority,
    significanceScore: Math.max(
      0,
      significanceFromHits(partial.keywordHits, partial.title, boost) +
        (partial.sourceType === "google-news" ? -12 : 0)
    ),
  };
}

function parseRssBlock(
  xml: string,
  sourceLabel: string,
  sourceType: NewsImpactSource
): RawNewsSignal[] {
  const items: RawNewsSignal[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const titleRegex = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
  const linkRegex = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i;
  const descRegex = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i;
  const dateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/i;

  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 30) {
    const block = match[1];
    const titleMatch = block.match(titleRegex);
    if (!titleMatch) continue;

    const title = stripHtml(titleMatch[1]);
    const summary = stripHtml(descRegex.exec(block)?.[1] ?? "").slice(0, 400);
    const hits = keywordHits(`${title} ${summary}`);
    if (hits.length === 0) continue;

    const link = stripHtml(linkRegex.exec(block)?.[1] ?? "");
    const publishedAt = dateMatchToIso(dateRegex.exec(block)?.[1]);

    items.push(
      buildRawSignal({
        id: hashId([sourceLabel, title, link]),
        title,
        summary: summary || undefined,
        url: link || undefined,
        source: sourceLabel,
        sourceType,
        publishedAt,
        keywordHits: hits,
      })
    );
  }

  return items;
}

function dateMatchToIso(raw?: string): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(stripHtml(raw));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function fetchRssSource(url: string, label: string): Promise<RawNewsSignal[]> {
  const { data } = await axios.get<string>(url, { timeout: 9_000, responseType: "text" });
  return parseRssBlock(data, label, "rss");
}

async function fetchGoogleNewsQuery(query: string, label: string): Promise<RawNewsSignal[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
  const { data } = await axios.get<string>(url, { timeout: 9_000, responseType: "text" });
  return parseRssBlock(data, `Google News · ${label}`, "google-news");
}

async function fetchAllGoogleNews(): Promise<RawNewsSignal[]> {
  const settled = await Promise.allSettled(
    GOOGLE_NEWS_QUERIES.map((q) => fetchGoogleNewsQuery(q.q, q.label))
  );
  const out: RawNewsSignal[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") out.push(...r.value);
  }
  return out;
}

function dedupeSignals(signals: RawNewsSignal[]): RawNewsSignal[] {
  const byKey = new Map<string, RawNewsSignal>();

  for (const s of signals) {
    const existing = byKey.get(s.id);
    if (!existing) {
      byKey.set(s.id, s);
      continue;
    }
    const better =
      (s.sourcePriority ?? 0) > (existing.sourcePriority ?? 0) ||
      ((s.sourcePriority ?? 0) === (existing.sourcePriority ?? 0) &&
        s.significanceScore > existing.significanceScore);
    if (better) byKey.set(s.id, s);
  }

  return [...byKey.values()].sort((a, b) => {
    const prio = (b.sourcePriority ?? 0) - (a.sourcePriority ?? 0);
    if (prio !== 0) return prio;
    const score = b.significanceScore - a.significanceScore;
    if (score !== 0) return score;
    return b.publishedAt.localeCompare(a.publishedAt);
  });
}

/** Tiered fetch: fast sources first, then RSS + Google News */
export async function fetchImpactNews(): Promise<RawNewsSignal[]> {
  const hasTwitter =
    !!(process.env.TWITTER_BEARER_TOKEN?.trim() || process.env.X_API_BEARER_TOKEN?.trim()) &&
    process.env.NEWS_IMPACT_TWITTER !== "false";

  const fastSettled = await Promise.allSettled([
    hasTwitter ? fetchTwitterSignalsFast() : Promise.resolve([]),
    fetchTelegramChannels(),
    fetchCryptopanicStream(),
  ]);

  const merged: RawNewsSignal[] = [];
  for (const r of fastSettled) {
    if (r.status === "fulfilled") merged.push(...r.value);
  }

  const slowSettled = await Promise.allSettled([
    ...RSS_SOURCES.map((s) => fetchRssSource(s.url, s.label)),
    fetchAllGoogleNews(),
  ]);

  for (const r of slowSettled) {
    if (r.status === "fulfilled") merged.push(...r.value);
  }

  return dedupeSignals(merged).filter((s) => s.significanceScore >= 24);
}

import axios from "axios";
import { createHash } from "crypto";
import type { RawNewsSignal } from "@/services/news-impact/types";
import { IMPACT_KEYWORDS } from "@/services/news-impact/news-fetcher-keywords";

const WHALE_ACCOUNTS = ["whale_alert", "lookonchain", "WuBlockchain", "spotonchain"];
const EXCHANGE_ACCOUNTS = ["binance", "coinbase", "okx", "Bybit_Official"];
const NEWS_ACCOUNTS = ["CoinDesk", "Cointelegraph", "TheBlock__", "zachxbt"];

const FAST_QUERIES = [
  {
    label: "whale_flow",
    accounts: WHALE_ACCOUNTS,
    keywords: ["transferred", "deposit", "withdraw", "whale", "USDT", "BTC", "ETH", "inflow", "outflow"],
    boost: 22,
  },
  {
    label: "exchange_events",
    accounts: EXCHANGE_ACCOUNTS,
    keywords: ["listing", "lists", "delist", "hack", "halt", "suspend", "approved"],
    boost: 20,
  },
  {
    label: "breaking_news",
    accounts: NEWS_ACCOUNTS,
    keywords: ["hack", "exploit", "SEC", "ETF", "approved", "lawsuit", "liquidation", "breaking"],
    boost: 16,
  },
];

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

async function fetchTwitterQuery(
  bearer: string,
  accounts: string[],
  keywords: string[],
  boost: number
): Promise<RawNewsSignal[]> {
  const query = [
    `(${keywords.map((k) => `"${k}"`).join(" OR ")})`,
    `(${accounts.map((a) => `from:${a}`).join(" OR ")})`,
    "-is:retweet lang:en",
  ].join(" ");

  const { data } = await axios.get<{
    data?: Array<{ id: string; text: string; created_at: string; author_id?: string }>;
    includes?: { users?: Array<{ id: string; username: string }> };
  }>("https://api.twitter.com/2/tweets/search/recent", {
    headers: { Authorization: `Bearer ${bearer}` },
    params: { query, max_results: 25, "tweet.fields": "created_at,author_id" },
    timeout: 8_000,
  });

  const users = new Map((data.includes?.users ?? []).map((u) => [u.id, u.username]));
  const out: RawNewsSignal[] = [];

  for (const tweet of data.data ?? []) {
    const hits = keywordHits(tweet.text);
    if (hits.length === 0) continue;
    const username = tweet.author_id ? users.get(tweet.author_id) : undefined;
    const cashtags = [...(tweet.text.match(/\$([A-Z]{2,10})\b/g) ?? [])].map((t) => t.slice(1));

    out.push({
      id: hashId(["twitter", tweet.id]),
      title: tweet.text.slice(0, 280),
      source: username ? `@${username}` : "Twitter/X",
      sourceType: "twitter",
      publishedAt: new Date(tweet.created_at).toISOString(),
      keywordHits: hits,
      significanceScore: significanceFromHits(hits, tweet.text, boost),
      sourcePriority: 100,
      url: username ? `https://x.com/${username}/status/${tweet.id}` : undefined,
      hintCoins: cashtags.slice(0, 3),
    });
  }

  return out;
}

/** Twitter/X — primary fast source with parallel targeted queries */
export async function fetchTwitterSignalsFast(): Promise<RawNewsSignal[]> {
  const bearer = process.env.TWITTER_BEARER_TOKEN?.trim() || process.env.X_API_BEARER_TOKEN?.trim();
  if (!bearer || process.env.NEWS_IMPACT_TWITTER === "false") return [];

  const settled = await Promise.allSettled(
    FAST_QUERIES.map((q) => fetchTwitterQuery(bearer, q.accounts, q.keywords, q.boost))
  );

  const out: RawNewsSignal[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") out.push(...r.value);
  }
  return out;
}

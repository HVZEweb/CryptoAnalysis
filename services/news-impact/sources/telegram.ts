import axios from "axios";
import { createHash } from "crypto";
import type { NewsImpactSource, RawNewsSignal } from "@/services/news-impact/types";
import { IMPACT_KEYWORDS } from "@/services/news-impact/news-fetcher-keywords";

const DEFAULT_CHANNELS = [
  "whale_alert",
  "lookonchain",
  "WuBlockchain",
  "spotonchain",
  "BinanceAnnouncements",
  "Bybit_Official",
  "okxannouncements",
  "cz_binance",
  "CoinDesk",
  "Cointelegraph",
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

function getTelegramChannels(): string[] {
  const raw = process.env.NEWS_IMPACT_TELEGRAM_CHANNELS?.trim();
  if (!raw) return DEFAULT_CHANNELS;
  return raw.split(",").map((c) => c.trim().replace(/^@/, "")).filter(Boolean);
}

function parseTelegramHtml(html: string, channel: string): RawNewsSignal[] {
  const items: RawNewsSignal[] = [];
  const blockRegex =
    /<div class="tgme_widget_message_wrap[^"]*"[\s\S]*?<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<time datetime="([^"]+)"/gi;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(html)) !== null && items.length < 15) {
    const rawText = match[1]
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!rawText || rawText.length < 12) continue;

    const hits = keywordHits(rawText);
    if (hits.length === 0) continue;

    const publishedAt = new Date(match[2]).toISOString();
    const cashtags = [...(rawText.match(/\$([A-Z]{2,10})\b/g) ?? [])].map((t) => t.slice(1));

    items.push({
      id: hashId(["telegram", channel, rawText.slice(0, 120), publishedAt]),
      title: rawText.slice(0, 280),
      source: `@${channel}`,
      sourceType: "telegram",
      publishedAt,
      keywordHits: hits,
      significanceScore: significanceFromHits(hits, rawText, 18),
      sourcePriority: 95,
      url: `https://t.me/${channel}`,
      hintCoins: cashtags.slice(0, 3),
    });
  }

  return items;
}

/** Public Telegram channel preview (t.me/s/...) */
export async function fetchTelegramChannels(): Promise<RawNewsSignal[]> {
  if (process.env.NEWS_IMPACT_TELEGRAM === "false") return [];

  const channels = getTelegramChannels();
  const settled = await Promise.allSettled(
    channels.map(async (channel) => {
      const { data } = await axios.get<string>(`https://t.me/s/${channel}`, {
        timeout: 8_000,
        responseType: "text",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsImpactBot/1.0)" },
      });
      return parseTelegramHtml(data, channel);
    })
  );

  const out: RawNewsSignal[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") out.push(...r.value);
  }
  return out;
}

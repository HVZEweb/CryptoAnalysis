import { createHash } from "crypto";
import type { RawNewsSignal } from "@/services/news-impact/types";

/** Headlines that rarely move markets — price tickers, recaps, opinion */
export const NOISE_PATTERNS: RegExp[] = [
  /\b(reaches?|hit(s|ting)?|tops?|falls?\s+to|trades?\s+at|climbs?\s+to|drops?\s+to)\s+\$?\d/i,
  /\b(btc|bitcoin|eth|ethereum|sol)\s+(hits?|reaches?|tops?|falls?\s+to)\b/i,
  /\b(price\s+analysis|technical\s+analysis|weekly\s+recap|daily\s+recap|market\s+wrap)\b/i,
  /\b(what\s+to\s+know|explainer|opinion|price\s+prediction|could\s+reach)\b/i,
  /\b(surges?\s+\d+%|rallies?\s+\d+%|drops?\s+\d+%)\s+(today|this\s+week)\b/i,
  /\b(all[- ]time\s+high|ath)\b.*\$\d/i,
];

/** Soft language — downgrade or reject unless priority trigger present */
export const BLACKLIST_WORDS = [
  "rumor",
  "rumour",
  "rumors",
  "rumours",
  "reportedly",
  "may ",
  "might ",
  "could ",
  "allegedly",
  "unconfirmed",
  "speculation",
  "sources say",
  "expected to",
  "analysts say",
  "analyst predicts",
  "possibly",
  "potentially",
] as const;

/** Retrospective / stale narrative — not breaking news */
export const RETROSPECTIVE_PATTERNS: RegExp[] = [
  /\b(says|said|told|recalls?|recalled|looking back|in retrospect|remember when)\b/i,
  /\b(ceo|executive|founder)\s+(says|said|told)\b/i,
  /\b(weeks?|months?|years?)\s+ago\b/i,
  /\b(how|why)\s+.+\s+(happened|unfolded)\b/i,
];

/** Extreme triggers bypass normal freshness window */
export const FRESHNESS_BYPASS_TRIGGERS = new Set([
  "hack",
  "delisting",
  "etf_approval",
  "liquidation_event",
  "exchange_outage",
]);

/** Hard events — pass filter even with weaker keyword score */
export const PRIORITY_TRIGGER_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "listing", pattern: /\b(lists?|listing|adds?\s+to\s+(binance|coinbase|okx|bybit))\b/i },
  { id: "delisting", pattern: /\b(delist(ing|ed)?|removes?\s+trading|suspends?\s+trading)\b/i },
  { id: "hack", pattern: /\b(hack(ed)?|exploit(ed)?|drained|rug\s+pull|bridge\s+attack)\b/i },
  { id: "etf_approval", pattern: /\b(etf\s+(approved|approval)|sec\s+approves\s+.*etf)\b/i },
  { id: "major_partnership", pattern: /\b(partnership|partners?\s+with)\b.*\b(google|microsoft|blackrock|visa|mastercard|paypal|amazon)\b/i },
  { id: "regulation_ban", pattern: /\b(ban(ned|s)?|prohibit|crackdown|outlaw)\b.*\b(crypto|bitcoin|stablecoin)\b/i },
  { id: "sec_action", pattern: /\b(sec|cftc)\s+(sues?|charges?|lawsuit|fine[sd]?)\b/i },
  { id: "whale_flow", pattern: /\b(whale\s+(buy|sell|transfer|transferred|deposit|withdraw)|\$\d+m\s+(inflow|outflow))\b/i },
  { id: "liquidation_event", pattern: /\b(liquidation\s+cascade|mass\s+liquidat|\$\d+b\s+liquidat)\b/i },
  { id: "exchange_outage", pattern: /\b(binance|coinbase|okx)\b.*\b(halt|outage|suspend)\b/i },
];

export interface PreFilterResult {
  ok: boolean;
  reason?: string;
  priorityTriggers: string[];
  priorityBoost: number;
  fingerprint: string;
}

const TITLE_ALIASES: Record<string, string> = {
  ethereum: "eth",
  bitcoin: "btc",
  solana: "sol",
};

export function getMaxAgeMs(): number {
  const hours = parseInt(process.env.NEWS_IMPACT_MAX_AGE_HOURS ?? "", 10);
  const h = Number.isFinite(hours) && hours >= 1 && hours <= 24 ? hours : 3;
  return h * 60 * 60_000;
}

export function getExtremeMaxAgeMs(): number {
  return 12 * 60 * 60_000;
}

export function isFreshEnough(signal: RawNewsSignal, priorityTriggers: string[]): boolean {
  const published = new Date(signal.publishedAt).getTime();
  if (Number.isNaN(published)) return false;

  const age = Date.now() - published;
  const bypass = priorityTriggers.some((t) => FRESHNESS_BYPASS_TRIGGERS.has(t));
  const maxAge = bypass ? getExtremeMaxAgeMs() : getMaxAgeMs();
  return age >= 0 && age <= maxAge;
}

export function isRetrospectiveHeadline(text: string): boolean {
  return RETROSPECTIVE_PATTERNS.some((p) => p.test(text));
}

export function normalizeTitleForDedup(title: string): string {
  let normalized = title
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  for (const [from, to] of Object.entries(TITLE_ALIASES)) {
    normalized = normalized.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }

  return normalized;
}

export function buildNewsFingerprint(signal: RawNewsSignal): string {
  const basis = signal.url?.trim() || normalizeTitleForDedup(signal.title);
  return createHash("sha256").update(basis).digest("hex").slice(0, 20);
}

export function titleSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeTitleForDedup(a).split(" ").filter((w) => w.length > 2));
  const wb = new Set(normalizeTitleForDedup(b).split(" ").filter((w) => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter += 1;
  return inter / (wa.size + wb.size - inter);
}

export function isSimilarHeadline(a: string, b: string, threshold = 0.72): boolean {
  return titleSimilarity(a, b) >= threshold;
}

function hasBlacklistWord(text: string): boolean {
  const lower = ` ${text.toLowerCase()} `;
  return BLACKLIST_WORDS.some((w) => lower.includes(w));
}

function matchesNoise(text: string): boolean {
  return NOISE_PATTERNS.some((p) => p.test(text));
}

export function detectPriorityTriggers(text: string): string[] {
  return PRIORITY_TRIGGER_PATTERNS.filter((t) => t.pattern.test(text)).map((t) => t.id);
}

/** Strict pre-filter — rejects ~95% market noise */
export function preFilterSignal(signal: RawNewsSignal): PreFilterResult {
  const text = `${signal.title} ${signal.summary ?? ""}`;
  const fingerprint = buildNewsFingerprint(signal);
  const priorityTriggers = detectPriorityTriggers(text);

  if (matchesNoise(text) && priorityTriggers.length === 0) {
    return { ok: false, reason: "noise_pattern", priorityTriggers, priorityBoost: 0, fingerprint };
  }

  if (isRetrospectiveHeadline(text) && priorityTriggers.length === 0) {
    return { ok: false, reason: "retrospective_headline", priorityTriggers, priorityBoost: 0, fingerprint };
  }

  if (hasBlacklistWord(text) && priorityTriggers.length === 0) {
    return { ok: false, reason: "blacklist_soft_language", priorityTriggers, priorityBoost: 0, fingerprint };
  }

  if (signal.sourceType === "google-news") {
    if (priorityTriggers.length === 0) {
      return { ok: false, reason: "google_news_no_trigger", priorityTriggers, priorityBoost: 0, fingerprint };
    }
    if (!isFreshEnough(signal, priorityTriggers)) {
      return { ok: false, reason: "google_news_stale", priorityTriggers, priorityBoost: 0, fingerprint };
    }
    if (isRetrospectiveHeadline(text)) {
      return { ok: false, reason: "google_news_retrospective", priorityTriggers, priorityBoost: 0, fingerprint };
    }
  }

  if (!isFreshEnough(signal, priorityTriggers)) {
    return { ok: false, reason: "stale_article", priorityTriggers, priorityBoost: 0, fingerprint };
  }

  if (priorityTriggers.length === 0 && signal.significanceScore < 36) {
    return { ok: false, reason: "low_significance_no_trigger", priorityTriggers, priorityBoost: 0, fingerprint };
  }

  if (priorityTriggers.length === 0 && signal.keywordHits.length < 2) {
    return { ok: false, reason: "insufficient_keywords", priorityTriggers, priorityBoost: 0, fingerprint };
  }

  let priorityBoost = Math.min(20, priorityTriggers.length * 6 + (hasBlacklistWord(text) ? -5 : 0));
  if (signal.sourceType === "google-news") {
    priorityBoost = Math.max(0, priorityBoost - 8);
  }

  return {
    ok: true,
    priorityTriggers,
    priorityBoost,
    fingerprint,
  };
}

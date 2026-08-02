import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import type { NewsImpactPrediction } from "@/services/news-impact/types";

const CACHE_DIR = path.join(process.cwd(), ".cache", "news-impact");
const ALERTS_LOG_PATH = path.join(CACHE_DIR, "alerts.jsonl");
const ALERTS_SETTINGS_PATH = path.join(CACHE_DIR, "alerts-settings.json");
const MAX_MEMORY_ALERTS = 30;

export interface NewsImpactAlert {
  id: string;
  at: string;
  newsId: string;
  coin: string;
  direction: string;
  impactScore: number;
  strength: string;
  urgency: string;
  expectedMovePct: number;
  reason: string;
  sourceUrl?: string;
  sectorLabel?: string;
  affectedCoins?: string;
  channels: string[];
  success: boolean;
  error?: string;
}

const memoryAlerts: NewsImpactAlert[] = [];
let userAlertsOverride: boolean | null = null;

export function shouldSendAlert(prediction: NewsImpactPrediction): boolean {
  if (prediction.isSecondary) return false;
  const scoreOk = prediction.impactScore >= 75;
  const extreme = prediction.strength === "Extreme";
  const hotImmediate =
    prediction.strength === "High" && prediction.urgency === "Immediate";
  return scoreOk && (extreme || hotImmediate);
}

export function envAlertsEnabled(): boolean {
  return process.env.NEWS_IMPACT_ALERTS_ENABLED === "true";
}

export async function loadAlertsSettings(): Promise<{ enabled: boolean }> {
  try {
    const raw = await fs.readFile(ALERTS_SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { enabled?: boolean };
    if (typeof parsed.enabled === "boolean") {
      userAlertsOverride = parsed.enabled;
    }
  } catch {
    // use env default
  }
  return { enabled: isAlertsEnabled() };
}

export async function setAlertsEnabled(enabled: boolean): Promise<void> {
  userAlertsOverride = enabled;
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(ALERTS_SETTINGS_PATH, JSON.stringify({ enabled }), "utf-8");
}

export function isAlertsEnabled(): boolean {
  if (userAlertsOverride !== null) return userAlertsOverride;
  return envAlertsEnabled();
}

function directionEmoji(direction: string): string {
  if (direction === "LONG") return "🟢";
  if (direction === "SHORT") return "🔴";
  return "⚪";
}

function strengthEmoji(strength: string): string {
  if (strength === "Extreme") return "🔥";
  if (strength === "High") return "⚡";
  return "📰";
}

export function formatAlertMessage(
  prediction: NewsImpactPrediction,
  newsTitle?: string
): string {
  const sector =
    prediction.sectorLabel && prediction.affectedCoins?.length
      ? `\n🌐 Сектор: ${prediction.sectorLabel} (+${prediction.affectedCoins
          .filter((a) => a.coin !== prediction.coin)
          .map((a) => a.coin)
          .join(", ")})`
      : "";

  return [
    `${strengthEmoji(prediction.strength)} **News Impact Alert**`,
    `${directionEmoji(prediction.direction)} **${prediction.coin}** → **${prediction.direction}**`,
    `📊 Impact: **${prediction.impactScore}** | Confidence: **${prediction.confidence}%**`,
    `💥 Expected move: **~${prediction.expectedMovePct}%** | Urgency: **${prediction.urgency}**`,
    `📝 ${prediction.reason}`,
    newsTitle ? `📰 ${newsTitle}` : null,
    sector || null,
    prediction.sourceUrl ? `🔗 ${prediction.sourceUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatAlertPayload(
  prediction: NewsImpactPrediction,
  newsTitle?: string
): Record<string, unknown> {
  return {
    type: "news_impact_alert",
    at: new Date().toISOString(),
    coin: prediction.coin,
    direction: prediction.direction,
    impactScore: prediction.impactScore,
    confidence: prediction.confidence,
    strength: prediction.strength,
    urgency: prediction.urgency,
    expectedMovePct: prediction.expectedMovePct,
    reason: prediction.reason,
    newsTitle,
    sourceUrl: prediction.sourceUrl,
    sectorLabel: prediction.sectorLabel,
    affectedCoins: prediction.affectedCoins,
    newsId: prediction.newsId,
  };
}

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.NEWS_IMPACT_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.NEWS_IMPACT_TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return;

  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    },
    { timeout: 12_000 }
  );
}

async function sendDiscord(text: string, payload: Record<string, unknown>): Promise<void> {
  const url = process.env.NEWS_IMPACT_DISCORD_WEBHOOK?.trim();
  if (!url) return;

  await axios.post(
    url,
    {
      content: text.slice(0, 1900),
      embeds: [
        {
          title: `News Impact: ${payload.coin} ${payload.direction}`,
          description: String(payload.reason ?? "").slice(0, 500),
          color: payload.direction === "LONG" ? 0x22c55e : payload.direction === "SHORT" ? 0xef4444 : 0x94a3b8,
          fields: [
            { name: "Impact", value: String(payload.impactScore), inline: true },
            { name: "Confidence", value: `${payload.confidence}%`, inline: true },
            { name: "Move", value: `~${payload.expectedMovePct}%`, inline: true },
          ],
        },
      ],
    },
    { timeout: 12_000 }
  );
}

async function sendGenericWebhook(payload: Record<string, unknown>): Promise<void> {
  const url = process.env.NEWS_IMPACT_GENERIC_WEBHOOK?.trim();
  if (!url) return;
  await axios.post(url, payload, {
    timeout: 12_000,
    headers: { "Content-Type": "application/json" },
  });
}

async function appendAlertLog(entry: NewsImpactAlert): Promise<void> {
  memoryAlerts.push(entry);
  if (memoryAlerts.length > MAX_MEMORY_ALERTS) {
    memoryAlerts.splice(0, memoryAlerts.length - MAX_MEMORY_ALERTS);
  }
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.appendFile(ALERTS_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch {
    // non-fatal
  }
}

export function getRecentAlerts(limit = 15): NewsImpactAlert[] {
  return memoryAlerts.slice(-limit).reverse();
}

export async function loadAlertsFromDisk(limit = 20): Promise<NewsImpactAlert[]> {
  try {
    const raw = await fs.readFile(ALERTS_LOG_PATH, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const parsed = lines.slice(-limit).map((l) => JSON.parse(l) as NewsImpactAlert);
    for (const entry of parsed) {
      if (!memoryAlerts.some((m) => m.id === entry.id)) memoryAlerts.push(entry);
    }
    if (memoryAlerts.length > MAX_MEMORY_ALERTS) {
      memoryAlerts.splice(0, memoryAlerts.length - MAX_MEMORY_ALERTS);
    }
    return getRecentAlerts(limit);
  } catch {
    return getRecentAlerts(limit);
  }
}

export async function dispatchNewsImpactAlert(
  prediction: NewsImpactPrediction,
  newsTitle?: string
): Promise<NewsImpactAlert | null> {
  if (!isAlertsEnabled() || !shouldSendAlert(prediction)) return null;

  const text = formatAlertMessage(prediction, newsTitle);
  const payload = formatAlertPayload(prediction, newsTitle);
  const channels: string[] = [];
  let success = false;
  let error: string | undefined;

  try {
    const tasks: Promise<void>[] = [];
    if (process.env.NEWS_IMPACT_TELEGRAM_BOT_TOKEN && process.env.NEWS_IMPACT_TELEGRAM_CHAT_ID) {
      channels.push("telegram");
      tasks.push(sendTelegram(text));
    }
    if (process.env.NEWS_IMPACT_DISCORD_WEBHOOK) {
      channels.push("discord");
      tasks.push(sendDiscord(text, payload));
    }
    if (process.env.NEWS_IMPACT_GENERIC_WEBHOOK) {
      channels.push("webhook");
      tasks.push(sendGenericWebhook(payload));
    }

    if (tasks.length === 0) {
      return null;
    }

    const results = await Promise.allSettled(tasks);
    success = results.some((r) => r.status === "fulfilled");
    if (!success) {
      error = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)))
        .join("; ")
        .slice(0, 200);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const entry: NewsImpactAlert = {
    id: createHash("sha256")
      .update(`${prediction.newsId}:${prediction.coin}:${Date.now()}`)
      .digest("hex")
      .slice(0, 16),
    at: new Date().toISOString(),
    newsId: prediction.newsId,
    coin: prediction.coin,
    direction: prediction.direction,
    impactScore: prediction.impactScore,
    strength: prediction.strength,
    urgency: prediction.urgency,
    expectedMovePct: prediction.expectedMovePct,
    reason: prediction.reason,
    sourceUrl: prediction.sourceUrl,
    sectorLabel: prediction.sectorLabel,
    affectedCoins: prediction.affectedCoins
      ?.map((a) => `${a.coin}(${Math.round(a.weight * 100)}%)`)
      .join(", "),
    channels,
    success,
    error,
  };

  await appendAlertLog(entry);
  return entry;
}

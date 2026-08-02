/**
 * Проверка бесплатных источников News Impact (Telegram + RSS)
 * Запуск: node scripts/check-news-sources.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    const val = t.slice(i + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const cpKey = process.env.CRYPTOPANIC_API_KEY?.trim();
const bearer =
  process.env.TWITTER_BEARER_TOKEN?.trim() || process.env.X_API_BEARER_TOKEN?.trim();
const twitterOff = process.env.NEWS_IMPACT_TWITTER === "false";
const channels = (
  process.env.NEWS_IMPACT_TELEGRAM_CHANNELS?.trim() ||
  "whale_alert,lookonchain,WuBlockchain,BinanceAnnouncements"
)
  .split(",")
  .map((c) => c.trim().replace(/^@/, ""))
  .filter(Boolean)
  .slice(0, 3);

console.log("=== News Impact — бесплатные источники ===\n");

if (cpKey) {
  console.log("CryptoPanic: задан ключ (платный API) — можно удалить CRYPTOPANIC_API_KEY");
}
if (bearer && !twitterOff) {
  console.log("Twitter: задан токен (платный API) — поставьте NEWS_IMPACT_TWITTER=false");
}
if (!cpKey && (twitterOff || !bearer)) {
  console.log("Платные API: не используются ✓\n");
}

// Telegram (public preview, без API)
let tgTotal = 0;
for (const channel of channels) {
  try {
    const res = await fetch(`https://t.me/s/${channel}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsImpactBot/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    const html = await res.text();
    const posts = (html.match(/tgme_widget_message_wrap/g) ?? []).length;
    tgTotal += posts;
    console.log(`Telegram @${channel}: ${res.ok ? `OK (~${posts} posts on page)` : `HTTP ${res.status}`}`);
  } catch (e) {
    console.log(`Telegram @${channel}: ERROR ${e.message}`);
  }
}
console.log(`Telegram итого: ~${tgTotal} постов с ${channels.length} каналов\n`);

// RSS
const rssUrl = "https://www.coindesk.com/arc/outboundfeeds/rss/";
try {
  const res = await fetch(rssUrl, { signal: AbortSignal.timeout(10_000) });
  const xml = await res.text();
  const items = (xml.match(/<item>/g) ?? []).length;
  console.log(`RSS CoinDesk: ${res.ok ? `OK (${items} items)` : `HTTP ${res.status}`}`);
} catch (e) {
  console.log(`RSS CoinDesk: ERROR ${e.message}`);
}

console.log("\nБесплатный стек: Telegram + 6 RSS + Google News");
console.log("После изменения .env: npm run dev");

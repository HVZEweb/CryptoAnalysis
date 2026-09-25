/**
 * New-listings monitor, one cycle every few minutes inside the site's process:
 *  1. OKX listing announcements (published before trading starts) → stored, sent to Telegram;
 *  2. coins that appeared on OKX → profile + historical base rates → Telegram; older ones (up to two
 *     years) are added quietly to build the history the base rates come from;
 *  3. hourly bars of each coin's first 7 days, a few coins per cycle;
 *  4. a day after a live listing, what actually happened.
 */

import type { Candle } from "@/types";
import { getTelegramConfig, sendTelegram } from "@/lib/telegram";
import { getChat } from "@/services/signals/store";
import { coinListings, okxCryptoInstruments, okxHourlyBars, okxListingAnnouncements, type CoinListing } from "@/services/listings/okx";
import { coinProfile, profileLines } from "@/services/listings/profile";
import * as store from "@/services/listings/store";
import { listingMoves, studyListings, studySummary, type StudiedListing } from "@/services/listings/analysis";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Listed within this long ago counts as "new" and is announced; older coins only feed the history. */
const LIVE_WINDOW = 3 * DAY;
const HISTORY_DAYS = 730;
const BAR_FETCHES_PER_CYCLE = 12;

/** Titles about equities, pre-IPO contracts, adjustments or delistings are not coin listings. */
export function isCoinListingTitle(title: string): boolean {
  return /\blist/i.test(title) && !/equit|stock|pre-ipo|pre-market|adjust|delist|margin|convert|earn/i.test(title);
}

const msk = (t: number) => new Date(t).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const pct = (x: number | null) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);

async function notifyEnabled(): Promise<boolean> {
  const cfg = getTelegramConfig();
  if (!cfg) return false;
  return (await getChat(cfg.chatId)).listings;
}

export async function studyFromHistory(): Promise<ReturnType<typeof studyListings>> {
  const rows = (await store.listings()).filter((r) => r.bars_complete);
  const bars = await store.barsOf(rows.map((r) => r.base));
  const studied: StudiedListing[] = rows.map((r) => ({ base: r.base, listTime: r.list_time, hasSpot: Boolean(r.has_spot), hasSwap: Boolean(r.has_swap), bars: bars.get(r.base) ?? [] }));
  return studyListings(studied);
}

function marketsText(l: CoinListing): string {
  return l.instruments
    .map((i) => `${i.instType === "SPOT" ? "спот" : "фьючерс"} ${i.instId}`)
    .join(", ");
}

export interface CycleResult {
  announcements: number;
  newCoins: number;
  backfilled: number;
  barsFetched: number;
  followups: number;
  errors: string[];
}

export async function runListingsCycle(now = Date.now()): Promise<CycleResult> {
  const result: CycleResult = { announcements: 0, newCoins: 0, backfilled: 0, barsFetched: 0, followups: 0, errors: [] };
  await store.ensureListingTables();
  const notify = await notifyEnabled();

  // 1. Announcements. The very first run only records the backlog.
  try {
    const known = await store.knownAnnouncements();
    const firstRun = known.size === 0;
    for (const a of await okxListingAnnouncements()) {
      if (known.has(a.url)) continue;
      const send = notify && !firstRun && isCoinListingTitle(a.title);
      if (send) await sendTelegram(`📣 <b>OKX анонсировал листинг</b>\n${a.title}\n${a.url}`);
      await store.saveAnnouncement(a, send ? now : null);
      result.announcements++;
    }
  } catch (e) {
    result.errors.push(`announcements: ${(e as Error).message}`);
  }

  // 2. Coins that appeared on OKX.
  try {
    const known = await store.knownBases();
    const firstRun = known.size === 0;
    const coins = coinListings(await okxCryptoInstruments()).filter((c) => c.listTime >= now - HISTORY_DAYS * DAY && !known.has(c.base));
    for (const c of coins) {
      const live = !firstRun && c.listTime >= now - LIVE_WINDOW;
      const ann = await store.announcementFor(c.base, c.listTime);
      const profile = live ? await coinProfile(c.base) : null;
      await store.insertListing({
        base: c.base,
        list_time: c.listTime,
        primary_inst: c.primary.instId,
        has_spot: c.instruments.some((i) => i.instType === "SPOT" && i.quote === "USDT") ? 1 : 0,
        has_swap: c.instruments.some((i) => i.instType === "SWAP") ? 1 : 0,
        markets: marketsText(c).slice(0, 255),
        source: live ? "live" : "backfill",
        first_seen_at: now,
        announcement_title: ann?.title ?? null,
        announcement_url: ann?.url ?? null,
        announced_at: ann?.published_at ?? null,
        profile,
      });
      if (!live) {
        result.backfilled++;
        continue;
      }
      result.newCoins++;
      if (notify) {
        const study = await studyFromHistory();
        await sendTelegram(
          [
            `🆕 <b>Новая монета на OKX: ${c.base}</b>`,
            `Торги с ${msk(c.listTime)} МСК · ${marketsText(c)}`,
            ...(profile ? profileLines(profile) : []),
            ...(ann ? [`Анонс: ${ann.url}`] : []),
            ``,
            studySummary(study),
          ].join("\n")
        );
        await store.updateListing(c.base, { notified_at: now });
      }
    }
  } catch (e) {
    result.errors.push(`instruments: ${(e as Error).message}`);
  }

  // 3. First-week bars, a few coins per cycle (newest first).
  for (const l of (await store.listings({ incompleteBars: true })).slice(0, BAR_FETCHES_PER_CYCLE)) {
    try {
      if (l.list_time > now - HOUR) continue;
      const bars = await okxHourlyBars(l.primary_inst, l.list_time - (l.list_time % HOUR), 168);
      await store.saveBars(l.base, bars);
      if (now >= l.list_time + 169 * HOUR) await store.updateListing(l.base, { bars_complete: 1 });
      result.barsFetched++;
    } catch (e) {
      result.errors.push(`bars ${l.base}: ${(e as Error).message}`);
    }
  }

  // 4. A day later: what happened to the coins announced live.
  if (notify) {
    for (const l of await store.listings({ since: now - 3 * DAY })) {
      if (l.source !== "live" || !l.notified_at || l.followup_at || now < l.list_time + 25 * HOUR) continue;
      const bars: Candle[] = (await store.barsOf([l.base])).get(l.base) ?? [];
      const m = listingMoves(bars, l.list_time);
      if (!m) continue;
      await sendTelegram(
        `📊 <b>${l.base} — сутки после листинга на OKX</b>\n` +
          `Цена через час: ${m.entry}; через 4 ч ${pct(m.change[4])}, через сутки ${pct(m.change[24])}\n` +
          `За первые сутки: максимум ${pct(m.maxUp24)}, минимум ${pct(m.maxDown24)} от цены через час`
      );
      await store.updateListing(l.base, { followup_at: now });
      result.followups++;
    }
  }
  return result;
}

/**
 * What happens to a coin's price after it lists on OKX, and whether a simple trade on it pays.
 *
 * Price moves are measured from the close of the first full hour (nobody reliably gets the very first
 * print). Trade variants — long or short, enter after 1 or 4 hours, hold 1, 3 or 7 days — are chosen
 * on the earlier 60% of listings and judged once on the later 40%, with costs for new, thin markets:
 * taker fee plus 0.2% slippage per side. Only coins still listed are known (delisted ones are not in
 * OKX's instrument list), which flatters the long side.
 */

import type { Candle } from "@/types";

export const HORIZONS_H = [4, 24, 72, 168] as const;

export interface ListingMoves {
  /** Close of the first hour — the reference price */
  entry: number;
  /** Change from `entry` after h hours from listing (null when not yet known) */
  change: Record<(typeof HORIZONS_H)[number], number | null>;
  /** Highest high / lowest low within the first 24 hours, relative to `entry` */
  maxUp24: number | null;
  maxDown24: number | null;
}

export function listingMoves(bars: Candle[], listTime: number): ListingMoves | null {
  const HOUR = 3_600_000;
  const first = bars.find((b) => b.openTime >= listTime);
  if (!first) return null;
  const entry = first.close;
  const start = first.openTime;
  const closeAt = (h: number) => {
    const b = bars.find((x) => x.openTime === start + (h - 1) * HOUR);
    return b ? b.close / entry - 1 : null;
  };
  const day = bars.filter((b) => b.openTime > start && b.openTime < start + 24 * HOUR);
  return {
    entry,
    change: Object.fromEntries(HORIZONS_H.map((h) => [h, closeAt(h)])) as ListingMoves["change"],
    maxUp24: day.length ? Math.max(...day.map((b) => b.high)) / entry - 1 : null,
    maxDown24: day.length ? Math.min(...day.map((b) => b.low)) / entry - 1 : null,
  };
}

/** Round-trip cost on a new listing: taker fee both ways plus 0.2% slippage per side. */
export const LISTING_COST = { spot: 2 * (0.001 + 0.002), swap: 2 * (0.0005 + 0.002) };

export interface ListingTradeVariant {
  side: "long" | "short";
  enterAfterH: number;
  holdH: number;
}

export const LISTING_VARIANTS: ListingTradeVariant[] = (["long", "short"] as const).flatMap((side) =>
  [1, 4].flatMap((enterAfterH) => [24, 72, 168].map((holdH) => ({ side, enterAfterH, holdH })))
);

export interface StudiedListing {
  base: string;
  listTime: number;
  hasSwap: boolean;
  /** A USDT spot pair exists (bars come from it; otherwise from the swap) */
  hasSpot: boolean;
  bars: Candle[];
}

/** Net return of one variant on one listing; null when it can't be traded or the data isn't there yet. */
export function variantReturn(l: StudiedListing, v: ListingTradeVariant): number | null {
  if (v.side === "short" && !l.hasSwap) return null; // shorting needs the perpetual
  const HOUR = 3_600_000;
  const first = l.bars.find((b) => b.openTime >= l.listTime);
  if (!first) return null;
  const inBar = l.bars.find((b) => b.openTime === first.openTime + (v.enterAfterH - 1) * HOUR);
  const outBar = l.bars.find((b) => b.openTime === first.openTime + (v.enterAfterH - 1 + v.holdH) * HOUR);
  if (!inBar || !outBar) return null;
  const gross = (v.side === "long" ? 1 : -1) * (outBar.close / inBar.close - 1);
  // Longs buy spot when there is a spot pair, shorts use the perpetual.
  const cost = v.side === "long" && l.hasSpot ? LISTING_COST.spot : LISTING_COST.swap;
  // a short can lose more than 100% on a new coin — cap the loss at the whole stake
  return Math.max(-1, gross - cost);
}

export function variantLabel(v: ListingTradeVariant): string {
  return `${v.side === "long" ? "покупка" : "шорт"} через ${v.enterAfterH} ч после старта, держать ${v.holdH / 24} дн.`;
}

export interface VariantStats {
  trades: number;
  avg: number;
  median: number;
  winRate: number;
  tStat: number;
}

export function stats(r: number[]): VariantStats {
  const n = r.length;
  if (!n) return { trades: 0, avg: 0, median: 0, winRate: 0, tStat: 0 };
  const avg = r.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(r.reduce((a, x) => a + (x - avg) ** 2, 0) / Math.max(1, n - 1));
  const sorted = [...r].sort((a, b) => a - b);
  return { trades: n, avg, median: sorted[Math.floor(n / 2)], winRate: r.filter((x) => x > 0).length / n, tStat: sd > 0 ? (avg / sd) * Math.sqrt(n) : 0 };
}

export interface ListingStudy {
  listings: number;
  from: number | null;
  to: number | null;
  /** Median and share of rises for each horizon */
  moves: Array<{ hours: number; median: number; shareUp: number; n: number }>;
  best: { variant: ListingTradeVariant; selection: VariantStats; holdout: VariantStats } | null;
  passed: boolean;
  reason: string;
}

export const MIN_LISTING_TRADES = 20;

export function studyListings(listings: StudiedListing[]): ListingStudy {
  const sorted = [...listings].sort((a, b) => a.listTime - b.listTime);
  const moves = sorted.map((l) => listingMoves(l.bars, l.listTime)).filter((m): m is ListingMoves => m !== null);
  const moveRows = HORIZONS_H.map((h) => {
    const v = moves.map((m) => m.change[h]).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return { hours: h, median: v.length ? v[Math.floor(v.length / 2)] : 0, shareUp: v.length ? v.filter((x) => x > 0).length / v.length : 0, n: v.length };
  });

  const split = Math.floor(sorted.length * 0.6);
  const selection = sorted.slice(0, split);
  const holdout = sorted.slice(split);
  const returns = (set: StudiedListing[], v: ListingTradeVariant) => set.map((l) => variantReturn(l, v)).filter((x): x is number => x !== null);

  let best: ListingStudy["best"] = null;
  for (const v of LISTING_VARIANTS) {
    const s = stats(returns(selection, v));
    if (s.trades < MIN_LISTING_TRADES) continue;
    if (!best || s.tStat > best.selection.tStat) best = { variant: v, selection: s, holdout: stats(returns(holdout, v)) };
  }
  const study: ListingStudy = {
    listings: sorted.length,
    from: sorted[0]?.listTime ?? null,
    to: sorted.at(-1)?.listTime ?? null,
    moves: moveRows,
    best,
    passed: false,
    reason: "",
  };
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  if (!best) study.reason = `мало листингов для проверки (нужно ${MIN_LISTING_TRADES} на подборе)`;
  else if (best.selection.avg <= 0) study.reason = `даже лучший вариант убыточен после комиссий на ранних листингах (${pct(best.selection.avg)} на сделку)`;
  else if (best.holdout.trades < MIN_LISTING_TRADES) study.reason = `на поздних листингах мало сделок (${best.holdout.trades})`;
  else if (best.holdout.avg <= 0) study.reason = `на поздних листингах убыток: ${pct(best.holdout.avg)} на сделку`;
  else if (best.holdout.tStat < 2) study.reason = `на поздних листингах ${pct(best.holdout.avg)} на сделку, но это неотличимо от случайности (t = ${best.holdout.tStat.toFixed(1)})`;
  else {
    study.passed = true;
    study.reason = `на поздних листингах ${pct(best.holdout.avg)} на сделку после комиссий, ${best.holdout.trades} сделок, t = ${best.holdout.tStat.toFixed(1)}`;
  }
  return study;
}

/** Short text for a Telegram message about a new listing. */
export function studySummary(s: ListingStudy): string {
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;
  const day = s.moves.find((m) => m.hours === 24);
  const week = s.moves.find((m) => m.hours === 168);
  const lines = [
    `По ${s.listings} прошлым листингам на OKX (от цены через час после старта):`,
    ...(day?.n ? [`• через сутки выше в ${Math.round(day.shareUp * 100)}% случаев, медиана ${pct(day.median)}`] : []),
    ...(week?.n ? [`• через неделю выше в ${Math.round(week.shareUp * 100)}% случаев, медиана ${pct(week.median)}`] : []),
    s.passed && s.best
      ? `✅ Проверенный вариант: ${variantLabel(s.best.variant)} — ${s.reason}.`
      : `Проверенной выгодной сделки нет: ${s.reason}.`,
    `⚠️ Снятые с торгов монеты в статистику не попали — для покупки она завышена.`,
  ];
  return lines.join("\n");
}

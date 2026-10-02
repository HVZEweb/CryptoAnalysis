/**
 * Opportunity cards for the site: every trade idea the Telegram bot sent (validated signal, chance or
 * news plan) with its plan, live state or result, why it was sent, and what is known about the coin.
 * Market data is fetched live and best effort — a card still renders when a source is down.
 */

import type { Candle, MarketType } from "@/types";
import { binanceFuturesClient } from "@/lib/axios";
import { fetchCandlesInRange } from "@/services/binance";
import { coinProfile, type CoinProfile } from "@/services/listings/profile";
import { trackRecord, type TrackRecord } from "@/services/signals/logic";
import { closedSignals, recentSignals, signalById, type SignalRow } from "@/services/signals/store";
import { tradeCost } from "@/services/strategy-lab/lab";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The market a row's prices come from — the same one its outcome is judged on. */
export const marketOf = (r: Pick<SignalRow, "model_key" | "kind">): MarketType =>
  r.model_key.startsWith("pooled:") || r.kind === "news" ? "Futures" : "Spot";

export interface LiveState {
  price: number;
  /** Result if closed now at market, after costs, basis points */
  netBp: number;
  /** Share of the way from entry to target (1) or to stop (−1) */
  progress: number;
}

/** Where an open trade stands at `price`: closing now would be a market exit. */
export function liveState(r: Pick<SignalRow, "side" | "entry" | "tp" | "sl">, price: number): LiveState {
  const dir = r.side === "LONG" ? 1 : -1;
  const gross = (dir * (price - r.entry)) / r.entry;
  const move = dir * (price - r.entry);
  const toTarget = Math.abs(r.tp - r.entry);
  const toStop = Math.abs(r.entry - r.sl);
  const progress = move >= 0 ? Math.min(1, move / toTarget) : -Math.min(1, -move / toStop);
  return { price, netBp: (gross - tradeCost("time")) * 1e4, progress };
}

export interface OpportunitySummary {
  id: number;
  kind: SignalRow["kind"];
  symbol: string;
  timeframe: string;
  title: string;
  side: SignalRow["side"];
  entry: number;
  tp: number;
  sl: number;
  sentAt: number;
  closeBy: number;
  status: SignalRow["status"];
  exitPrice: number | null;
  netBp: number | null;
  closedAt: number | null;
  pUp: number | null;
  newsTitle: string | null;
  live: LiveState | null;
}

function titleOf(r: SignalRow): string {
  if (r.kind === "news") return r.details?.news?.title ?? "Новость";
  return r.details?.modelTitle ?? `${r.timeframe}${r.model_key.startsWith("pooled:") ? " · общая модель" : ""}`;
}

function summary(r: SignalRow, price: number | undefined): OpportunitySummary {
  return {
    id: r.id,
    kind: r.kind ?? "signal",
    symbol: r.symbol,
    timeframe: r.timeframe,
    title: titleOf(r),
    side: r.side,
    entry: r.entry,
    tp: r.tp,
    sl: r.sl,
    sentAt: r.sent_at,
    closeBy: r.close_by,
    status: r.status,
    exitPrice: r.exit_price,
    netBp: r.net_bp,
    closedAt: r.closed_at,
    pUp: r.details?.pUp ?? null,
    newsTitle: r.details?.news?.title ?? null,
    live: r.status === "open" && price ? liveState(r, price) : null,
  };
}

/** Last prices of every USDT perpetual in one request (open trades are marked against them). */
async function futuresPrices(): Promise<Map<string, number>> {
  try {
    const { data } = await binanceFuturesClient.get<Array<{ symbol: string; price: string }>>("/ticker/price", { timeout: 8_000 });
    return new Map(data.map((p) => [p.symbol, Number(p.price)]));
  } catch {
    return new Map();
  }
}

export interface OpportunityList {
  items: OpportunitySummary[];
  records: Record<SignalRow["kind"], TrackRecord>;
}

export async function listOpportunities(limit = 200): Promise<OpportunityList> {
  const [rows, closed] = await Promise.all([recentSignals({ limit }), closedSignals()]);
  const prices = rows.some((r) => r.status === "open") ? await futuresPrices() : new Map<string, number>();
  const of = (kind: SignalRow["kind"]) => trackRecord(closed.filter((r) => (r.kind ?? "signal") === kind));
  return {
    items: rows.map((r) => summary(r, prices.get(r.symbol))),
    records: { signal: of("signal"), chance: of("chance"), news: of("news") },
  };
}

export interface CoinMarket {
  price: number | null;
  changePct24h: number | null;
  high24h: number | null;
  low24h: number | null;
  quoteVolume24h: number | null;
  /** Last funding rate per 8h, as a fraction */
  fundingRate: number | null;
  nextFundingTime: number | null;
  /** Open interest in USDT */
  openInterestUsd: number | null;
}

async function coinMarket(symbol: string): Promise<CoinMarket> {
  const [ticker, premium, oi] = await Promise.allSettled([
    binanceFuturesClient.get<{ lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; quoteVolume: string }>("/ticker/24hr", {
      params: { symbol },
      timeout: 8_000,
    }),
    binanceFuturesClient.get<{ markPrice: string; lastFundingRate: string; nextFundingTime: number }>("/premiumIndex", { params: { symbol }, timeout: 8_000 }),
    binanceFuturesClient.get<{ openInterest: string }>("/openInterest", { params: { symbol }, timeout: 8_000 }),
  ]);
  const t = ticker.status === "fulfilled" ? ticker.value.data : null;
  const p = premium.status === "fulfilled" ? premium.value.data : null;
  const mark = p ? Number(p.markPrice) : t ? Number(t.lastPrice) : null;
  return {
    price: t ? Number(t.lastPrice) : mark,
    changePct24h: t ? Number(t.priceChangePercent) : null,
    high24h: t ? Number(t.highPrice) : null,
    low24h: t ? Number(t.lowPrice) : null,
    quoteVolume24h: t ? Number(t.quoteVolume) : null,
    fundingRate: p ? Number(p.lastFundingRate) : null,
    nextFundingTime: p ? p.nextFundingTime : null,
    openInterestUsd: oi.status === "fulfilled" && mark ? Number(oi.value.data.openInterest) * mark : null,
  };
}

// CoinGecko's free API is rate limited: a coin's profile is kept for an hour.
const profiles = new Map<string, { at: number; profile: CoinProfile }>();
async function cachedProfile(base: string): Promise<CoinProfile | null> {
  const hit = profiles.get(base);
  if (hit && Date.now() - hit.at < HOUR) return hit.profile;
  try {
    const profile = await coinProfile(base);
    profiles.set(base, { at: Date.now(), profile });
    return profile;
  } catch {
    return hit?.profile ?? null;
  }
}

const INTERVALS: Array<[string, number]> = [
  ["1m", MINUTE],
  ["5m", 5 * MINUTE],
  ["15m", 15 * MINUTE],
  ["1h", HOUR],
  ["4h", 4 * HOUR],
  ["1d", 24 * HOUR],
];

/** Chart window: some history before the entry, the whole trade, a little after; about 60–240 bars. */
export function chartWindow(r: Pick<SignalRow, "entry_time" | "close_by" | "closed_at">, now: number): { from: number; to: number; interval: string } {
  const span = Math.max(r.close_by - r.entry_time, 15 * MINUTE);
  const end = Math.min(now, Math.max(r.close_by, r.closed_at ?? 0) + span * 0.5);
  const from = r.entry_time - span * 1.5;
  const to = Math.max(end, Math.min(now, r.entry_time + 4 * MINUTE));
  const [interval] = INTERVALS.find(([, ms]) => (to - from) / ms <= 240) ?? INTERVALS[INTERVALS.length - 1];
  return { from, to, interval };
}

export interface OpportunityDetail extends OpportunitySummary {
  modelKey: string;
  barInterval: string;
  details: SignalRow["details"];
  market: MarketType;
  coin: { base: string; market: CoinMarket; profile: CoinProfile | null };
  chart: { interval: string; candles: Array<Pick<Candle, "openTime" | "open" | "high" | "low" | "close">> };
  /** Closed results of the same kind (and model, for model ideas) */
  similar: { label: string; record: TrackRecord };
  sameCoin: OpportunitySummary[];
}

export async function opportunityDetail(id: number, now = Date.now()): Promise<OpportunityDetail | null> {
  const r = await signalById(id);
  if (!r) return null;
  const base = r.symbol.replace(/USDT$/, "");
  const market = marketOf(r);
  const w = chartWindow(r, now);
  const [coinMkt, profile, candles, sameKind, coinRows] = await Promise.all([
    coinMarket(r.symbol),
    cachedProfile(base),
    fetchCandlesInRange(r.symbol, w.interval, market, w.from, w.to).catch(() => [] as Candle[]),
    closedSignals(r.kind === "news" ? { kind: "news" } : { kind: r.kind ?? "signal", modelKey: r.model_key }),
    recentSignals({ symbol: r.symbol, limit: 12 }),
  ]);
  const s = summary(r, coinMkt.price ?? undefined);
  return {
    ...s,
    modelKey: r.model_key,
    barInterval: r.bar_interval,
    details: r.details ?? null,
    market,
    coin: { base, market: coinMkt, profile },
    chart: { interval: w.interval, candles: candles.map((c) => ({ openTime: c.openTime, open: c.open, high: c.high, low: c.low, close: c.close })) },
    similar: {
      label: r.kind === "news" ? "все новости" : `${r.kind === "chance" ? "шансы" : "сигналы"} модели ${titleOf(r)}`,
      record: trackRecord(sameKind),
    },
    sameCoin: coinRows.filter((x) => x.id !== r.id).map((x) => summary(x, undefined)),
  };
}

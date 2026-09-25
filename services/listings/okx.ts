/**
 * OKX public market data for the new-listings monitor: crypto instruments with their listing time,
 * listing announcements (published before trading starts), and hourly history from the first bar.
 * All public endpoints — no keys; reachable directly from the server.
 */

import axios from "axios";
import type { Candle } from "@/types";

const BASE = "https://www.okx.com";
const http = axios.create({ baseURL: BASE, timeout: 20_000 });
const HOUR = 3_600_000;

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T[]> {
  const { data } = await http.get<{ code: string; msg: string; data: T[] }>(path, { params });
  if (data.code !== "0") throw new Error(`OKX ${path}: ${data.msg || data.code}`);
  return data.data;
}

export interface OkxInstrument {
  instId: string;
  instType: "SPOT" | "SWAP";
  /** The coin: baseCcy for spot, ctValCcy for swaps */
  base: string;
  quote: string;
  listTime: number;
  state: string;
}

/** Crypto spot pairs and perpetual swaps. Equity (instCategory 3) and other non-crypto contracts are left out. */
export async function okxCryptoInstruments(): Promise<OkxInstrument[]> {
  const out: OkxInstrument[] = [];
  for (const instType of ["SPOT", "SWAP"] as const) {
    const rows = await get<Record<string, string>>("/api/v5/public/instruments", { instType });
    for (const r of rows) {
      if ((r.instCategory ?? "1") !== "1" || !r.listTime) continue;
      const base = instType === "SPOT" ? r.baseCcy : r.ctValCcy;
      const quote = instType === "SPOT" ? r.quoteCcy : r.settleCcy;
      if (!base) continue;
      out.push({ instId: r.instId, instType, base, quote, listTime: Number(r.listTime), state: r.state });
    }
  }
  return out;
}

export interface CoinListing {
  base: string;
  /** First time the coin traded on OKX, in any market */
  listTime: number;
  instruments: OkxInstrument[];
  /** The instrument whose price history is studied: the USDT spot pair if any, else the USDT swap */
  primary: OkxInstrument;
}

/** Groups instruments by coin; a coin's listing is its first instrument ever. */
export function coinListings(instruments: OkxInstrument[]): CoinListing[] {
  const byBase = new Map<string, OkxInstrument[]>();
  for (const i of instruments) byBase.set(i.base, [...(byBase.get(i.base) ?? []), i]);
  const out: CoinListing[] = [];
  for (const [base, list] of byBase) {
    const primary =
      list.find((i) => i.instType === "SPOT" && i.quote === "USDT") ?? list.find((i) => i.instType === "SWAP" && i.quote === "USDT");
    if (!primary) continue;
    out.push({ base, listTime: Math.min(...list.map((i) => i.listTime)), instruments: list, primary });
  }
  return out.sort((a, b) => b.listTime - a.listTime);
}

export interface Announcement {
  title: string;
  url: string;
  publishedAt: number;
}

export async function okxListingAnnouncements(): Promise<Announcement[]> {
  const pages = await get<{ details: Array<{ title: string; url: string; pTime: string }> }>("/api/v5/support/announcements", {
    annType: "announcements-new-listings",
    page: 1,
  });
  return pages.flatMap((p) => p.details.map((d) => ({ title: d.title, url: d.url, publishedAt: Number(d.pTime) })));
}

/** Hourly candles from `from` for `hours` hours (oldest first); history-candles pages backwards by `after`. */
export async function okxHourlyBars(instId: string, from: number, hours: number): Promise<Candle[]> {
  const bars = new Map<number, Candle>();
  for (let end = from + Math.min(hours, 100) * HOUR; ; end += 100 * HOUR) {
    const rows = await get<string[]>("/api/v5/market/history-candles", { instId, bar: "1H", after: end, limit: 100 });
    for (const r of rows) {
      const t = Number(r[0]);
      if (t < from || t >= from + hours * HOUR) continue;
      // [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
      if (r[8] !== "1") continue; // still forming
      bars.set(t, { openTime: t, closeTime: t + HOUR - 1, open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5], quoteVolume: +r[7], trades: 0 });
    }
    if (end >= from + hours * HOUR || end > Date.now()) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  return [...bars.values()].sort((a, b) => a.openTime - b.openTime);
}

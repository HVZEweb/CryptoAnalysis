/**
 * Binance public data archive (data.binance.vision): years of futures klines, 5-minute positioning
 * metrics and funding, as one-file zips. Unlike the Binance API it is reachable from GitHub Actions,
 * which is where the pooled model is trained. Files are cached on disk, so a weekly run only
 * downloads the new days.
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import axios from "axios";
import type { Candle } from "@/types";
import type { DerivData, DerivPoint } from "@/services/pooled/derivs";

const ROOT = "https://data.binance.vision/data";
const BASE = `${ROOT}/futures/um`;
const SPOT = `${ROOT}/spot`;
const DAY = 86_400_000;

/** Contents of the single file in a zip archive (as the Binance archive packs them). */
export function unzipSingle(zip: Buffer): string {
  // End-of-central-directory record → central directory entry → local header → data.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const central = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt32LE(central) !== 0x02014b50) throw new Error("bad zip central directory");
  const method = zip.readUInt16LE(central + 10);
  const compressedSize = zip.readUInt32LE(central + 20);
  const localHeader = zip.readUInt32LE(central + 42);
  if (zip.readUInt32LE(localHeader) !== 0x04034b50) throw new Error("bad zip local header");
  const nameLen = zip.readUInt16LE(localHeader + 26);
  const extraLen = zip.readUInt16LE(localHeader + 28);
  const start = localHeader + 30 + nameLen + extraLen;
  const data = zip.subarray(start, start + compressedSize);
  if (method === 0) return data.toString("utf-8");
  if (method === 8) return zlib.inflateRawSync(data).toString("utf-8");
  throw new Error(`unsupported zip method ${method}`);
}

export interface ArchiveOptions {
  cacheDir: string;
  /** Parallel downloads */
  concurrency?: number;
  log?: (line: string) => void;
}

/** Downloads (or reads from cache) one archive file; null when Binance has no such file. */
async function fetchCsv(url: string, opts: ArchiveOptions, cacheable: boolean): Promise<string | null> {
  const file = path.join(opts.cacheDir, url.slice(ROOT.length + 1).replace(/\.zip$/, ".csv"));
  const missing = `${file}.missing`;
  if (cacheable && fs.existsSync(file)) return fs.readFileSync(file, "utf-8");
  if (cacheable && fs.existsSync(missing)) return null;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer", timeout: 60_000, validateStatus: () => true });
      if (res.status === 404) {
        if (cacheable) {
          fs.mkdirSync(path.dirname(missing), { recursive: true });
          fs.writeFileSync(missing, "");
        }
        return null;
      }
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const csv = unzipSingle(Buffer.from(res.data));
      if (cacheable) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, csv);
      }
      return csv;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${url}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const ym = (t: number) => new Date(t).toISOString().slice(0, 7);

/** Whole months fully in the past are archived monthly; the current month only day by day. */
function periods(from: number, to: number): { months: string[]; days: string[] } {
  const now = new Date();
  const currentMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const months: string[] = [];
  const d = new Date(from);
  for (let m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); m < currentMonth && m <= to; ) {
    months.push(ym(m));
    const x = new Date(m);
    m = Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 1);
  }
  const days: string[] = [];
  for (let t = Math.max(from, currentMonth); t <= to; t += DAY) days.push(ymd(t));
  return { months, days };
}

/** Spot archive times are in microseconds since 2025; futures and older spot files use milliseconds. */
const ms = (v: string) => {
  const n = Number(v);
  return n > 1e14 ? Math.floor(n / 1000) : n;
};

export function parseKlines(csv: string): Candle[] {
  const out: Candle[] = [];
  for (const line of csv.split("\n")) {
    const f = line.split(",");
    if (f.length < 11 || !/^\d/.test(f[0])) continue;
    out.push({
      openTime: ms(f[0]),
      open: Number(f[1]),
      high: Number(f[2]),
      low: Number(f[3]),
      close: Number(f[4]),
      volume: Number(f[5]),
      closeTime: ms(f[6]),
      quoteVolume: Number(f[7]),
      trades: Number(f[8]),
      takerBuyVolume: Number(f[9]),
    });
  }
  return out;
}

/** Futures (default) or spot klines of `interval` between `from` and `to` (ms), oldest first, de-duplicated. */
export async function archiveKlines(
  symbol: string,
  interval: string,
  from: number,
  to: number,
  opts: ArchiveOptions,
  market: "futures" | "spot" = "futures"
): Promise<Candle[]> {
  const base = market === "spot" ? SPOT : BASE;
  const { months, days } = periods(from, to);
  const urls = [
    ...months.map((m) => ({ url: `${base}/monthly/klines/${symbol}/${interval}/${symbol}-${interval}-${m}.zip`, cache: true })),
    // The newest day may still be re-published; don't cache the last two days.
    ...days.map((d) => ({ url: `${base}/daily/klines/${symbol}/${interval}/${symbol}-${interval}-${d}.zip`, cache: Date.parse(d) < to - 2 * DAY })),
  ];
  const csvs = await mapLimit(urls, opts.concurrency ?? 8, (u) => fetchCsv(u.url, opts, u.cache));
  const byTime = new Map<number, Candle>();
  for (const csv of csvs) if (csv) for (const c of parseKlines(csv)) byTime.set(c.openTime, c);
  return [...byTime.values()].filter((c) => c.openTime >= from && c.openTime <= to).sort((a, b) => a.openTime - b.openTime);
}

function parseMetrics(csv: string): DerivPoint[] {
  const out: DerivPoint[] = [];
  const lines = csv.split("\n");
  const header = lines[0].split(",");
  const col = (name: string) => header.indexOf(name);
  const iTime = col("create_time");
  const iOi = col("sum_open_interest");
  const iG = col("count_long_short_ratio");
  const iT = col("sum_toptrader_long_short_ratio");
  const iK = col("sum_taker_long_short_vol_ratio");
  if (iTime < 0) return out;
  const num = (s: string | undefined) => {
    const n = Number(s);
    return s !== undefined && s !== "" && Number.isFinite(n) ? n : undefined;
  };
  for (const line of lines.slice(1)) {
    const f = line.split(",");
    if (f.length < header.length) continue;
    const ts = Date.parse(`${f[iTime].replace(" ", "T")}Z`);
    if (!Number.isFinite(ts)) continue;
    out.push({ ts, oi: num(f[iOi]), lsGlobal: num(f[iG]), lsTop: num(f[iT]), taker: num(f[iK]) });
  }
  return out;
}

/** 5-minute positioning snapshots and funding settlements between `from` and `to`. */
export async function archiveDerivs(symbol: string, from: number, to: number, opts: ArchiveOptions): Promise<DerivData> {
  const days: string[] = [];
  for (let t = from - (from % DAY); t <= to; t += DAY) days.push(ymd(t));
  const metricCsvs = await mapLimit(days, opts.concurrency ?? 8, (d) =>
    fetchCsv(`${BASE}/daily/metrics/${symbol}/${symbol}-metrics-${d}.zip`, opts, Date.parse(d) < to - 2 * DAY)
  );
  const points = metricCsvs.flatMap((csv) => (csv ? parseMetrics(csv) : [])).sort((a, b) => a.ts - b.ts);

  const funding = await archiveFunding(symbol, from, to, opts);
  return { points, funding };
}

/** Funding settlements between `from` and `to` (monthly archive files), oldest first. */
export async function archiveFunding(symbol: string, from: number, to: number, opts: ArchiveOptions): Promise<DerivData["funding"]> {
  const { months } = periods(from - 31 * DAY, to);
  const fundingCsvs = await mapLimit(months, opts.concurrency ?? 8, (m) =>
    fetchCsv(`${BASE}/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${m}.zip`, opts, true)
  );
  const funding: DerivData["funding"] = [];
  for (const csv of fundingCsvs) {
    if (!csv) continue;
    for (const line of csv.split("\n").slice(1)) {
      const [time, , rate] = line.split(",");
      if (/^\d/.test(time ?? "") && Number.isFinite(Number(rate))) funding.push({ time: Number(time), rate: Number(rate) });
    }
  }
  return funding.sort((a, b) => a.time - b.time);
}

import { describe, expect, it } from "vitest";
import type { Candle } from "@/types";
import { coinListings, type OkxInstrument } from "@/services/listings/okx";
import { isCoinListingTitle } from "@/services/listings/monitor";
import { LISTING_COST, listingMoves, studyListings, variantReturn, type StudiedListing } from "@/services/listings/analysis";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1, 10);

function bars(closes: number[], start = T0): Candle[] {
  return closes.map((c, i) => ({ openTime: start + i * HOUR, closeTime: start + (i + 1) * HOUR - 1, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1, quoteVolume: 1, trades: 0 }));
}

describe("coinListings", () => {
  const inst = (instId: string, instType: "SPOT" | "SWAP", base: string, quote: string, listTime: number): OkxInstrument => ({ instId, instType, base, quote, listTime, state: "live" });

  it("groups by coin, takes the first listing time and prefers the USDT spot pair", () => {
    const [kii] = coinListings([
      inst("KII-USDT-SWAP", "SWAP", "KII", "USDT", 200),
      inst("KII-USDT", "SPOT", "KII", "USDT", 300),
      inst("KII-USDC", "SPOT", "KII", "USDC", 100),
    ]);
    expect(kii.listTime).toBe(100);
    expect(kii.primary.instId).toBe("KII-USDT");
  });

  it("falls back to the USDT swap and skips coins without a USDT market", () => {
    const out = coinListings([inst("A-USDT-SWAP", "SWAP", "A", "USDT", 1), inst("B-EUR", "SPOT", "B", "EUR", 2)]);
    expect(out.map((c) => c.primary.instId)).toEqual(["A-USDT-SWAP"]);
  });
});

describe("isCoinListingTitle", () => {
  it("keeps coin listings and drops equities, pre-IPO and adjustments", () => {
    expect(isCoinListingTitle("OKX to list perpetual futures for KII crypto")).toBe(true);
    expect(isCoinListingTitle("OKX to list perpetual futures for MSTU, KSTR, CYPH and GTLB equities")).toBe(false);
    expect(isCoinListingTitle("OKX to list Pre-IPO pre-market perpetual futures for OURA/USDT")).toBe(false);
    expect(isCoinListingTitle("OKX to Adjust KIOXIA Equity Perpetual Futures Due to Corporate Action")).toBe(false);
  });
});

describe("listingMoves", () => {
  it("measures from the close of the first hour", () => {
    const b = bars([100, 110, ...Array(30).fill(90)]);
    const m = listingMoves(b, T0)!;
    expect(m.entry).toBe(100);
    expect(m.change[4]).toBeCloseTo(-0.1);
    expect(m.change[24]).toBeCloseTo(-0.1);
    expect(m.change[168]).toBeNull(); // not enough history yet
    expect(m.maxUp24).toBeCloseTo(0.111, 2);
  });
});

describe("variantReturn", () => {
  const listing = (hasSwap: boolean, closes: number[]): StudiedListing => ({ base: "X", listTime: T0, hasSpot: true, hasSwap, bars: bars(closes) });

  it("buys spot and shorts only where there is a perpetual, with listing costs", () => {
    const falling = listing(true, [100, ...Array(30).fill(80)]);
    expect(variantReturn(falling, { side: "short", enterAfterH: 1, holdH: 24 })).toBeCloseTo(0.2 - LISTING_COST.swap);
    expect(variantReturn(falling, { side: "long", enterAfterH: 1, holdH: 24 })).toBeCloseTo(-0.2 - LISTING_COST.spot);
    expect(variantReturn(listing(false, [100, ...Array(30).fill(80)]), { side: "short", enterAfterH: 1, holdH: 24 })).toBeNull();
  });

  it("caps a short's loss at the whole stake", () => {
    const moon = listing(true, [1, ...Array(30).fill(10)]);
    expect(variantReturn(moon, { side: "short", enterAfterH: 1, holdH: 24 })).toBe(-1);
  });
});

describe("studyListings", () => {
  it("passes a pattern that holds on later listings too, and not with too few listings", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      base: `C${i}`,
      listTime: T0 + i * 7 * 24 * HOUR,
      hasSpot: true,
      hasSwap: true,
      bars: bars([100, ...Array(200).fill(i % 5 === 0 ? 104 : 85)], T0 + i * 7 * 24 * HOUR),
    }));
    const s = studyListings(many);
    expect(s.best?.variant.side).toBe("short");
    expect(s.passed).toBe(true);
    expect(s.moves.find((m) => m.hours === 24)!.shareUp).toBeCloseTo(0.2);
    expect(studyListings(many.slice(0, 10)).passed).toBe(false);
  });
});

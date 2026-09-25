import { describe, expect, it } from "vitest";
import { anchoredVwap, analyzeVolume, calculateLevels, calculateVolatility } from "@/lib/indicators";
import type { Candle } from "@/types";

function candles(n: number, minutes: number, start = Date.UTC(2026, 0, 1)): Candle[] {
  const out: Candle[] = [];
  let price = 84000;
  for (let i = 0; i < n; i++) {
    const open = price;
    price = price * (1 + Math.sin(i / 5) * 0.002 + (i % 7 === 0 ? -0.001 : 0.0005));
    out.push({
      openTime: start + i * minutes * 60_000,
      open,
      high: Math.max(open, price) * 1.001,
      low: Math.min(open, price) * 0.999,
      close: price,
      volume: 100 + (i % 10),
      closeTime: start + (i + 1) * minutes * 60_000 - 1,
      quoteVolume: price * 100,
      trades: 1,
    });
  }
  return out;
}

describe("indicator fixes", () => {
  it("reports weekly volatility from 200 × 15m candles", () => {
    const v = calculateVolatility(candles(200, 15));
    expect(v.dailyVolatility).toBeGreaterThan(0);
    expect(v.weeklyVolatility).toBeCloseTo(v.dailyVolatility * Math.sqrt(7));
  });

  it("anchors intraday VWAP to the current UTC day", () => {
    const cs = candles(200, 15);
    const today = Math.floor(cs[cs.length - 1].openTime / 86_400_000) * 86_400_000;
    const todays = cs.filter((c) => c.openTime >= today);
    const expected =
      todays.reduce((s, c) => s + ((c.high + c.low + c.close) / 3) * c.volume, 0) /
      todays.reduce((s, c) => s + c.volume, 0);
    expect(anchoredVwap(cs)).toBeCloseTo(expected);
  });

  it("keeps support/resistance at least half an ATR from price", () => {
    const cs = candles(200, 15);
    const price = cs[cs.length - 1].close;
    const lv = calculateLevels(cs, price);
    const atrApprox = price * 0.002;
    expect(price - lv.nearestSupport).toBeGreaterThan(atrApprox * 0.5);
    expect(lv.nearestResistance - price).toBeGreaterThan(atrApprox * 0.5);
  });

  it("ignores the still-forming candle when flagging volume anomalies", () => {
    const cs = candles(50, 15);
    cs[cs.length - 1] = { ...cs[cs.length - 1], volume: 100_000 };
    expect(analyzeVolume(cs).anomalousVolume).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { computeFeatureSeries, FEATURE_NAMES } from "@/services/predictor/features";
import { resampleCandles } from "@/services/predictor/data";
import { predictWithModel } from "@/services/predictor";
import { buildSamples, trainPredictor, walkForward } from "@/services/predictor/train";
import type { Candle } from "@/types";

/** Deterministic PRNG so the tests never flake. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function gaussian(rand: () => number) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
}

/** `reversal` > 0 makes each bar partly undo the previous one — a learnable pattern. */
function makeCandles(n: number, seed: number, reversal = 0): Candle[] {
  const rand = rng(seed);
  const candles: Candle[] = [];
  let price = 100;
  let prevRet = 0;
  for (let i = 0; i < n; i++) {
    const ret = 0.01 * gaussian(rand) - reversal * prevRet;
    const open = price;
    price = price * Math.exp(ret);
    const wick = Math.abs(0.003 * gaussian(rand));
    candles.push({
      openTime: i * 3_600_000,
      open,
      high: Math.max(open, price) * (1 + wick),
      low: Math.min(open, price) * (1 - wick),
      close: price,
      volume: 1000 + 200 * rand(),
      closeTime: (i + 1) * 3_600_000 - 1,
      quoteVolume: price * 1000,
      trades: 10,
    });
    prevRet = ret;
  }
  return candles;
}

describe("predictor features", () => {
  it("never looks ahead: a row only depends on candles up to its index", () => {
    const candles = makeCandles(400, 1);
    const full = computeFeatureSeries(candles).rows;
    const truncated = computeFeatureSeries(candles.slice(0, 250)).rows;
    expect(truncated[249]).toEqual(full[249]);
  });

  it("resamples into complete UTC buckets only", () => {
    const candles = makeCandles(10, 2).map((c, i) => ({ ...c, openTime: i * 300_000, closeTime: (i + 1) * 300_000 - 1 }));
    const out = resampleCandles(candles, 5, 15);
    expect(out).toHaveLength(3);
    expect(out[0].open).toBe(candles[0].open);
    expect(out[0].close).toBe(candles[2].close);
    expect(out[0].high).toBe(Math.max(...candles.slice(0, 3).map((c) => c.high)));
  });
});

describe("predictor validation", () => {
  it("finds no edge in a pure random walk", () => {
    const samples = [1, 2, 3].flatMap((seed) => buildSamples(`S${seed}`, makeCandles(3000, seed), 1));
    const report = walkForward(samples, 1, 60);
    expect(report.hasEdge).toBe(false);
    expect(report.band80Coverage).toBeGreaterThan(0.75);
    expect(report.band80Coverage).toBeLessThan(0.85);
  });

  it("detects a real mean-reversion pattern", () => {
    const samples = [4, 5, 6].flatMap((seed) => buildSamples(`S${seed}`, makeCandles(3000, seed, 0.3), 1));
    const report = walkForward(samples, 1, 60);
    expect(report.hasEdge).toBe(true);
    expect(report.accuracy).toBeGreaterThan(0.55);
  });
});

describe("predictWithModel", () => {
  it("returns an ordered price forecast and a direction only when the model has an edge", () => {
    const series = [7, 8].map((seed) => ({ symbol: `S${seed}`, candles: makeCandles(2500, seed, 0.3) }));
    const model = trainPredictor("1h", series, "test");
    const candles = makeCandles(300, 9, 0.3);
    const price = candles[candles.length - 1].close;

    const out = predictWithModel(model, candles, price)!;
    const f = out.priceForecast;
    expect(f.source).toBe("predictor");
    expect(f.predictedLow).toBeLessThan(f.confidenceBand.low);
    expect(f.confidenceBand.low).toBeLessThan(f.predictedPrice);
    expect(f.predictedPrice).toBeLessThan(f.confidenceBand.high);
    expect(f.confidenceBand.high).toBeLessThan(f.predictedHigh);
    expect(out.ml?.source).toBe("predictor");

    const noEdge = { ...model, validation: { ...model.validation, hasEdge: false } };
    expect(predictWithModel(noEdge, candles, price)!.ml).toBeNull();
  });
});

describe("gradient boosting", () => {
  it("learns an interaction a linear model cannot", async () => {
    const { fitGbm, predictGbm, fitLogistic, predictProbability } = await import("@/services/predictor/model");
    const rand = rng(11);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const a = rand() * 2 - 1;
      const b = rand() * 2 - 1;
      X.push([a, b]);
      y.push(a > 0 !== b > 0 ? 1 : 0);
    }
    const gbm = fitGbm(X, y, { trees: 60, learningRate: 0.2, minLeaf: 50 });
    const lin = fitLogistic(X, y);
    const acc = (p: (x: number[]) => number) => X.filter((x, i) => (p(x) >= 0.5 ? 1 : 0) === y[i]).length / X.length;
    expect(acc((x) => predictGbm(gbm, x))).toBeGreaterThan(0.9);
    expect(acc((x) => predictProbability(lin, x))).toBeLessThan(0.6);
  });
});

describe("BTC context features", () => {
  it("are zero without BTC candles and self-consistent for BTC itself", () => {
    const candles = makeCandles(300, 3);
    const idx = FEATURE_NAMES.indexOf("btc_div_12");
    const without = computeFeatureSeries(candles).rows[299]!;
    const self = computeFeatureSeries(candles, { btc: candles }).rows[299]!;
    expect(without[idx]).toBe(0);
    expect(without[FEATURE_NAMES.indexOf("btc_ret_4")]).toBe(0);
    expect(self[idx]).toBeCloseTo(0);
    expect(self[FEATURE_NAMES.indexOf("btc_ret_4")]).toBeCloseTo(self[FEATURE_NAMES.indexOf("ret_4")]);
  });
});

import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { describe, expect, it } from "vitest";
import type { Candle } from "@/types";
import { alignDerivs, type DerivData } from "@/services/pooled/derivs";
import { computePooledFeatureSeries, POOLED_FEATURE_NAMES } from "@/services/pooled/features";
import { unzipSingle } from "@/services/pooled/archive";
import { loadPooledModel, predictPooled, savePooledModel } from "@/services/pooled/index";
import { CANDIDATES, trainPredictor } from "@/services/predictor/train";

const HOUR = 3_600_000;
const FIVE = 300_000;

function series(n: number, seed: number): { candles: Candle[]; derivs: DerivData } {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
  let price = 100;
  let oi = 1e6;
  const candles: Candle[] = [];
  const points: DerivData["points"] = [];
  const funding: DerivData["funding"] = [];
  for (let i = 0; i < n; i++) {
    const t = i * HOUR;
    const open = price;
    price *= 1 + rnd() * 0.02;
    candles.push({ openTime: t, closeTime: t + HOUR - 1, open, high: Math.max(open, price) * 1.003, low: Math.min(open, price) * 0.997, close: price, volume: 100 + rnd() * 50, quoteVolume: 1e4, trades: 10, takerBuyVolume: 50 + rnd() * 20 });
    for (let k = 0; k < 12; k++) {
      oi *= 1 + rnd() * 0.002;
      points.push({ ts: t + k * FIVE, oi, lsGlobal: 1.5 + rnd() * 0.2, lsTop: 1.2 + rnd() * 0.2, taker: 1 + rnd() * 0.3 });
    }
    if (i % 8 === 0) funding.push({ time: t, rate: 0.0001 + rnd() * 0.0001 });
  }
  return { candles, derivs: { points, funding } };
}

describe("alignDerivs", () => {
  it("uses the last snapshot at least 5 minutes before the bar closes, never a later one", () => {
    const candles = [{ openTime: 0, closeTime: HOUR - 1 }] as Candle[];
    const data: DerivData = {
      points: [
        { ts: 50 * 60_000, oi: 1, lsGlobal: 1, lsTop: 1, taker: 1 },
        { ts: 55 * 60_000, oi: 2, lsGlobal: 1, lsTop: 1, taker: 1 },
        { ts: 58 * 60_000, oi: 99, lsGlobal: 1, lsTop: 1, taker: 1 },
      ],
      funding: [{ time: 0, rate: 0.0001 }],
    };
    expect(alignDerivs(candles, data)[0]!.oi).toBe(2);
  });

  it("has no data for a bar when the snapshots are stale or funding is unknown", () => {
    const candles = [{ openTime: 10 * HOUR, closeTime: 11 * HOUR - 1 }] as Candle[];
    const old = { ts: 0, oi: 1, lsGlobal: 1, lsTop: 1, taker: 1 };
    expect(alignDerivs(candles, { points: [old], funding: [{ time: 0, rate: 0 }] })[0]).toBeNull();
    expect(alignDerivs(candles, { points: [{ ...old, ts: 10.5 * HOUR }], funding: [] })[0]).toBeNull();
  });
});

describe("computePooledFeatureSeries", () => {
  it("never looks ahead: a row is the same whether or not later bars exist", () => {
    const { candles, derivs } = series(500, 7);
    const full = computePooledFeatureSeries(candles, { derivs });
    const i = 420;
    const cut = computePooledFeatureSeries(candles.slice(0, i + 1), { derivs: { points: derivs.points.filter((p) => p.ts <= candles[i].closeTime), funding: derivs.funding } });
    expect(full.rows[i]).not.toBeNull();
    expect(cut.rows[i]).toEqual(full.rows[i]);
    expect(full.rows[i]!.length).toBe(POOLED_FEATURE_NAMES.length);
  });

  it("treats funding flat at the baseline as normal, not as missing data", () => {
    const { candles, derivs } = series(500, 3);
    const flat = { ...derivs, funding: derivs.funding.map((f) => ({ ...f, rate: 0.0001 })) };
    const rows = computePooledFeatureSeries(candles, { derivs: flat }).rows;
    expect(rows[450]).not.toBeNull();
    expect(rows[450]!.at(-1)).toBe(0);
  });
});

describe("archive", () => {
  it("unpacks the single file of a zip", () => {
    const name = Buffer.from("x.csv");
    const body = Buffer.from("a,b\n1,2\n");
    const data = zlib.deflateRawSync(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const centralAt = local.length + name.length + data.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt32LE(centralAt, 16);
    const zip = Buffer.concat([local, name, data, central, name, eocd]);
    expect(unzipSingle(zip)).toBe("a,b\n1,2\n");
  });
});

describe("pooled model", () => {
  it("trains, saves, loads and predicts with positioning features", () => {
    const a = series(1600, 11);
    const b = series(1600, 29);
    const model = trainPredictor(
      "1h",
      [
        { symbol: "BTCUSDT", candles: a.candles },
        { symbol: "ETHUSDT", candles: b.candles },
      ],
      "test",
      {
        btc: a.candles,
        candidates: [CANDIDATES[0]],
        features: {
          names: POOLED_FEATURE_NAMES,
          set: "pooled",
          compute: (s, c) => computePooledFeatureSeries(c, { btc: a.candles, derivs: s === "BTCUSDT" ? a.derivs : b.derivs }),
        },
      }
    );
    expect(model.featureSet).toBe("pooled");
    expect(model.strategy?.bySymbol).toBeDefined();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pooled-"));
    savePooledModel(model, dir);
    const loaded = loadPooledModel("1h", dir)!;
    expect(loaded.featureNames).toEqual([...POOLED_FEATURE_NAMES]);
    const run = predictPooled(loaded, b.candles, b.candles.at(-1)!.close, a.candles, b.derivs);
    expect(run!.probabilityUp).toBeGreaterThan(0);
    expect(run!.probabilityUp).toBeLessThan(1);
  });
});

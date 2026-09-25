import crypto from "crypto";
import { describe, expect, it } from "vitest";
import type { AxiosInstance } from "axios";
import { demoConfig, OkxDemo, swapInstId } from "@/lib/okx-demo";

const cfg = { key: "k", secret: "s", passphrase: "p", notionalUsd: 100 };
const NOW = new Date("2026-09-25T12:00:00.000Z");

function fakeHttp(posMode = "net_mode") {
  const requests: Array<{ method: string; url: string; data?: Record<string, unknown>; headers: Record<string, string> }> = [];
  const http = {
    request: async (r: { method: string; url: string; data?: Record<string, unknown>; headers: Record<string, string> }) => {
      requests.push(r);
      const ok = (data: unknown[]) => ({ data: { code: "0", msg: "", data } });
      if (r.url.startsWith("/api/v5/public/instruments")) return ok([{ ctVal: "0.01", lotSz: "0.01", minSz: "0.01", tickSz: "0.1" }]);
      if (r.url === "/api/v5/account/config") return ok([{ posMode }]);
      if (r.url === "/api/v5/trade/order" && r.method === "POST") return ok([{ ordId: "42" }]);
      if (r.url.startsWith("/api/v5/trade/order?")) return ok([{ avgPx: "65010" }]);
      if (r.url.startsWith("/api/v5/account/positions-history"))
        return ok([{ cTime: String(NOW.getTime()), openAvgPx: "65010", closeAvgPx: "66000", realizedPnl: "1.4", closeTotalPos: "0.15" }]);
      return ok([]);
    },
  } as unknown as AxiosInstance;
  return { http, requests };
}

describe("OKX demo", () => {
  it("only ever runs against the demo account", () => {
    const keys = { OKX_API_KEY: "k", OKX_SECRET_KEY: "s", OKX_PASSPHRASE: "p" };
    expect(demoConfig({ ...keys, OKX_DEMO: "false" })).toBeNull();
    expect(demoConfig({ ...keys })).toBeNull();
    expect(demoConfig({ ...keys, OKX_DEMO: "true", OKX_API_KEY: "your_okx_api_key" })).toBeNull();
    expect(demoConfig({ ...keys, OKX_DEMO: "true" })?.notionalUsd).toBe(100);
  });

  it("maps symbols to perpetual swaps", () => {
    expect(swapInstId("BTCUSDT")).toBe("BTC-USDT-SWAP");
  });

  it("signs requests, marks them simulated, sizes the position and attaches TP/SL", async () => {
    const { http, requests } = fakeHttp();
    const o = await new OkxDemo(cfg, http, () => NOW).open("BTCUSDT", "LONG", 65000, 66000.04, 64500.06);
    const order = requests.find((r) => r.method === "POST" && r.url === "/api/v5/trade/order")!;
    expect(order.headers["x-simulated-trading"]).toBe("1");
    const expected = crypto.createHmac("sha256", "s").update(NOW.toISOString() + "POST" + "/api/v5/trade/order" + JSON.stringify(order.data)).digest("base64");
    expect(order.headers["OK-ACCESS-SIGN"]).toBe(expected);
    // 100$ / (0.01 BTC × 65000) = 0.1538 → 0.15 contracts (lot 0.01)
    expect(order.data).toMatchObject({ instId: "BTC-USDT-SWAP", side: "buy", ordType: "market", sz: "0.15", tdMode: "cross" });
    expect(order.data).not.toHaveProperty("posSide");
    expect((order.data!.attachAlgoOrds as Array<Record<string, string>>)[0]).toEqual({ tpTriggerPx: "66000", tpOrdPx: "66000", slTriggerPx: "64500.1", slOrdPx: "-1" });
    expect(o).toMatchObject({ ordId: "42", entry: 65010, contracts: 0.15 });
  });

  it("adds posSide in long/short position mode", async () => {
    const { http, requests } = fakeHttp("long_short_mode");
    await new OkxDemo(cfg, http, () => NOW).open("BTCUSDT", "SHORT", 65000, 64000, 65500);
    expect(requests.find((r) => r.method === "POST")!.data).toMatchObject({ side: "sell", posSide: "short" });
  });

  it("reads the realised result including fees as basis points of the position", async () => {
    const { http } = fakeHttp();
    const r = await new OkxDemo(cfg, http, () => NOW).settlement("BTC-USDT-SWAP", NOW.getTime());
    // 1.4$ on 0.15 × 0.01 × 65010 = 97.5$
    expect(r!.netBp).toBeCloseTo((1.4 / 97.515) * 1e4, 1);
    expect(r!.exit).toBe(66000);
  });
});

/**
 * OKX API Client — simulation | paper (real market) | live trading
 */

import crypto from "crypto";
import axios, { type AxiosInstance } from "axios";
import { getOKXSimulator } from "./okx-simulator";
import { getOKXPaperEngine, getTradingMode, type MarketSnapshot } from "./okx-paper";

interface OKXConfig {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  isDemo?: boolean;
  isSimulation?: boolean;
  isPaper?: boolean;
}

interface OKXResponse<T> {
  code: string;
  msg: string;
  data: T;
}

export class OKXClient {
  private apiKey: string;
  private secretKey: string;
  private passphrase: string;
  private client: AxiosInstance;
  private isSimulation: boolean;
  private isPaper: boolean;
  private simulator: ReturnType<typeof getOKXSimulator> | null = null;
  private paper = getOKXPaperEngine();

  constructor(config: OKXConfig) {
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
    this.passphrase = config.passphrase;
    this.isSimulation = config.isSimulation ?? false;
    this.isPaper = config.isPaper ?? false;

    this.client = axios.create({
      baseURL: "https://www.okx.com",
      timeout: 10000,
    });

    if (this.isSimulation) {
      this.simulator = getOKXSimulator();
    }
  }

  getMode(): "simulation" | "paper" | "live" {
    if (this.isSimulation) return "simulation";
    if (this.isPaper) return "paper";
    return "live";
  }

  private sign(timestamp: string, method: string, requestPath: string, body?: string): string {
    const message = timestamp + method.toUpperCase() + requestPath + (body || "");
    return crypto.createHmac("sha256", this.secretKey).update(message).digest("base64");
  }

  private async fetchPublic<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const response = await this.client.get<OKXResponse<T>>(endpoint, { params });
    if (response.data.code !== "0") {
      throw new Error(`OKX API Error: ${response.data.msg}`);
    }
    return response.data.data;
  }

  private async request<T>(
    method: "GET" | "POST",
    endpoint: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const timestamp = new Date().toISOString();
    const requestPath =
      endpoint +
      (method === "GET" && params
        ? "?" + new URLSearchParams(params as Record<string, string>).toString()
        : "");
    const body = method === "POST" && params ? JSON.stringify(params) : undefined;
    const sign = this.sign(timestamp, method, endpoint, body);

    const response = await this.client.request<OKXResponse<T>>({
      method,
      url: requestPath,
      headers: {
        "OK-ACCESS-KEY": this.apiKey,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": this.passphrase,
        "Content-Type": "application/json",
      },
      data: body,
    });

    if (response.data.code !== "0") {
      throw new Error(`OKX API Error: ${response.data.msg}`);
    }
    return response.data.data;
  }

  private async syncPaperMarket(instId: string): Promise<MarketSnapshot> {
    const ticker = await this.getTicker(instId);
    return {
      bestBid: parseFloat(ticker.bidPx),
      bestAsk: parseFloat(ticker.askPx),
      last: parseFloat(ticker.last),
    };
  }

  async getBalance(): Promise<Array<{ ccy: string; availBal: string; frozenBal: string }>> {
    if (this.isSimulation && this.simulator) {
      return this.simulator.getBalance();
    }

    if (this.isPaper) {
      const b = this.paper.getBalance();
      const [base] = (await this.getTicker("BTC-USDT")).instId.split("-");
      void base;
      return [
        { ccy: "USDT", availBal: b.usdt.toFixed(2), frozenBal: b.frozenUsdt.toFixed(2) },
        { ccy: "BTC", availBal: b.base.toFixed(6), frozenBal: b.frozenBase.toFixed(6) },
      ];
    }

    return this.request("GET", "/api/v5/account/balance");
  }

  async getOrderBook(instId: string, sz: number = 20): Promise<{
    asks: Array<[string, string, string, string]>;
    bids: Array<[string, string, string, string]>;
    ts: string;
  }> {
    if (this.isSimulation && this.simulator) {
      const simBook = await this.simulator.getOrderBook(instId, sz);
      return {
        asks: simBook.asks.map(([price, size]) => [price.toFixed(2), size.toFixed(4), "0", "1"]),
        bids: simBook.bids.map(([price, size]) => [price.toFixed(2), size.toFixed(4), "0", "1"]),
        ts: simBook.ts.toString(),
      };
    }

    const data = await this.fetchPublic<
      Array<{
        asks: Array<[string, string, string, string]>;
        bids: Array<[string, string, string, string]>;
        ts: string;
      }>
    >("/api/v5/market/books", { instId, sz: sz.toString() });

    return data[0];
  }

  async getTicker(instId: string): Promise<{
    instId: string;
    last: string;
    lastSz: string;
    askPx: string;
    askSz: string;
    bidPx: string;
    bidSz: string;
    vol24h: string;
  }> {
    if (this.isSimulation && this.simulator) {
      const t = await this.simulator.getTicker(instId);
      return {
        instId: t.instId,
        last: t.last.toFixed(2),
        lastSz: t.lastSz.toFixed(4),
        askPx: t.askPx.toFixed(2),
        askSz: t.askSz.toFixed(4),
        bidPx: t.bidPx.toFixed(2),
        bidSz: t.bidSz.toFixed(4),
        vol24h: t.vol24h.toFixed(2),
      };
    }

    const data = await this.fetchPublic<
      Array<{
        instId: string;
        last: string;
        lastSz: string;
        askPx: string;
        askSz: string;
        bidPx: string;
        bidSz: string;
        vol24h: string;
      }>
    >("/api/v5/market/ticker", { instId });

    return data[0];
  }

  async getCandles(
    instId: string,
    bar = "1m",
    limit = 60
  ): Promise<Array<{ t: number; o: number; h: number; l: number; c: number }>> {
    if (this.isSimulation && this.simulator) {
      return this.simulator.getCandles(instId, bar, limit);
    }

    const data = await this.fetchPublic<string[][]>("/api/v5/market/candles", {
      instId,
      bar,
      limit: String(limit),
    });

    return data
      .map((row) => ({
        t: Number(row[0]),
        o: Number(row[1]),
        h: Number(row[2]),
        l: Number(row[3]),
        c: Number(row[4]),
      }))
      .reverse();
  }

  async placeLimitOrder(params: {
    instId: string;
    side: "buy" | "sell";
    price: string;
    size: string;
    tdMode?: "cash" | "cross" | "isolated";
  }): Promise<{ ordId: string; clOrdId: string; tag: string; sCode: string; sMsg: string }> {
    if (this.isSimulation && this.simulator) {
      const result = await this.simulator.placeLimitOrder(params);
      return { ...result, clOrdId: "", tag: "" };
    }

    if (this.isPaper) {
      const result = this.paper.placeLimitOrder(params);
      return { ...result, clOrdId: "", tag: "" };
    }

    const data = await this.request<
      Array<{ ordId: string; clOrdId: string; tag: string; sCode: string; sMsg: string }>
    >("POST", "/api/v5/trade/order", {
      instId: params.instId,
      tdMode: params.tdMode || "cash",
      side: params.side,
      ordType: "limit",
      px: params.price,
      sz: params.size,
    });
    return data[0];
  }

  async cancelOrder(instId: string, ordId: string): Promise<{
    ordId: string;
    clOrdId: string;
    sCode: string;
    sMsg: string;
  }> {
    if (this.isSimulation && this.simulator) {
      const result = await this.simulator.cancelOrder(instId, ordId);
      return { ...result, clOrdId: "" };
    }

    if (this.isPaper) {
      const result = this.paper.cancelOrder(instId, ordId);
      return { ...result, clOrdId: "" };
    }

    const data = await this.request<
      Array<{ ordId: string; clOrdId: string; sCode: string; sMsg: string }>
    >("POST", "/api/v5/trade/cancel-order", { instId, ordId });
    return data[0];
  }

  async getOpenOrders(instId?: string): Promise<Array<{
    ordId: string;
    instId: string;
    px: string;
    sz: string;
    side: string;
    state: string;
    accFillSz: string;
  }>> {
    if (this.isSimulation && this.simulator) {
      return this.simulator.getOpenOrders(instId);
    }

    if (this.isPaper) {
      if (instId) {
        const market = await this.syncPaperMarket(instId);
        this.paper.matchAgainstMarket(market);
      }
      return this.paper.getOpenOrders(instId);
    }

    return this.request("GET", "/api/v5/trade/orders-pending", instId ? { instId } : undefined);
  }

  getSimulator() {
    return this.isSimulation ? this.simulator : null;
  }

  getPaperEngine() {
    return this.isPaper ? this.paper : null;
  }

  async forcePaperSpike(instId: string, direction: "long" | "short"): Promise<boolean> {
    if (!this.isPaper) return false;
    const market = await this.syncPaperMarket(instId);
    return this.paper.forceFillNearestEntry(market, direction);
  }
}

export function createOKXClient(): OKXClient {
  const mode = getTradingMode();
  const apiKey = process.env.OKX_API_KEY ?? "";
  const secretKey = process.env.OKX_SECRET_KEY ?? "";
  const passphrase = process.env.OKX_PASSPHRASE ?? "";

  if (mode === "simulation") {
    console.log("⚠️  OKX: режим симуляции (фейковый стакан)");
    return new OKXClient({
      apiKey: "sim",
      secretKey: "sim",
      passphrase: "sim",
      isSimulation: true,
    });
  }

  if (mode === "paper") {
    console.log("📋 OKX: PAPER TRADING — реальный рынок, виртуальные сделки");
    return new OKXClient({
      apiKey,
      secretKey,
      passphrase,
      isPaper: true,
    });
  }

  console.log("🔴 OKX: LIVE TRADING — реальные ордера!");
  return new OKXClient({ apiKey, secretKey, passphrase });
}

export { getTradingMode };

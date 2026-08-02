/**
 * OKX Simulator — демо-режим без реальной торговли
 * Симулирует стакан с плотностями, прострелы и исполнение лимиток
 */

interface SimulatedOrder {
  id: string;
  price: number;
  size: number;
  side: "buy" | "sell";
  status: "pending" | "filled" | "cancelled";
  createdAt: number;
  filledAt?: number;
}

interface SimulatedTicker {
  instId: string;
  last: number;
  lastSz: number;
  askPx: number;
  askSz: number;
  bidPx: number;
  bidSz: number;
  vol24h: number;
}

interface SimulatedOrderBook {
  asks: Array<[number, number]>;
  bids: Array<[number, number]>;
  ts: number;
}

export interface SimulatedCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export class OKXSimulator {
  private orders: Map<string, SimulatedOrder> = new Map();
  private orderBook: SimulatedOrderBook;
  private ticker: SimulatedTicker;
  private orderCounter = 0;
  private candles: SimulatedCandle[] = [];
  private currentMinute = 0;

  constructor(tradingPair: string = "BTC-USDT", basePrice = 85000) {
    this.orderBook = this.buildOrderBookWithDensities(basePrice);
    const bestBid = this.orderBook.bids[0][0];
    const bestAsk = this.orderBook.asks[0][0];
    const mid = (bestBid + bestAsk) / 2;

    this.ticker = {
      instId: tradingPair,
      last: parseFloat(mid.toFixed(2)),
      lastSz: 0.1,
      askPx: parseFloat(bestAsk.toFixed(2)),
      askSz: parseFloat(this.orderBook.asks[0][1].toFixed(4)),
      bidPx: parseFloat(bestBid.toFixed(2)),
      bidSz: parseFloat(this.orderBook.bids[0][1].toFixed(4)),
      vol24h: 1200,
    };

    this.seedCandles(mid);

    setInterval(() => {
      this.microMove();
      this.tryFillOrders();
    }, 1500);
  }

  private buildOrderBookWithDensities(base: number): SimulatedOrderBook {
    const spread = 30;
    const bids: Array<[number, number]> = [];
    const asks: Array<[number, number]> = [];

    for (let i = 0; i < 15; i++) {
      const bidPrice = base - spread - i * 8;
      const askPrice = base + spread + i * 8;
      let bidSize = 0.05 + Math.random() * 0.1;
      const askSize = 0.05 + Math.random() * 0.1;

      if (i === 2) bidSize = 0.025;
      if (i === 6) bidSize = 0.04;

      bids.push([parseFloat(bidPrice.toFixed(2)), parseFloat(bidSize.toFixed(4))]);
      asks.push([parseFloat(askPrice.toFixed(2)), parseFloat(askSize.toFixed(4))]);
    }

    return {
      bids: bids.sort((a, b) => b[0] - a[0]),
      asks: asks.sort((a, b) => a[0] - b[0]),
      ts: Date.now(),
    };
  }

  private microMove(): void {
    const change = (Math.random() - 0.5) * 0.0008 * this.ticker.last;
    this.shiftBook(change);
    this.updateTicker();
  }

  private shiftBook(delta: number): void {
    this.orderBook.bids = this.orderBook.bids
      .map(([p, s]) => [parseFloat((p + delta).toFixed(2)), s] as [number, number])
      .sort((a, b) => b[0] - a[0]);
    this.orderBook.asks = this.orderBook.asks
      .map(([p, s]) => [parseFloat((p + delta).toFixed(2)), s] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    this.orderBook.ts = Date.now();
  }

  private updateTicker(): void {
    const bestBid = this.orderBook.bids[0][0];
    const bestAsk = this.orderBook.asks[0][0];
    const mid = (bestBid + bestAsk) / 2;
    this.ticker = {
      ...this.ticker,
      last: parseFloat(mid.toFixed(2)),
      askPx: parseFloat(bestAsk.toFixed(2)),
      askSz: this.orderBook.asks[0][1],
      bidPx: parseFloat(bestBid.toFixed(2)),
      bidSz: this.orderBook.bids[0][1],
    };
    this.pushCandle(mid);
  }

  private seedCandles(price: number): void {
    const now = Date.now();
    this.candles = [];
    for (let i = 59; i >= 0; i--) {
      const drift = (Math.random() - 0.5) * price * 0.002;
      const c = price + drift;
      const o = c + (Math.random() - 0.5) * price * 0.001;
      const h = Math.max(o, c) + Math.random() * price * 0.0005;
      const l = Math.min(o, c) - Math.random() * price * 0.0005;
      this.candles.push({
        t: now - i * 60_000,
        o: parseFloat(o.toFixed(2)),
        h: parseFloat(h.toFixed(2)),
        l: parseFloat(l.toFixed(2)),
        c: parseFloat(c.toFixed(2)),
      });
    }
    this.currentMinute = Math.floor(now / 60_000);
  }

  private pushCandle(price: number): void {
    const minute = Math.floor(Date.now() / 60_000);
    const p = parseFloat(price.toFixed(2));
    if (minute !== this.currentMinute) {
      this.currentMinute = minute;
      this.candles.push({ t: minute * 60_000, o: p, h: p, l: p, c: p });
      if (this.candles.length > 60) this.candles.shift();
      return;
    }
    const last = this.candles[this.candles.length - 1];
    if (!last) return;
    last.c = p;
    last.h = Math.max(last.h, p);
    last.l = Math.min(last.l, p);
  }

  private tryFillOrders(): void {
    const bestBid = this.orderBook.bids[0][0];
    const bestAsk = this.orderBook.asks[0][0];

    for (const order of this.orders.values()) {
      if (order.status !== "pending") continue;

      const filled =
        (order.side === "buy" && bestAsk <= order.price) ||
        (order.side === "sell" && bestBid >= order.price);

      if (filled) {
        order.status = "filled";
        order.filledAt = Date.now();
        console.log(`[Simulator] Filled ${order.side} ${order.size} @ ${order.price}`);
      }
    }
  }

  async getOrderBook(instId: string, sz: number = 20): Promise<SimulatedOrderBook> {
    return {
      ...this.orderBook,
      asks: this.orderBook.asks.slice(0, sz),
      bids: this.orderBook.bids.slice(0, sz),
    };
  }

  async getTicker(instId: string): Promise<SimulatedTicker> {
    void instId;
    return { ...this.ticker };
  }

  async getCandles(instId: string, bar = "1m", limit = 60): Promise<SimulatedCandle[]> {
    void instId;
    void bar;
    return this.candles.slice(-limit);
  }

  async placeLimitOrder(params: {
    instId: string;
    side: "buy" | "sell";
    price: string;
    size: string;
  }): Promise<{ ordId: string; sCode: string; sMsg: string }> {
    const orderId = `sim_${Date.now()}_${++this.orderCounter}`;
    const order: SimulatedOrder = {
      id: orderId,
      price: parseFloat(params.price),
      size: parseFloat(params.size),
      side: params.side,
      status: "pending",
      createdAt: Date.now(),
    };
    this.orders.set(orderId, order);
    return { ordId: orderId, sCode: "0", sMsg: "" };
  }

  async cancelOrder(instId: string, ordId: string): Promise<{
    ordId: string;
    sCode: string;
    sMsg: string;
  }> {
    void instId;
    const order = this.orders.get(ordId);
    if (order?.status === "pending") order.status = "cancelled";
    return { ordId, sCode: "0", sMsg: "" };
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
    void instId;
    return Array.from(this.orders.values())
      .filter((o) => o.status === "pending")
      .map((o) => ({
        ordId: o.id,
        instId: "BTC-USDT",
        px: o.price.toFixed(4),
        sz: o.size.toFixed(6),
        side: o.side,
        state: "live",
        accFillSz: "0",
      }));
  }

  async getBalance(): Promise<Array<{ ccy: string; availBal: string; frozenBal: string }>> {
    return [
      { ccy: "USDT", availBal: "500.00", frozenBal: "150.00" },
      { ccy: "BTC", availBal: "0.005", frozenBal: "0.001" },
    ];
  }

  simulateSpreadShot(side: "buy" | "sell", intensity = 1): void {
    const movePct = (0.001 + Math.random() * 0.002) * intensity;

    if (side === "sell") {
      this.shiftBook(-this.ticker.last * movePct);
    } else {
      this.shiftBook(this.ticker.last * movePct);
    }

    this.updateTicker();
    this.tryFillOrders();
    console.log(`[Simulator] Spread shot ${side} · last=${this.ticker.last}`);
  }
}

let simulator: OKXSimulator | null = null;

export function getOKXSimulator(): OKXSimulator {
  if (!simulator) {
    simulator = new OKXSimulator();
    console.log("[OKX Simulator] Started in DEMO mode");
  }
  return simulator;
}

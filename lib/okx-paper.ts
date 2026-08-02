/**
 * Paper Trading — реальный стакан OKX, виртуальные ордера и P&L
 */

export interface PaperOrder {
  id: string;
  instId: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  status: "pending" | "filled" | "cancelled";
  createdAt: number;
  filledAt?: number;
}

export interface PaperTrade {
  id: string;
  side: "buy" | "sell";
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnlUsd: number;
  pnlPct: number;
  feesUsd: number;
  openedAt: number;
  closedAt: number;
}

export interface PaperBalance {
  usdt: number;
  base: number;
  frozenUsdt: number;
  frozenBase: number;
}

export interface MarketSnapshot {
  bestBid: number;
  bestAsk: number;
  last: number;
}

export class OKXPaperEngine {
  private orders = new Map<string, PaperOrder>();
  private counter = 0;
  private balance: PaperBalance;
  private trades: PaperTrade[] = [];
  private openEntry: { side: "buy" | "sell"; price: number; size: number; openedAt: number } | null =
    null;
  private feePct: number;

  constructor(startUsdt = 1000, feePct = 0.08) {
    this.balance = { usdt: startUsdt, base: 0, frozenUsdt: 0, frozenBase: 0 };
    this.feePct = feePct;
  }

  getTradeHistory(): PaperTrade[] {
    return [...this.trades];
  }

  getBalance(): PaperBalance {
    return { ...this.balance };
  }

  getStats() {
    const wins = this.trades.filter((t) => t.pnlUsd > 0).length;
    const losses = this.trades.filter((t) => t.pnlUsd <= 0).length;
    const netProfit = this.trades.reduce((s, t) => s + t.pnlUsd, 0);
    const totalFees = this.trades.reduce((s, t) => s + t.feesUsd, 0);
    return {
      totalTrades: this.trades.length,
      wins,
      losses,
      winRate: this.trades.length ? Math.round((wins / this.trades.length) * 100) : 0,
      netProfit,
      totalFees,
    };
  }

  reset(startUsdt = 1000): void {
    this.orders.clear();
    this.trades = [];
    this.openEntry = null;
    this.balance = { usdt: startUsdt, base: 0, frozenUsdt: 0, frozenBase: 0 };
  }

  /** Сопоставление виртуальных ордеров с реальным рынком */
  matchAgainstMarket(market: MarketSnapshot): string[] {
    const filled: string[] = [];

    for (const order of this.orders.values()) {
      if (order.status !== "pending") continue;

      const hit =
        order.side === "buy"
          ? market.bestAsk <= order.price || market.last <= order.price
          : market.bestBid >= order.price || market.last >= order.price;

      if (hit) {
        order.status = "filled";
        order.filledAt = Date.now();
        filled.push(order.id);
        this.applyFill(order);
      }
    }

    return filled;
  }

  /** Принудительный прострел для теста — цена бьёт в ближайшую entry-лимитку */
  forceFillNearestEntry(market: MarketSnapshot, direction: "long" | "short"): boolean {
    const pending = Array.from(this.orders.values()).filter((o) => o.status === "pending");
    const entry = pending.find((o) =>
      direction === "long" ? o.side === "buy" : o.side === "sell"
    );
    if (!entry) return false;

    // Симулируем касание лимитки реальной ценой
    const snap: MarketSnapshot =
      direction === "long"
        ? { ...market, bestAsk: entry.price, last: entry.price }
        : { ...market, bestBid: entry.price, last: entry.price };

    this.matchAgainstMarket(snap);
    return true;
  }

  private applyFill(order: PaperOrder): void {
    const notional = order.price * order.size;
    const fee = (notional * this.feePct) / 100;

    if (order.side === "buy") {
      this.balance.usdt -= notional + fee;
      this.balance.base += order.size;
      this.openEntry = { side: "buy", price: order.price, size: order.size, openedAt: Date.now() };
    } else if (this.openEntry) {
      const entry = this.openEntry;
      const rawPnl =
        entry.side === "buy"
          ? ((order.price - entry.price) / entry.price) * 100
          : ((entry.price - order.price) / entry.price) * 100;
      const pnlPct = rawPnl - this.feePct * 2;
      const pnlUsd = (notional * pnlPct) / 100;

      this.balance.usdt += notional - fee;
      this.balance.base -= order.size;

      this.trades.push({
        id: `trade_${Date.now()}`,
        side: entry.side,
        entryPrice: entry.price,
        exitPrice: order.price,
        size: order.size,
        pnlUsd,
        pnlPct,
        feesUsd: fee + (entry.price * order.size * this.feePct) / 100,
        openedAt: entry.openedAt,
        closedAt: Date.now(),
      });

      this.openEntry = null;
    }
  }

  placeLimitOrder(params: {
    instId: string;
    side: "buy" | "sell";
    price: string;
    size: string;
  }): { ordId: string; sCode: string; sMsg: string } {
    const id = `paper_${Date.now()}_${++this.counter}`;
    const price = parseFloat(params.price);
    const size = parseFloat(params.size);
    const notional = price * size;

    if (params.side === "buy" && this.balance.usdt < notional * 1.01) {
      throw new Error("Недостаточно USDT на paper-счёте");
    }
    if (params.side === "sell" && this.balance.base < size) {
      throw new Error("Недостаточно монеты на paper-счёте");
    }

    this.orders.set(id, {
      id,
      instId: params.instId,
      side: params.side,
      price,
      size,
      status: "pending",
      createdAt: Date.now(),
    });

    return { ordId: id, sCode: "0", sMsg: "" };
  }

  cancelOrder(_instId: string, ordId: string): { ordId: string; sCode: string; sMsg: string } {
    const order = this.orders.get(ordId);
    if (order?.status === "pending") order.status = "cancelled";
    return { ordId, sCode: "0", sMsg: "" };
  }

  getOpenOrders(instId?: string): Array<{
    ordId: string;
    instId: string;
    px: string;
    sz: string;
    side: string;
    state: string;
    accFillSz: string;
  }> {
    return Array.from(this.orders.values())
      .filter((o) => o.status === "pending" && (!instId || o.instId === instId))
      .map((o) => ({
        ordId: o.id,
        instId: o.instId,
        px: o.price.toFixed(4),
        sz: o.size.toFixed(6),
        side: o.side,
        state: "live",
        accFillSz: "0",
      }));
  }

  hasOpenPosition(): boolean {
    return this.openEntry !== null;
  }
}

let engine: OKXPaperEngine | null = null;

export function getOKXPaperEngine(): OKXPaperEngine {
  if (!engine) {
    const start = parseFloat(process.env.OKX_PAPER_BALANCE ?? "1000");
    engine = new OKXPaperEngine(start);
    console.log(`[OKX Paper] Virtual balance: $${start}`);
  }
  return engine;
}

export function getTradingMode(): "simulation" | "paper" | "live" {
  const hasKeys =
    process.env.OKX_API_KEY && process.env.OKX_SECRET_KEY && process.env.OKX_PASSPHRASE;
  if (process.env.OKX_SIMULATION === "true" || !hasKeys) return "simulation";
  if (process.env.OKX_TRADING === "true") return "live";
  return "paper";
}

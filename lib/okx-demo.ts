/**
 * OKX demo trading ("paper" account): every Telegram signal is also opened there, so the real fill
 * price, fees and exit can be compared with the lab's calculated result.
 *
 * DEMO ONLY. Requests always carry `x-simulated-trading: 1`, and the client refuses to start unless
 * OKX_DEMO=true — it can never touch a live account. Keys: OKX_API_KEY / OKX_SECRET_KEY /
 * OKX_PASSPHRASE created under OKX → Demo trading → API. Position size: OKX_DEMO_NOTIONAL_USD (100).
 */

import crypto from "crypto";
import axios, { type AxiosInstance } from "axios";

const BASE = "https://www.okx.com";

export interface DemoConfig {
  key: string;
  secret: string;
  passphrase: string;
  notionalUsd: number;
}

export function demoConfig(env: Record<string, string | undefined> = process.env): DemoConfig | null {
  if (env.OKX_DEMO?.trim().toLowerCase() !== "true") return null;
  const key = env.OKX_API_KEY?.trim();
  const secret = env.OKX_SECRET_KEY?.trim();
  const passphrase = env.OKX_PASSPHRASE?.trim();
  if (!key || !secret || !passphrase || key.startsWith("your_")) return null;
  const notionalUsd = Number(env.OKX_DEMO_NOTIONAL_USD ?? 100);
  return { key, secret, passphrase, notionalUsd: notionalUsd > 0 ? notionalUsd : 100 };
}

/** BTCUSDT → BTC-USDT-SWAP */
export function swapInstId(symbol: string): string {
  return `${symbol.replace(/USDT$/, "")}-USDT-SWAP`;
}

interface Instrument {
  ctVal: number;
  lotSz: number;
  minSz: number;
  tickSz: number;
}

/** Rounds down to a multiple of `step` without floating-point dust. */
function floorTo(v: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number((Math.floor(v / step + 1e-9) * step).toFixed(decimals));
}

function roundTo(v: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number((Math.round(v / step) * step).toFixed(decimals));
}

export interface DemoOpen {
  ordId: string;
  instId: string;
  entry: number;
  contracts: number;
  notionalUsd: number;
}

export interface DemoSettlement {
  entry: number;
  exit: number;
  /** Realised result incl. fees and funding, as basis points of the position's notional */
  netBp: number;
}

export class OkxDemo {
  private instruments = new Map<string, Instrument>();
  private posMode: string | null = null;

  constructor(
    private readonly cfg: DemoConfig,
    private readonly http: AxiosInstance = axios.create({ baseURL: BASE, timeout: 15_000 }),
    private readonly now: () => Date = () => new Date()
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T[]> {
    const ts = this.now().toISOString();
    const payload = body ? JSON.stringify(body) : "";
    const sign = crypto.createHmac("sha256", this.cfg.secret).update(ts + method + path + payload).digest("base64");
    const { data } = await this.http.request<{ code: string; msg: string; data: T[] }>({
      method,
      url: path,
      data: body,
      headers: {
        "OK-ACCESS-KEY": this.cfg.key,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": this.cfg.passphrase,
        "x-simulated-trading": "1",
        "Content-Type": "application/json",
      },
    });
    if (data.code !== "0") {
      const detail = (data.data as Array<{ sMsg?: string }> | undefined)?.[0]?.sMsg;
      throw new Error(`OKX ${path}: ${data.msg || detail || data.code}`);
    }
    return data.data;
  }

  private async instrument(instId: string): Promise<Instrument> {
    const hit = this.instruments.get(instId);
    if (hit) return hit;
    const [i] = await this.call<Record<string, string>>("GET", `/api/v5/public/instruments?instType=SWAP&instId=${instId}`);
    if (!i) throw new Error(`на OKX нет контракта ${instId}`);
    const inst = { ctVal: Number(i.ctVal), lotSz: Number(i.lotSz), minSz: Number(i.minSz), tickSz: Number(i.tickSz) };
    this.instruments.set(instId, inst);
    return inst;
  }

  /** long_short_mode needs posSide on every order; net_mode must not have it. */
  private async posSide(side: "LONG" | "SHORT"): Promise<Record<string, string>> {
    if (!this.posMode) this.posMode = (await this.call<{ posMode: string }>("GET", "/api/v5/account/config"))[0]?.posMode ?? "net_mode";
    return this.posMode === "long_short_mode" ? { posSide: side === "LONG" ? "long" : "short" } : {};
  }

  /** Market entry with the take-profit (limit) and stop (market) attached on the exchange. */
  async open(symbol: string, side: "LONG" | "SHORT", price: number, tp: number, sl: number): Promise<DemoOpen> {
    const instId = swapInstId(symbol);
    const inst = await this.instrument(instId);
    const contracts = floorTo(this.cfg.notionalUsd / (inst.ctVal * price), inst.lotSz);
    if (contracts < inst.minSz) throw new Error(`позиция ${this.cfg.notionalUsd}$ меньше минимального лота ${instId}`);
    const [order] = await this.call<{ ordId: string }>("POST", "/api/v5/trade/order", {
      instId,
      tdMode: "cross",
      side: side === "LONG" ? "buy" : "sell",
      ordType: "market",
      sz: String(contracts),
      ...(await this.posSide(side)),
      attachAlgoOrds: [
        {
          tpTriggerPx: String(roundTo(tp, inst.tickSz)),
          tpOrdPx: String(roundTo(tp, inst.tickSz)),
          slTriggerPx: String(roundTo(sl, inst.tickSz)),
          slOrdPx: "-1",
        },
      ],
    });
    const [filled] = await this.call<{ avgPx: string }>("GET", `/api/v5/trade/order?instId=${instId}&ordId=${order.ordId}`);
    const entry = Number(filled?.avgPx) || price;
    return { ordId: order.ordId, instId, entry, contracts, notionalUsd: contracts * inst.ctVal * entry };
  }

  async isOpen(instId: string): Promise<boolean> {
    const positions = await this.call<{ pos: string }>("GET", `/api/v5/account/positions?instType=SWAP&instId=${instId}`);
    return positions.some((p) => Number(p.pos) !== 0);
  }

  /** Closes what is left of the position (time exit) and cancels its attached TP/SL. */
  async close(instId: string, side: "LONG" | "SHORT"): Promise<void> {
    if (!(await this.isOpen(instId))) return;
    await this.call("POST", "/api/v5/trade/close-position", { instId, mgnMode: "cross", autoCxl: true, ...(await this.posSide(side)) });
  }

  /** Result of the position opened at or after `openedAt`, once OKX has recorded it as closed. */
  async settlement(instId: string, openedAt: number): Promise<DemoSettlement | null> {
    const rows = await this.call<Record<string, string>>("GET", `/api/v5/account/positions-history?instType=SWAP&instId=${instId}`);
    const pos = rows
      .filter((r) => Number(r.cTime) >= openedAt - 60_000)
      .sort((a, b) => Number(a.cTime) - Number(b.cTime))[0];
    if (!pos) return null;
    const entry = Number(pos.openAvgPx);
    const exit = Number(pos.closeAvgPx);
    const inst = await this.instrument(instId);
    const notional = Number(pos.closeTotalPos) * inst.ctVal * entry;
    // realizedPnl already includes trading fees and funding.
    const netBp = notional > 0 ? (Number(pos.realizedPnl) / notional) * 1e4 : 0;
    return { entry, exit, netBp };
  }
}

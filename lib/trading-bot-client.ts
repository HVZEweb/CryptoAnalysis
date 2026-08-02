const TRADING_HTTP_HOST = process.env.TRADING_HTTP_HOST ?? process.env.BOT_HTTP_HOST ?? "127.0.0.1";
const TRADING_HTTP_PORT = Number(process.env.TRADING_HTTP_PORT ?? process.env.BOT_HTTP_PORT ?? 8765);
const BASE = `http://${TRADING_HTTP_HOST}:${TRADING_HTTP_PORT}`;

export type TradingStrategy = "meta" | "hft_orderbook" | "quant_scalping" | "ai_predictor";

export interface TradingBotStatus {
  running: boolean;
  mode: string;
  active_strategy: string;
  uptime_sec: number;
  equity: number;
  drawdown_pct: number;
  open_positions: number;
  universe: Array<{ symbol: string; score: number; reason: string }>;
  stats: {
    scans: number;
    signals: number;
    trades_opened: number;
    net_pnl_usd: number;
  };
  config: {
    mode: string;
    active_strategy: string;
    enabled_strategies: string[];
    leverage: number;
    min_score: number;
    min_ev_usd: number;
    max_positions: number;
    notional_usd: number;
    ai_min_confidence: number;
  };
  last_error: string | null;
  emergency_stop: boolean;
  source?: "live" | "database";
  process_running?: boolean;
}

export interface TradingTrade {
  trade_uuid: string;
  symbol: string;
  side: string;
  strategy: string;
  status: string;
  entry_price: number;
  exit_price: number | null;
  size: number;
  notional_usd: number;
  leverage?: number;
  pnl_usd: number;
  pnl_pct?: number;
  fees_usd?: number;
  slippage_pct?: number;
  slippage_usd?: number;
  confidence: number;
  expected_value: number;
  risk_decision: string;
  entry_reason: string;
  exit_reason: string;
  ai_probability: number | null;
  funding_rate?: number;
  open_interest?: number;
  spread_pct?: number;
  volatility_pct?: number;
  hold_ms: number;
  hold_min?: number;
  opened_at: string | null;
  closed_at: string | null;
  signals?: Record<string, unknown>;
  book_snapshot?: Record<string, unknown>;
  market_context?: Record<string, unknown>;
  exit_context?: Record<string, unknown>;
}

export interface StrategyAnalytics {
  strategy: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl_usd: number;
  profit_factor: number;
  expectancy_usd: number;
  avg_win_usd: number;
  avg_loss_usd: number;
  avg_pnl_usd: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  calmar_ratio: number;
  max_drawdown_pct: number;
  recovery_factor: number;
  avg_hold_min: number;
  avg_ev: number;
  avg_confidence: number;
}

export interface TradingAnalytics {
  computed_at: string;
  total_trades: number;
  closed_trades: number;
  open_trades: number;
  overall: StrategyAnalytics;
  by_strategy: Record<string, StrategyAnalytics>;
  equity_curve: number[];
  recent_trades: TradingTrade[];
  snapshots?: Array<{
    computed_at: string | null;
    strategy: string;
    trades: number;
    win_rate: number;
    profit_factor: number;
    total_pnl_usd: number;
  }>;
  source?: "live" | "database";
}

export interface TradingPosition {
  trade_id: string;
  symbol: string;
  side: string;
  strategy: string;
  entry_price: number;
  size: number;
  notional_usd: number;
  stop_loss: number;
  take_profit: number;
}

export async function pingTradingBot(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchTradingBotStatus(): Promise<TradingBotStatus | null> {
  try {
    const res = await fetch(`${BASE}/status`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return { ...data, source: "live" as const };
  } catch {
    return null;
  }
}

export async function fetchTradingTrades(limit = 25): Promise<TradingTrade[]> {
  try {
    const res = await fetch(`${BASE}/trades?limit=${limit}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.trades ?? [];
  } catch {
    return [];
  }
}

export async function fetchTradingAnalytics(
  strategy?: TradingStrategy | "all",
  limit = 500
): Promise<TradingAnalytics | null> {
  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (strategy && strategy !== "all") params.set("strategy", strategy);
    const res = await fetch(`${BASE}/analytics?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    return { ...data, source: "live" as const };
  } catch {
    return null;
  }
}

export async function fetchTradingPositions(): Promise<TradingPosition[]> {
  try {
    const res = await fetch(`${BASE}/positions`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.positions ?? [];
  } catch {
    return [];
  }
}

export async function stopTradingBotHttp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/stop`, { method: "POST", signal: AbortSignal.timeout(10000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function setTradingMode(mode: "paper" | "live", strategy?: TradingStrategy): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, strategy }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function updateTradingConfig(config: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const TAB_TO_STRATEGY: Record<string, TradingStrategy> = {
  hft: "hft_orderbook",
  quant: "quant_scalping",
  predictor: "ai_predictor",
};

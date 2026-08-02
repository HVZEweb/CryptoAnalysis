import { query } from "@/lib/db";
import type { TradingAnalytics, TradingBotStatus, TradingTrade, StrategyAnalytics } from "@/lib/trading-bot-client";
import { isTradingBotProcessRunning } from "@/lib/trading-bot-process";

async function tableExists(): Promise<boolean> {
  try {
    const rows = await query<Array<{ c: number }>>(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'trading_trades'`,
      [process.env.DB_NAME ?? "crypto_predictor"]
    );
    return (rows[0]?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

function emptyAnalytics(): TradingAnalytics {
  const overall: StrategyAnalytics = {
    strategy: "all",
    trades: 0,
    wins: 0,
    losses: 0,
    win_rate: 0,
    total_pnl_usd: 0,
    profit_factor: 0,
    expectancy_usd: 0,
    avg_win_usd: 0,
    avg_loss_usd: 0,
    avg_pnl_usd: 0,
    sharpe_ratio: 0,
    sortino_ratio: 0,
    calmar_ratio: 0,
    max_drawdown_pct: 0,
    recovery_factor: 0,
    avg_hold_min: 0,
    avg_ev: 0,
    avg_confidence: 0,
  };
  return {
    computed_at: new Date().toISOString(),
    total_trades: 0,
    closed_trades: 0,
    open_trades: 0,
    overall,
    by_strategy: {},
    equity_curve: [1],
    recent_trades: [],
    source: "database",
  };
}

function aggregateFromTrades(closed: TradingTrade[], label: string): StrategyAnalytics {
  if (!closed.length) return { ...emptyAnalytics().overall, strategy: label };

  const pnls = closed.map((t) => Number(t.pnl_usd ?? 0));
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const winRate = (wins.length / closed.length) * 100;
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const lossRate = losses.length / closed.length;
  const winR = wins.length / closed.length;

  return {
    strategy: label,
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: Math.round(winRate * 100) / 100,
    total_pnl_usd: Math.round(pnls.reduce((a, b) => a + b, 0) * 10000) / 10000,
    profit_factor: Math.round((grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 10 : 0) * 1000) / 1000,
    expectancy_usd: Math.round((winR * avgWin + lossRate * avgLoss) * 10000) / 10000,
    avg_win_usd: Math.round(avgWin * 10000) / 10000,
    avg_loss_usd: Math.round(avgLoss * 10000) / 10000,
    avg_pnl_usd: Math.round((pnls.reduce((a, b) => a + b, 0) / closed.length) * 10000) / 10000,
    sharpe_ratio: 0,
    sortino_ratio: 0,
    calmar_ratio: 0,
    max_drawdown_pct: 0,
    recovery_factor: 0,
    avg_hold_min: Math.round(
      (closed.reduce((s, t) => s + Number(t.hold_ms ?? 0), 0) / closed.length / 60_000) * 100
    ) / 100,
    avg_ev: Math.round(
      (closed.reduce((s, t) => s + Number(t.expected_value ?? 0), 0) / closed.length) * 10000
    ) / 10000,
    avg_confidence: Math.round(
      (closed.reduce((s, t) => s + Number(t.confidence ?? 0), 0) / closed.length) * 10
    ) / 10,
  };
}

export async function getTradingAnalyticsFromDb(strategy?: string): Promise<TradingAnalytics> {
  if (!(await tableExists())) return emptyAnalytics();

  const strategyFilter = strategy && strategy !== "all" ? " AND strategy = ?" : "";
  const params: Array<string | number> = strategy && strategy !== "all" ? [strategy, 500] : [500];

  const trades = await query<TradingTrade[]>(
    `SELECT trade_uuid, symbol, side, strategy, status, entry_price, exit_price,
            size, notional_usd, leverage, pnl_usd, pnl_pct, fees_usd, slippage_pct, slippage_usd,
            confidence, expected_value, risk_decision, entry_reason, exit_reason,
            ai_probability, funding_rate, open_interest, spread_pct, volatility_pct,
            hold_ms, opened_at, closed_at
     FROM trading_trades WHERE 1=1${strategyFilter}
     ORDER BY opened_at DESC LIMIT ?`,
    params
  );

  const closed = trades.filter((t) => t.status === "closed");
  const openTrades = trades.filter((t) => t.status === "open");
  const strategies = [...new Set(closed.map((t) => t.strategy))];
  const byStrategy: Record<string, StrategyAnalytics> = {};
  for (const strat of strategies) {
    byStrategy[strat] = aggregateFromTrades(
      closed.filter((t) => t.strategy === strat),
      strat
    );
  }

  let snapshots: TradingAnalytics["snapshots"] = [];
  try {
    snapshots = await query(
      `SELECT computed_at, strategy, trades, win_rate, profit_factor, total_pnl_usd
       FROM trading_analytics ORDER BY computed_at DESC LIMIT 20`
    );
  } catch {
    // table may not exist yet
  }

  return {
    computed_at: new Date().toISOString(),
    total_trades: trades.length,
    closed_trades: closed.length,
    open_trades: openTrades.length,
    overall: aggregateFromTrades(closed, "all"),
    by_strategy: byStrategy,
    equity_curve: [1],
    recent_trades: trades.slice(0, 20),
    snapshots,
    source: "database",
  };
}

export async function getTradingTrades(limit = 25): Promise<TradingTrade[]> {
  if (!(await tableExists())) return [];
  return query<TradingTrade[]>(
    `SELECT trade_uuid, symbol, side, strategy, status, entry_price, exit_price,
            size, notional_usd, leverage, pnl_usd, pnl_pct, fees_usd, slippage_pct, slippage_usd,
            confidence, expected_value, risk_decision, entry_reason, exit_reason,
            ai_probability, funding_rate, open_interest, spread_pct, volatility_pct,
            hold_ms, hold_ms / 60000 AS hold_min, opened_at, closed_at
     FROM trading_trades ORDER BY opened_at DESC LIMIT ?`,
    [limit]
  );
}

export async function getTradingStatusFromDb(): Promise<TradingBotStatus> {
  const empty: TradingBotStatus = {
    running: false,
    mode: process.env.TRADING_MODE ?? "paper",
    active_strategy: process.env.TRADING_ACTIVE_STRATEGY ?? "meta",
    uptime_sec: 0,
    equity: Number(process.env.TRADING_PAPER_BALANCE ?? 1000),
    drawdown_pct: 0,
    open_positions: 0,
    universe: [],
    stats: { scans: 0, signals: 0, trades_opened: 0, net_pnl_usd: 0 },
    config: {
      mode: process.env.TRADING_MODE ?? "paper",
      active_strategy: process.env.TRADING_ACTIVE_STRATEGY ?? "meta",
      enabled_strategies: ["hft_orderbook", "quant_scalping", "ai_predictor"],
      leverage: Number(process.env.TRADING_LEVERAGE ?? 5),
      min_score: Number(process.env.TRADING_MIN_SCORE ?? 75),
      min_ev_usd: Number(process.env.TRADING_MIN_EV_USD ?? 0.05),
      max_positions: Number(process.env.TRADING_MAX_POSITIONS ?? 3),
      notional_usd: Number(process.env.TRADING_NOTIONAL_USD ?? 25),
      ai_min_confidence: Number(process.env.TRADING_AI_MIN_CONFIDENCE ?? 60),
    },
    last_error: null,
    emergency_stop: process.env.TRADING_EMERGENCY_STOP === "true",
    source: "database",
    process_running: isTradingBotProcessRunning(),
  };

  if (!(await tableExists())) return empty;

  const openRows = await query<Array<{ c: number }>>(
    `SELECT COUNT(*) AS c FROM trading_trades WHERE status = 'open'`
  );
  const pnlRows = await query<Array<{ pnl: number; trades: number }>>(
    `SELECT COALESCE(SUM(pnl_usd), 0) AS pnl, COUNT(*) AS trades FROM trading_trades WHERE status = 'closed'`
  );

  return {
    ...empty,
    running: isTradingBotProcessRunning(),
    open_positions: Number(openRows[0]?.c ?? 0),
    stats: {
      ...empty.stats,
      trades_opened: Number(pnlRows[0]?.trades ?? 0),
      net_pnl_usd: Number(pnlRows[0]?.pnl ?? 0),
    },
    process_running: isTradingBotProcessRunning(),
  };
}

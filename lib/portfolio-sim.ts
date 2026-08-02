import type { Candle, PredictionDirection } from "@/types";

export type TradeExitReason = "tp" | "sl" | "time" | "skipped";

export interface TradeSimulationInput {
  symbol: string;
  direction: PredictionDirection;
  timeframe: string;
  entry: number;
  tp: number;
  sl: number;
  candles: Candle[];
  actualPrice: number;
  completed: boolean;
}

export interface TradeSimulationResult {
  symbol: string;
  direction: PredictionDirection;
  timeframe: string;
  status: "completed" | "in_progress" | "skipped";
  exitReason: TradeExitReason;
  entry: number;
  exitPrice: number;
  pnlPct: number;
  pnlUsd: number;
}

export interface PortfolioSummary {
  totalTrades: number;
  evaluatedTrades: number;
  skippedTrades: number;
  inProgressTrades: number;
  completedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  totalPnlPct: number;
  totalPnlUsd: number;
  avgPnlPct: number;
  compoundedReturnPct: number;
  virtualBalanceStart: number;
  virtualBalanceEnd: number;
  marginUsd: number;
  leverage: number;
  notionalUsd: number;
  avgScore: number;
  interimPnlUsd: number;
  trades: TradeSimulationResult[];
}

const FEE_PCT = 0.08;

function resolveExit(
  direction: PredictionDirection,
  entry: number,
  tp: number,
  sl: number,
  candles: Candle[],
  actualPrice: number,
  completed: boolean
): { exitPrice: number; exitReason: TradeExitReason } {
  if (direction === "SIDEWAYS") {
    return { exitPrice: actualPrice, exitReason: "time" };
  }

  for (const c of candles) {
    if (direction === "LONG") {
      const slHit = c.low <= sl;
      const tpHit = c.high >= tp;
      if (slHit) return { exitPrice: sl, exitReason: "sl" };
      if (tpHit) return { exitPrice: tp, exitReason: "tp" };
    } else {
      const slHit = c.high >= sl;
      const tpHit = c.low <= tp;
      if (slHit) return { exitPrice: sl, exitReason: "sl" };
      if (tpHit) return { exitPrice: tp, exitReason: "tp" };
    }
  }

  if (completed || actualPrice > 0) {
    return { exitPrice: actualPrice, exitReason: "time" };
  }

  return { exitPrice: entry, exitReason: "time" };
}

function calcPnlPct(direction: PredictionDirection, entry: number, exit: number): number {
  if (!entry || entry <= 0) return 0;
  if (direction === "LONG") return ((exit - entry) / entry) * 100;
  if (direction === "SHORT") return ((entry - exit) / entry) * 100;
  return ((exit - entry) / entry) * 100;
}

export function simulateTrade(
  input: TradeSimulationInput,
  notionalUsd: number
): TradeSimulationResult {
  const { symbol, direction, timeframe, entry, tp, sl, candles, actualPrice, completed } = input;

  if (
    !entry ||
    entry <= 0 ||
    direction === "SIDEWAYS" ||
    !tp ||
    !sl ||
    tp <= 0 ||
    sl <= 0
  ) {
    return {
      symbol,
      direction,
      timeframe,
      status: "skipped",
      exitReason: "skipped",
      entry: entry || 0,
      exitPrice: entry || 0,
      pnlPct: 0,
      pnlUsd: 0,
    };
  }

  const { exitPrice, exitReason } = resolveExit(
    direction,
    entry,
    tp,
    sl,
    candles,
    actualPrice,
    completed
  );

  const rawPnl = calcPnlPct(direction, entry, exitPrice);
  const pnlPct = rawPnl - FEE_PCT;
  const pnlUsd = (notionalUsd * pnlPct) / 100;

  return {
    symbol,
    direction,
    timeframe,
    status: completed ? "completed" : "in_progress",
    exitReason,
    entry,
    exitPrice,
    pnlPct,
    pnlUsd,
  };
}

export function aggregatePortfolio(
  trades: TradeSimulationResult[],
  scores: number[],
  notionalUsd: number,
  virtualStart = 10_000,
  marginUsd = notionalUsd,
  leverage = 1
): PortfolioSummary {
  const evaluated = trades.filter((t) => t.status !== "skipped");
  const completed = trades.filter((t) => t.status === "completed");
  const inProgress = trades.filter((t) => t.status === "in_progress");
  const skipped = trades.filter((t) => t.status === "skipped");

  const wins = completed.filter((t) => t.pnlPct > 0.05).length;
  const losses = completed.filter((t) => t.pnlPct < -0.05).length;
  const breakeven = completed.length - wins - losses;

  const totalPnlUsdCompleted = completed.reduce((s, t) => s + t.pnlUsd, 0);
  const totalPnlPctCompleted = completed.reduce((s, t) => s + t.pnlPct, 0);
  const interimPnlUsd = inProgress.reduce((s, t) => s + t.pnlUsd, 0);

  const totalPnlUsd = totalPnlUsdCompleted;
  const totalPnlPct = totalPnlPctCompleted;
  const avgPnlPct = completed.length ? totalPnlPctCompleted / completed.length : 0;

  let balance = virtualStart;
  for (const t of completed) {
    balance += (balance * t.pnlPct) / 100;
  }

  const scored = scores.filter((s) => s > 0);
  const avgScore = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0;

  return {
    totalTrades: trades.length,
    evaluatedTrades: evaluated.length,
    skippedTrades: skipped.length,
    inProgressTrades: inProgress.length,
    completedTrades: completed.length,
    wins,
    losses,
    breakeven,
    winRate: completed.length ? Math.round((wins / completed.length) * 100) : 0,
    totalPnlPct,
    totalPnlUsd,
    avgPnlPct,
    compoundedReturnPct: virtualStart > 0 ? ((balance - virtualStart) / virtualStart) * 100 : 0,
    virtualBalanceStart: virtualStart,
    virtualBalanceEnd: balance,
    marginUsd,
    leverage,
    notionalUsd,
    avgScore,
    interimPnlUsd,
    trades,
  };
}

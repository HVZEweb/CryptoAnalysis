import type { BacktestMetrics, BacktestTrade, RegimePerformanceStats } from "@/lib/backtesting/types";
import type { MarketRegimeType, Timeframe } from "@/types";

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

/** Max peak-to-trough drawdown on cumulative returns (%) */
export function computeMaxDrawdownPct(returns: number[]): number {
  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  for (const r of returns) {
    equity += r;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

export function computeBacktestMetrics(
  trades: BacktestTrade[],
  timeframe: Timeframe
): BacktestMetrics {
  const returns = trades.map((t) => t.returnPct);
  const wins = trades.filter((t) => t.won);
  const losses = trades.filter((t) => !t.won && t.direction !== "SIDEWAYS");
  const grossProfit = wins.reduce((s, t) => s + Math.max(0, t.returnPct), 0);
  const grossLoss = losses.reduce((s, t) => s + Math.abs(Math.min(0, t.returnPct)), 0);

  const winRate = trades.length ? wins.length / trades.length : 0;
  const avgReturn = mean(returns);
  const stdev = stdDev(returns);
  const sharpe = stdev > 0 ? (avgReturn / stdev) * Math.sqrt(252) : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  const expectancy = avgReturn;

  const byRegime = new Map<MarketRegimeType, BacktestTrade[]>();
  for (const t of trades) {
    const arr = byRegime.get(t.regime) ?? [];
    arr.push(t);
    byRegime.set(t.regime, arr);
  }

  const accuracyByRegime: RegimePerformanceStats[] = [...byRegime.entries()].map(([regime, ts]) => ({
    regime,
    trades: ts.length,
    winRate: ts.filter((x) => x.won).length / Math.max(1, ts.length),
    avgReturnPct: mean(ts.map((x) => x.returnPct)),
    llmWinRate: ts.filter((x) => x.llmCorrect).length / Math.max(1, ts.length),
    mlWinRate: ts.filter((x) => x.mlCorrect).length / Math.max(1, ts.length),
    rulesWinRate: ts.filter((x) => x.rulesCorrect).length / Math.max(1, ts.length),
  }));

  return {
    totalTrades: trades.length,
    winRate,
    expectancy,
    sharpeRatio: Math.round(sharpe * 1000) / 1000,
    profitFactor: Math.round(profitFactor * 1000) / 1000,
    maxDrawdownPct: Math.round(computeMaxDrawdownPct(returns) * 1000) / 1000,
    avgReturnPct: Math.round(avgReturn * 10000) / 10000,
    accuracyByRegime,
    performanceByTimeframe: {
      [timeframe]: {
        trades: trades.length,
        winRate,
        avgReturnPct: Math.round(avgReturn * 10000) / 10000,
      },
    },
  };
}

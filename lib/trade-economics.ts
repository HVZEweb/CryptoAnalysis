/**
 * Whether a TP/SL trade is worth taking once exchange fees and slippage are paid.
 *
 * The signal is known only at a candle's close, so the entry is a market order; the stop is a market
 * order too. Two cases: "market" — the take-profit also by market order (worst case); "limit" — the
 * take-profit as a resting limit order (the realistic plan). Same cost model as the strategy lab.
 */

import type { MarketType, PredictionDirection } from "@/types";

/** Binance fee per side at the base tier: taker = market order, maker = limit order. */
export const FEES: Record<MarketType, { taker: number; maker: number }> = {
  Futures: { taker: 0.0005, maker: 0.0002 },
  Spot: { taker: 0.001, maker: 0.001 },
};

/** Price slippage of a market order, per side. */
export const SLIPPAGE = 0.0003;

export interface OrderEconomics {
  /** Round-trip cost (fees + slippage) of a losing trade, in price units */
  fee: number;
  netProfit: number;
  netLoss: number;
  /** Share of trades that must hit TP before SL just to break even */
  breakevenWinRate: number;
  /** Expected result per trade in price units */
  expectedValue: number;
  expectedValuePct: number;
}

export interface TradeEconomics {
  grossProfit: number;
  grossLoss: number;
  /**
   * Estimated chance TP is hit before SL. Without an edge that is SL / (TP + SL) for a random walk;
   * the model's edge over 50% is added on top.
   */
  winProbability: number;
  market: OrderEconomics;
  limit: OrderEconomics;
  worthTrading: boolean;
  preferredOrder: "market" | "limit" | null;
}

function orderEconomics(entry: number, gain: number, loss: number, winCostRate: number, lossCostRate: number, winProbability: number): OrderEconomics {
  const fee = entry * lossCostRate;
  const netProfit = gain - entry * winCostRate;
  const netLoss = loss + fee;
  const expectedValue = winProbability * netProfit - (1 - winProbability) * netLoss;
  return {
    fee,
    netProfit,
    netLoss,
    breakevenWinRate: netLoss / (netProfit + netLoss),
    expectedValue,
    expectedValuePct: (expectedValue / entry) * 100,
  };
}

export function computeTradeEconomics(
  direction: PredictionDirection,
  entry: number,
  tp: number,
  sl: number,
  probabilityPct: number,
  market: MarketType
): TradeEconomics | undefined {
  if (direction === "SIDEWAYS" || !(entry > 0)) return undefined;
  const gain = Math.abs(tp - entry);
  const loss = Math.abs(entry - sl);
  if (!(gain > 0) || !(loss > 0)) return undefined;

  const edge = probabilityPct / 100 - 0.5;
  const winProbability = Math.max(0, Math.min(1, loss / (gain + loss) + edge));
  const fees = FEES[market] ?? FEES.Futures;
  const marketSide = fees.taker + SLIPPAGE;
  // Entry and stop are market orders in both cases; only the take-profit differs.
  const marketOrder = orderEconomics(entry, gain, loss, 2 * marketSide, 2 * marketSide, winProbability);
  const limitOrder = orderEconomics(entry, gain, loss, marketSide + fees.maker, 2 * marketSide, winProbability);

  const preferredOrder = marketOrder.expectedValue > 0 ? "market" : limitOrder.expectedValue > 0 ? "limit" : null;
  return {
    grossProfit: gain,
    grossLoss: loss,
    winProbability,
    market: marketOrder,
    limit: limitOrder,
    worthTrading: preferredOrder !== null,
    preferredOrder,
  };
}

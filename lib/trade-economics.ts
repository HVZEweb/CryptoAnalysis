/**
 * Whether a TP/SL trade is worth taking once exchange fees are paid.
 */

import type { MarketType, PredictionDirection } from "@/types";

/** Binance fee per side at the base tier: taker = market order, maker = limit order. */
export const FEES: Record<MarketType, { taker: number; maker: number }> = {
  Futures: { taker: 0.0005, maker: 0.0002 },
  Spot: { taker: 0.001, maker: 0.001 },
};

export interface OrderEconomics {
  /** Round-trip fee (entry + exit) in price units */
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

function orderEconomics(entry: number, gain: number, loss: number, feeRate: number, winProbability: number): OrderEconomics {
  const fee = entry * feeRate * 2;
  const netProfit = gain - fee;
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
  const marketOrder = orderEconomics(entry, gain, loss, fees.taker, winProbability);
  const limitOrder = orderEconomics(entry, gain, loss, fees.maker, winProbability);

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

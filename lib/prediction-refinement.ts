import { computeTradeEconomics } from "@/lib/trade-economics";
import type {
  AnalysisSnapshot,
  PredictionDirection,
  PredictionResult,
  PriceForecast,
  Timeframe,
} from "@/types";

const HIGHER_TF_INTERVALS = ["1h", "4h", "1d"];

const BASE_ATR_MULTIPLIERS: Record<string, { sl: number; tp: number; minMove: number }> = {
  "15m": { sl: 0.75, tp: 1.0, minMove: 0.45 },
  "30m": { sl: 0.85, tp: 1.1, minMove: 0.5 },
  "1h": { sl: 1.0, tp: 1.3, minMove: 0.55 },
  "4h": { sl: 1.15, tp: 1.5, minMove: 0.65 },
  "12h": { sl: 1.25, tp: 1.65, minMove: 0.75 },
  "24h": { sl: 1.4, tp: 1.85, minMove: 0.85 },
  "3d": { sl: 1.6, tp: 2.1, minMove: 1.0 },
  "7d": { sl: 1.8, tp: 2.4, minMove: 1.2 },
};

/** 
 * Адаптация мультипликаторов под волатильность актива
 * BTC ~3-5%, altcoins ~8-15%, memecoins ~20-50%
 */
function getVolatilityAdjustedMultipliers(
  base: { sl: number; tp: number; minMove: number },
  dailyVolatilityPct: number
): { sl: number; tp: number; minMove: number } {
  // Если волатильность > 15%, увеличиваем targets
  const factor = dailyVolatilityPct > 15 ? 1.3 : dailyVolatilityPct > 8 ? 1.15 : 1.0;
  
  return {
    sl: base.sl * factor,
    tp: base.tp * factor,
    minMove: base.minMove * factor,
  };
}

const MIN_RR = 1.5;
/** Support/resistance closer than this (in ATR) is noise, not a level worth trading against. */
const MIN_LEVEL_DISTANCE_ATR = 0.25;
/**
 * Support/resistance may widen SL/TP by at most this factor over the ATR distance. A level further
 * away belongs to a longer horizon: snapping to it (and then stretching TP to MIN_RR) produced
 * 15m plans with ±1–2% targets that price almost never reaches within the timeframe.
 */
const MAX_LEVEL_STRETCH = 1.3;

export type TrendBias = "bullish" | "bearish" | "neutral";

export function getHigherTimeframeBias(analysis: AnalysisSnapshot): TrendBias {
  let bullish = 0;
  let bearish = 0;

  for (const tf of HIGHER_TF_INTERVALS) {
    const ind = analysis.indicators[tf];
    if (!ind) continue;
    if (ind.superTrend.direction === "bullish") bullish++;
    else bearish++;
  }

  if (analysis.marketStructure.trend === "Bullish") bullish++;
  if (analysis.marketStructure.trend === "Bearish") bearish++;

  if (bullish >= 2 && bullish > bearish) return "bullish";
  if (bearish >= 2 && bearish > bullish) return "bearish";
  return "neutral";
}

function getAtrMult(timeframe: Timeframe, dailyVolatilityPct?: number) {
  const base = BASE_ATR_MULTIPLIERS[timeframe] ?? BASE_ATR_MULTIPLIERS["1h"];
  if (dailyVolatilityPct === undefined) return base;
  return getVolatilityAdjustedMultipliers(base, dailyVolatilityPct);
}

function buildLevelsFromAtr(
  direction: PredictionDirection,
  entry: number,
  atr: number,
  mult: { sl: number; tp: number },
  support: number,
  resistance: number
): { tp: number; sl: number; exit: number } {
  const slDist = atr * mult.sl;
  const tpDist = atr * mult.tp;
  // A level is used only while it stays within MAX_LEVEL_STRETCH of the ATR distance.
  const usable = (level: number, atrDist: number) =>
    level > 0 && Math.abs(level - entry) <= atrDist * MAX_LEVEL_STRETCH;

  if (direction === "LONG") {
    let sl = entry - slDist;
    let tp = entry + tpDist;
    if (support < entry && usable(support, slDist)) sl = Math.min(sl, support);
    if (resistance > entry && usable(resistance, tpDist)) tp = Math.max(tp, resistance);
    if (tp - entry < (entry - sl) * MIN_RR) tp = entry + (entry - sl) * MIN_RR;
    const exit = entry + tpDist * 0.85;
    return { tp, sl, exit: Math.min(tp, Math.max(exit, entry + atr * mult.tp * 0.5)) };
  }

  if (direction === "SHORT") {
    let sl = entry + slDist;
    let tp = entry - tpDist;
    if (resistance > entry && usable(resistance, slDist)) sl = Math.max(sl, resistance);
    if (support < entry && usable(support, tpDist)) tp = Math.min(tp, support);
    if (entry - tp < (sl - entry) * MIN_RR) tp = entry - (sl - entry) * MIN_RR;
    const exit = entry - tpDist * 0.85;
    return { tp, sl, exit: Math.max(tp, Math.min(exit, entry - atr * mult.tp * 0.5)) };
  }

  const half = atr * 0.5;
  return { tp: entry + half, sl: entry - half, exit: entry };
}

function buildForecastFromLevels(
  direction: PredictionDirection,
  entry: number,
  levels: { tp: number; sl: number; exit: number },
  atr: number,
  priceRange: { low: number; high: number }
): PriceForecast {
  const exit = levels.exit;
  const expectedMovePct = entry > 0 ? ((exit - entry) / entry) * 100 : 0;
  const bandHalf = Math.max(atr * 0.35, Math.abs(exit - entry) * 0.25);

  let predictedHigh: number;
  let predictedLow: number;

  if (direction === "LONG") {
    predictedHigh = levels.tp;
    predictedLow = Math.min(levels.sl, priceRange.low);
  } else if (direction === "SHORT") {
    predictedHigh = Math.max(levels.sl, priceRange.high);
    predictedLow = levels.tp;
  } else {
    predictedHigh = Math.max(priceRange.high, entry + bandHalf);
    predictedLow = Math.min(priceRange.low, entry - bandHalf);
  }

  return {
    predictedPrice: exit,
    predictedHigh,
    predictedLow,
    confidenceBand: {
      low: Math.min(exit - bandHalf, exit),
      high: Math.max(exit + bandHalf, exit),
    },
    expectedMovePct,
    source: "levels",
  };
}

/**
 * Server-side trade plan for a prediction. It never changes the direction or raises the probability
 * (those come from the validated ensemble); it only derives TP/SL from ATR, prices in exchange fees,
 * and warns when the trade does not pay after fees.
 */
export function refinePrediction(
  prediction: PredictionResult,
  analysis: AnalysisSnapshot,
  timeframe: Timeframe
): PredictionResult {
  const notes = [...(prediction.refinementNotes ?? [])];
  const entry = prediction.priceAtPrediction;
  const atr = analysis.volatility.atr || entry * 0.02;
  const mult = getAtrMult(timeframe, analysis.volatility.dailyVolatility);
  const direction = prediction.direction;

  const minDistance = atr * MIN_LEVEL_DISTANCE_ATR;
  const support = entry - analysis.levels.nearestSupport >= minDistance ? analysis.levels.nearestSupport : 0;
  const resistance = analysis.levels.nearestResistance - entry >= minDistance ? analysis.levels.nearestResistance : 0;
  const strategy = prediction.strategy;
  const strategyTrade = strategy?.status === "trade" && strategy.levels && strategy.side === direction;
  const levels = strategyTrade
    ? { sl: strategy.levels!.sl, tp: strategy.levels!.tp, exit: strategy.levels!.tp }
    : buildLevelsFromAtr(direction, entry, atr, mult, support, resistance);

  const risks = [...prediction.risks];
  const htfBias = getHigherTimeframeBias(analysis);
  if ((direction === "LONG" && htfBias === "bearish") || (direction === "SHORT" && htfBias === "bullish")) {
    const riskNote = "Против тренда старших таймфреймов — уменьшите размер позиции";
    if (!risks.some((r) => r.includes("старших таймфреймов"))) risks.unshift(riskNote);
  }

  const economics = computeTradeEconomics(direction, entry, levels.tp, levels.sl, prediction.probability, prediction.market);
  let recommendation = prediction.recommendation;
  if (economics) {
    const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
    const win = pct(economics.winProbability);
    if (!economics.worthTrading) {
      recommendation =
        `${direction} ${prediction.probability}%: перевес есть, но после комиссий сделка с такими уровнями в среднем убыточна ` +
        `(нужно ${pct(economics.limit.breakevenWinRate)} сделок в плюс даже с целью лимитным ордером, ожидается ~${win}). Входить не стоит.`;
      notes.push("После комиссий ожидаемый результат отрицательный — сделка не рекомендуется");
    } else {
      const order = economics.preferredOrder === "market" ? "рыночным ордером" : "рыночным ордером, TP — только лимитным";
      recommendation =
        `${direction} ${prediction.probability}%: вход ${order} у ${entry.toFixed(2)}, TP ${levels.tp.toFixed(2)}, SL ${levels.sl.toFixed(2)} ` +
        `(с комиссиями и проскальзыванием безубыток при ${pct(economics[economics.preferredOrder === "market" ? "market" : "limit"].breakevenWinRate)} сделок в плюс, ожидается ~${win}).`;
    }
  }

  if (strategy && strategyTrade) {
    const h = strategy.holdout!;
    const setup = strategy.setup!;
    recommendation =
      `${direction}: проверенная стратегия — вход рыночным ордером у ${entry.toFixed(2)}, TP ${levels.tp.toFixed(2)}, SL ${levels.sl.toFixed(2)}, ` +
      `TP выставить лимитным ордером, закрыть не позже чем через ${setup.horizonBars} × ${setup.interval}. На новых для неё данных: ${h.avgNetBp >= 0 ? "+" : ""}${h.avgNetBp.toFixed(1)} п. ` +
      `на сделку после комиссий и проскальзывания, ${(h.winRate * 100).toFixed(0)}% сделок в плюс, ${h.trades} сделок.`;
    notes.push("Уровни и срок сделки взяты из настройки, проверенной на истории с комиссиями");
  } else if (strategy) {
    recommendation = `Выгодной сделки сейчас нет: ${strategy.reason}. Направление и коридор — только для ориентира.`;
    notes.push("Сделка не предлагается: стратегия не подтвердила прибыль после комиссий");
  }

  const modelForecast = prediction.priceForecast?.source === "predictor" ? prediction.priceForecast : undefined;
  const priceForecast = modelForecast ?? buildForecastFromLevels(direction, entry, levels, atr, prediction.priceRange);
  const priceRange = modelForecast
    ? { low: modelForecast.predictedLow, high: modelForecast.predictedHigh }
    : prediction.priceRange;

  return {
    ...prediction,
    priceRange,
    priceForecast,
    tradeLevels: { entry, tp: levels.tp, sl: levels.sl, exit: levels.exit },
    tradeEconomics: economics,
    risks,
    recommendation,
    refinementNotes: notes,
  };
}

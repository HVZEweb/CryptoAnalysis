import type {
  AnalysisSnapshot,
  ConfidenceLevel,
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
const FEE_BUFFER_PCT = 0.08;

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

function downgradeConfidence(c: ConfidenceLevel): ConfidenceLevel {
  if (c === "High") return "Medium";
  if (c === "Medium") return "Low";
  return "Low";
}

function isOverbought(analysis: AnalysisSnapshot, primaryTf: string): boolean {
  const ind = analysis.indicators[primaryTf];
  if (!ind) return false;
  return ind.stochasticRsi.k >= 78 || ind.rsi >= 68;
}

function isOversold(analysis: AnalysisSnapshot, primaryTf: string): boolean {
  const ind = analysis.indicators[primaryTf];
  if (!ind) return false;
  return ind.stochasticRsi.k <= 22 || ind.rsi <= 32;
}

function primaryAdx(analysis: AnalysisSnapshot, primaryTf: string): number {
  return analysis.indicators[primaryTf]?.adx ?? 0;
}

function clampProb(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

function alignDirectionWithMove(
  direction: PredictionDirection,
  movePct: number,
  minMovePct: number
): PredictionDirection {
  if (Math.abs(movePct) < minMovePct * 0.35) return "SIDEWAYS";
  if (movePct > minMovePct * 0.25 && direction === "SHORT") return "LONG";
  if (movePct < -minMovePct * 0.25 && direction === "LONG") return "SHORT";
  return direction;
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

  if (direction === "LONG") {
    let sl = entry - slDist;
    let tp = entry + tpDist;
    if (support > 0 && support < entry) sl = Math.min(sl, support);
    if (resistance > 0 && resistance > entry) tp = Math.max(tp, resistance);
    if (tp - entry < (entry - sl) * MIN_RR) tp = entry + (entry - sl) * MIN_RR;
    const exit = entry + tpDist * 0.85;
    return { tp, sl, exit: Math.min(tp, Math.max(exit, entry + atr * mult.tp * 0.5)) };
  }

  if (direction === "SHORT") {
    let sl = entry + slDist;
    let tp = entry - tpDist;
    if (resistance > 0 && resistance > entry) sl = Math.max(sl, resistance);
    if (support > 0 && support < entry) tp = Math.min(tp, support);
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
 * Серверная коррекция прогноза: выравнивание по старшим ТФ, ATR для SL/TP,
 * минимальный ход, синхронизация direction и expectedMovePct.
 */
export function refinePrediction(
  prediction: PredictionResult,
  analysis: AnalysisSnapshot,
  timeframe: Timeframe
): PredictionResult {
  const notes: string[] = [];
  const entry = prediction.priceAtPrediction;
  const atr = analysis.volatility.atr || entry * 0.02;
  const dailyVol = analysis.volatility.dailyVolatility;
  const mult = getAtrMult(timeframe, dailyVol);
  const primaryTf = analysis.primaryTimeframe;

  const regime = analysis.marketRegime;
  const ensembleTrust = prediction.metaTrustScore ?? 55;
  const lowConf = prediction.lowConfidence ?? false;

  let regimeFactor = 1;
  if (regime?.regime === "Strong Bull" || regime?.regime === "Strong Bear") {
    regimeFactor = 1.08;
  } else if (regime?.regime === "Low Conviction" || lowConf) {
    regimeFactor = 0.82;
  }
  if (regime?.htfConflict) {
    regimeFactor *= 0.88;
    notes.push("Regime protection: конфликт с HTF — сужены цели и SL");
  }
  if (ensembleTrust < 45) {
    regimeFactor *= 0.9;
    notes.push(`Низкий meta-trust (${ensembleTrust}%) — консервативные уровни`);
  }

  const riskMult = {
    sl: mult.sl * (lowConf ? 0.85 : 1) * regimeFactor,
    tp: mult.tp * regimeFactor * (ensembleTrust >= 60 ? 1.05 : 0.92),
    minMove: mult.minMove * (lowConf ? 1.1 : 1),
  };

  const minMovePct = Math.max(FEE_BUFFER_PCT, ((atr * riskMult.minMove) / entry) * 100);
  
  if (dailyVol > 15) {
    notes.push(`Высокая волатильность (${dailyVol.toFixed(1)}%) — targets расширены на 30%`);
  }

  let direction = prediction.direction;
  let confidence = prediction.confidence;
  let probability = prediction.probability;
  let probabilityUp = prediction.probabilityUp;
  let probabilityDown = prediction.probabilityDown;

  const htfBias = getHigherTimeframeBias(analysis);
  const adx = primaryAdx(analysis, primaryTf);
  const counterTrend =
    (direction === "SHORT" && htfBias === "bullish") ||
    (direction === "LONG" && htfBias === "bearish");

  if (counterTrend) {
    const scalpOk =
      (direction === "SHORT" && isOverbought(analysis, primaryTf)) ||
      (direction === "LONG" && isOversold(analysis, primaryTf));

    if (!scalpOk && (adx < 25 || regime?.htfConflict)) {
      direction = "SIDEWAYS";
      probability = 50;
      probabilityUp = 50;
      probabilityDown = 50;
      confidence = "Low";
      notes.push(
        "Контртренд отменён: старшие ТФ против направления, ADX слабый — переведено в боковик"
      );
    } else if (!scalpOk) {
      direction = htfBias === "bullish" ? "LONG" : "SHORT";
      probability = clampProb(Math.min(probability, 58));
      if (direction === "LONG") {
        probabilityUp = probability;
        probabilityDown = 100 - probability;
      } else {
        probabilityDown = probability;
        probabilityUp = 100 - probability;
      }
      confidence = downgradeConfidence(confidence);
      notes.push(`Направление выровнено по старшим ТФ (${htfBias === "bullish" ? "LONG" : "SHORT"})`);
    } else {
      probability = clampProb(Math.min(probability, 58));
      probabilityDown = probability;
      probabilityUp = 100 - probability;
      confidence = downgradeConfidence(confidence);
      notes.push(
        "Контртрендовый скальп: только при перекупленности/перепроданности, снижена уверенность"
      );
    }
  }

  if (adx < 18 && direction !== "SIDEWAYS" && !counterTrend) {
    confidence = downgradeConfidence(confidence);
    probability = clampProb(probability - 8);
    notes.push("Слабый тренд (ADX < 18): снижена уверенность");
  }

  const support = analysis.levels.nearestSupport;
  const resistance = analysis.levels.nearestResistance;
  const atrLevels = buildLevelsFromAtr(direction, entry, atr, riskMult, support, resistance);

  let priceRange = { ...prediction.priceRange };
  if (direction === "LONG") {
    priceRange = {
      low: Math.min(priceRange.low, atrLevels.sl),
      high: Math.max(priceRange.high, atrLevels.tp),
    };
  } else if (direction === "SHORT") {
    priceRange = {
      low: Math.min(priceRange.low, atrLevels.tp),
      high: Math.max(priceRange.high, atrLevels.sl),
    };
  }

  let priceForecast = buildForecastFromLevels(direction, entry, atrLevels, atr, priceRange);

  if (Math.abs(priceForecast.expectedMovePct) < minMovePct && direction !== "SIDEWAYS") {
    direction = alignDirectionWithMove(direction, priceForecast.expectedMovePct, minMovePct);
    if (direction === "SIDEWAYS") {
      priceForecast = buildForecastFromLevels(direction, entry, atrLevels, atr, priceRange);
      probability = 50;
      probabilityUp = 50;
      probabilityDown = 50;
      notes.push(`Слишком малый ход (< ${minMovePct.toFixed(2)}%) — боковик`);
    } else {
      const realigned = buildLevelsFromAtr(direction, entry, atr, riskMult, support, resistance);
      priceForecast = buildForecastFromLevels(direction, entry, realigned, atr, priceRange);
      notes.push(`Цель расширена до мин. ${minMovePct.toFixed(2)}% (ATR + комиссии)`);
    }
  }

  direction = alignDirectionWithMove(direction, priceForecast.expectedMovePct, minMovePct);

  if (direction === "SIDEWAYS") {
    probability = 50;
    probabilityUp = 50;
    probabilityDown = 50;
  } else if (direction === "LONG") {
    probabilityUp = clampProb(Math.max(probabilityUp, probability));
    probabilityDown = 100 - probabilityUp;
    probability = probabilityUp;
  } else {
    probabilityDown = clampProb(Math.max(probabilityDown, probability));
    probabilityUp = 100 - probabilityDown;
    probability = probabilityDown;
  }

  const finalLevels = buildLevelsFromAtr(direction, entry, atr, riskMult, support, resistance);
  priceForecast = buildForecastFromLevels(direction, entry, finalLevels, atr, priceRange);

  if (direction === "LONG") {
    priceRange = {
      low: Math.min(priceRange.low, finalLevels.sl),
      high: Math.max(priceRange.high, finalLevels.tp),
    };
  } else if (direction === "SHORT") {
    priceRange = {
      low: Math.min(priceRange.low, finalLevels.tp),
      high: Math.max(priceRange.high, finalLevels.sl),
    };
  }

  const tradeLevels = {
    entry,
    tp: finalLevels.tp,
    sl: finalLevels.sl,
    exit: priceForecast.predictedPrice,
  };

  let recommendation = prediction.recommendation;
  if (notes.length > 0 && !recommendation.includes("Старшие ТФ")) {
    const action =
      direction === "SIDEWAYS"
        ? "Дождитесь пробоя диапазона с объёмом."
        : direction === "LONG"
          ? `LONG: вход у $${entry.toFixed(0)}, TP $${tradeLevels.tp.toFixed(0)}, SL $${tradeLevels.sl.toFixed(0)}.`
          : `SHORT: вход у $${entry.toFixed(0)}, TP $${tradeLevels.tp.toFixed(0)}, SL $${tradeLevels.sl.toFixed(0)}.`;
    recommendation = `${action} ${notes[notes.length - 1]}`;
  }

  const risks = [...prediction.risks];
  if (counterTrend && direction !== "SIDEWAYS") {
    const riskNote = "Контртренд относительно 1h/4h — уменьшите размер позиции";
    if (!risks.some((r) => r.includes("Контртренд"))) risks.unshift(riskNote);
  }

  return {
    ...prediction,
    direction,
    confidence,
    probability,
    probabilityUp,
    probabilityDown,
    priceRange,
    // A trained-model forecast is a real distribution estimate; the ATR one is only a trade target.
    priceForecast: prediction.priceForecast?.source === "predictor" ? prediction.priceForecast : priceForecast,
    tradeLevels,
    risks,
    recommendation,
    refinementNotes: notes.length > 0 ? notes : prediction.refinementNotes,
  };
}

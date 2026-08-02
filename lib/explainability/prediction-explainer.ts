/**
 * Human-readable prediction explainability for traders.
 */

import type {
  AnalysisSnapshot,
  EnsembleBreakdown,
  MarketRegime,
  OnChainFlowData,
  PredictionDirection,
  PredictionExplanation,
  PredictionResult,
} from "@/types";

const FEATURE_LABELS: Record<string, string> = {
  rsi_norm: "RSI (импульс)",
  macd_hist_norm: "MACD гистограмма",
  ema_trend: "EMA-тренд",
  bb_position: "Позиция в Bollinger",
  adx_norm: "Сила тренда (ADX)",
  stoch_rsi_norm: "Stochastic RSI",
  cci_norm: "CCI",
  vwap_dev: "Отклонение от VWAP",
  obv_trend: "OBV (объём)",
  structure_trend: "Структура рынка",
  volume_anomaly: "Аномалия объёма",
  volatility_norm: "Волатильность",
  fear_greed_norm: "Fear & Greed",
  btc_dom_change: "Доминация BTC",
  market_cap_chg: "Капитализация рынка",
  news_sentiment: "Новостной сентимент",
  funding_norm: "Funding rate",
  oi_change_proxy: "Open Interest",
  long_short_bias: "Long/Short bias",
  momentum_5: "Моментум 5 баров",
  momentum_20: "Моментум 20 баров",
  higher_tf_rsi: "RSI старшего ТФ",
  ichimoku_cloud: "Ишимоку (облако)",
  regime_score: "Режим рынка",
  oi_change_norm: "Изменение OI 24h",
  funding_trend_norm: "Тренд funding",
  cvd_norm: "CVD (кумулятивная дельта)",
  delta_imbalance: "Дисбаланс дельты",
  liq_proximity: "Близость ликвидаций",
};

type DriverBias = PredictionExplanation["topDrivers"][number]["bias"];
type DriverSource = PredictionExplanation["topDrivers"][number]["source"];

function directionLabel(d: PredictionDirection): string {
  if (d === "LONG") return "лонг";
  if (d === "SHORT") return "шорт";
  return "боковик";
}

function agreementRu(a: EnsembleBreakdown["agreement"]): string {
  if (a === "full") return "полное согласие компонентов";
  if (a === "partial") return "частичное согласие";
  return "расхождение голосов";
}

function biasFromValue(value: number, threshold = 0.12): DriverBias {
  if (value > threshold) return "bullish";
  if (value < -threshold) return "bearish";
  return "neutral";
}

function interpretFeature(key: string, value: number): string {
  const v = Math.round(value * 100) / 100;
  switch (key) {
    case "rsi_norm":
      return v > 0.3 ? "перекупленность / бычий импульс" : v < -0.3 ? "перепроданность" : "нейтральная зона";
    case "macd_hist_norm":
      return v > 0.15 ? "бычий импульс MACD" : v < -0.15 ? "медвежий импульс MACD" : "слабый MACD";
    case "ema_trend":
      return v > 0.25 ? "цена выше EMA, бычий стек" : v < -0.25 ? "медвежий стек EMA" : "смешанные EMA";
    case "adx_norm":
      return v > 0.2 ? "сильный тренд" : "слабый тренд / флэт";
    case "funding_norm":
    case "funding_trend_norm":
      return v > 0.2 ? "лонги платят funding — перегрев лонгов" : v < -0.2 ? "шорты платят — давление на шорт" : "нейтральный funding";
    case "cvd_norm":
      return v > 0.2 ? "покупатели доминируют (CVD↑)" : v < -0.2 ? "продавцы доминируют (CVD↓)" : "баланс CVD";
    case "delta_imbalance":
      return v > 0.2 ? "агрессивные покупки" : v < -0.2 ? "агрессивные продажи" : "нейтральная дельта";
    case "oi_change_norm":
      return v > 0.2 ? "рост OI — усиление позиций" : v < -0.2 ? "снижение OI — выход из позиций" : "стабильный OI";
    case "regime_score":
      return v > 0.2 ? "бычий режим" : v < -0.2 ? "медвежий режим" : "неопределённый режим";
    case "structure_trend":
      return v > 0.3 ? "бычья структура HH/HL" : v < -0.3 ? "медвежья структура LH/LL" : "боковая структура";
    case "fear_greed_norm":
      return v > 0.2 ? "жадность рынка" : v < -0.2 ? "страх рынка" : "нейтральные настроения";
    case "liq_proximity":
      return v > 0.2 ? "ближе ликвидации шортов — магнит вверх" : v < -0.2 ? "ближе ликвидации лонгов — магнит вниз" : "ликвидации далеко";
    default:
      return v > 0.2 ? "бычий сигнал" : v < -0.2 ? "медвежий сигнал" : "нейтрально";
  }
}

function featureSource(key: string): DriverSource {
  if (["funding_norm", "oi_change_norm", "funding_trend_norm", "cvd_norm", "delta_imbalance", "liq_proximity", "oi_change_proxy", "long_short_bias"].includes(key)) {
    return "onchain";
  }
  if (["fear_greed_norm", "btc_dom_change", "market_cap_chg", "news_sentiment"].includes(key)) {
    return "sentiment";
  }
  if (key === "regime_score") return "regime";
  return "technical";
}

function directionMultiplier(direction: PredictionDirection): number {
  if (direction === "LONG") return 1;
  if (direction === "SHORT") return -1;
  return 0;
}

function buildTopDrivers(
  prediction: PredictionResult,
  analysis?: AnalysisSnapshot
): PredictionExplanation["topDrivers"] {
  const drivers: PredictionExplanation["topDrivers"] = [];
  const dirMul = directionMultiplier(prediction.direction);
  const features = prediction.mlFeatures ?? {};

  const ranked = Object.entries(features)
    .map(([key, value]) => ({
      key,
      value,
      impact: dirMul === 0 ? Math.abs(value) : value * dirMul,
    }))
    .sort((a, b) => b.impact - a.impact || Math.abs(b.value) - Math.abs(a.value));

  for (const { key, value, impact } of ranked.slice(0, 5)) {
    const label = FEATURE_LABELS[key] ?? key;
    drivers.push({
      label,
      detail: `${interpretFeature(key, value)} (вклад ${impact > 0 ? "+" : ""}${(impact * 100).toFixed(0)}%)`,
      bias: biasFromValue(value),
      source: featureSource(key),
    });
  }

  const regime = analysis?.marketRegime ?? prediction.analysis?.marketRegime;
  if (regime && drivers.length < 5) {
    drivers.push({
      label: `Режим: ${regime.regime}`,
      detail: regime.signals.slice(0, 2).join("; ") || `Уверенность ${regime.confidence}%`,
      bias:
        regime.regime.includes("Bull")
          ? "bullish"
          : regime.regime.includes("Bear")
            ? "bearish"
            : "neutral",
      source: "regime",
    });
  }

  const flow = analysis?.onChainFlow ?? prediction.analysis?.onChainFlow;
  if (flow && prediction.market === "Futures" && drivers.length < 6) {
    const onchain = describeOnChain(flow);
    if (onchain) {
      drivers.push({
        label: "On-chain / поток ордеров",
        detail: onchain,
        bias: biasFromValue(flow.orderFlow.cvd),
        source: "onchain",
      });
    }
  }

  return drivers.slice(0, 5);
}

function describeOnChain(flow: OnChainFlowData): string {
  const parts: string[] = [];
  parts.push(`Funding ${flow.fundingOi.fundingRate.toFixed(4)} (${flow.fundingOi.fundingTrend})`);
  parts.push(`OI 24h ${flow.fundingOi.openInterestChange24hPct >= 0 ? "+" : ""}${flow.fundingOi.openInterestChange24hPct.toFixed(1)}%`);
  parts.push(`CVD ${flow.orderFlow.cvdTrend}`);
  if (flow.liquidations.nearestLongLiq || flow.liquidations.nearestShortLiq) {
    parts.push("кластеры ликвидаций учтены");
  }
  return parts.join(" · ");
}

function buildEnsembleRationale(
  prediction: PredictionResult,
  breakdown?: EnsembleBreakdown
): { rationale: string; votes: PredictionExplanation["ensembleVotes"] } {
  if (!breakdown) {
    return {
      rationale: `Итоговое направление ${directionLabel(prediction.direction)} с вероятностью ${prediction.probability}% основано на AI-анализе без детального ensemble breakdown.`,
      votes: [],
    };
  }

  const w = breakdown.effectiveWeights;
  const votes: PredictionExplanation["ensembleVotes"] = [
    {
      component: "LLM (AI)",
      direction: breakdown.llm.direction,
      weight: `${(w.llm * 100).toFixed(0)}%`,
      note: `Вероятность ${breakdown.llm.probability}%, score ${(breakdown.llm.score * 100).toFixed(0)}%`,
    },
    {
      component: breakdown.mlAvailable ? `ML (${breakdown.ml.model})` : "ML (недоступен)",
      direction: breakdown.ml.direction,
      weight: `${(w.ml * 100).toFixed(0)}%`,
      note: breakdown.mlAvailable
        ? `Confidence ${breakdown.ml.confidence}%${breakdown.ml.keyFeatures?.length ? ` · ${breakdown.ml.keyFeatures.slice(0, 2).join(", ")}` : ""}`
        : breakdown.mlError ?? "Использованы LLM + rules",
    },
    {
      component: "Rules",
      direction:
        breakdown.rulesAggregateScore > 0.08
          ? "LONG"
          : breakdown.rulesAggregateScore < -0.08
            ? "SHORT"
            : "SIDEWAYS",
      weight: `${(w.rules * 100).toFixed(0)}%`,
      note: `Агрегированный score ${(breakdown.rulesAggregateScore * 100).toFixed(1)}%`,
    },
  ];

  const scorePct = (breakdown.ensembleScore * 100).toFixed(1);
  const trust =
    breakdown.metaTrustScore != null ? ` Доверие meta-learner: ${breakdown.metaTrustScore}/100.` : "";

  const rationale =
    `Ensemble выбрал ${directionLabel(breakdown.finalDirection)} (${breakdown.finalProbability}%) ` +
    `при ${agreementRu(breakdown.agreement)}. ` +
    `Взвешенный score ${scorePct}%: LLM ${(w.llm * 100).toFixed(0)}%, ` +
    `ML ${(w.ml * 100).toFixed(0)}%, rules ${(w.rules * 100).toFixed(0)}%.` +
    trust +
    (breakdown.lowConfidence ? " Сигнал слабый — confidence понижен." : "");

  return { rationale, votes };
}

function buildStrengthsWeaknesses(
  prediction: PredictionResult,
  breakdown?: EnsembleBreakdown,
  analysis?: AnalysisSnapshot
): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (breakdown) {
    if (breakdown.agreement === "full") strengths.push("Полное согласие LLM, ML и rule-сигналов");
    if (breakdown.agreement === "divergent") weaknesses.push("Компоненты ensemble расходятся — повышенная неопределённость");
    if (Math.abs(breakdown.ensembleScore) >= 0.2) strengths.push(`Сильный ensemble score (${(breakdown.ensembleScore * 100).toFixed(0)}%)`);
    if (Math.abs(breakdown.ensembleScore) < 0.1) weaknesses.push("Слабый ensemble score — сигнал на грани нейтрали");
    if (!breakdown.mlAvailable) weaknesses.push("ML-модель недоступна, вес перераспределён на LLM + rules");
    if (breakdown.metaTrustScore != null && breakdown.metaTrustScore >= 65) {
      strengths.push(`Meta-learner подтверждает сигнал (${breakdown.metaTrustScore}/100)`);
    }
    if (breakdown.metaTrustScore != null && breakdown.metaTrustScore < 45) {
      weaknesses.push(`Низкое доверие meta-learner (${breakdown.metaTrustScore}/100)`);
    }
  }

  if (prediction.confidence === "High") strengths.push("Высокая итоговая уверенность модели");
  if (prediction.confidence === "Low") weaknesses.push("Низкая итоговая уверенность — осторожный sizing");

  const regime = analysis?.marketRegime ?? prediction.analysis?.marketRegime;
  if (regime) {
    if (regime.regime === "Low Conviction") weaknesses.push("Режим Low Conviction — слабая предсказуемость");
    if (regime.regime === "Strong Bull" && prediction.direction === "LONG") strengths.push("Прогноз согласован с режимом Strong Bull");
    if (regime.regime === "Strong Bear" && prediction.direction === "SHORT") strengths.push("Прогноз согласован с режимом Strong Bear");
    if (regime.regime === "Strong Bull" && prediction.direction === "SHORT") weaknesses.push("Шорт против сильного бычьего режима");
    if (regime.regime === "Strong Bear" && prediction.direction === "LONG") weaknesses.push("Лонг против сильного медвежьего режима");
  }

  if (prediction.modelConfidence) {
    if (prediction.modelConfidence.label === "High") strengths.push(`Live accuracy модели высокая (${prediction.modelConfidence.score}/100)`);
    if (prediction.modelConfidence.driftAlert) weaknesses.push("Зафиксирован concept drift — точность модели могла снизиться");
  }

  if (prediction.reasons?.length) strengths.push(...prediction.reasons.slice(0, 2));
  if (prediction.risks?.length) weaknesses.push(...prediction.risks.slice(0, 2));

  return {
    strengths: [...new Set(strengths)].slice(0, 5),
    weaknesses: [...new Set(weaknesses)].slice(0, 5),
  };
}

function buildSummary(
  prediction: PredictionResult,
  breakdown?: EnsembleBreakdown,
  regime?: MarketRegime
): string {
  const dir = directionLabel(prediction.direction);
  const regimeNote = regime ? ` Рынок в режиме «${regime.regime}».` : "";
  const agreement = breakdown ? ` ${agreementRu(breakdown.agreement).charAt(0).toUpperCase() + agreementRu(breakdown.agreement).slice(1)}.` : "";

  const topReason = prediction.reasons?.[0];
  const reasonNote = topReason ? ` Ключевой фактор: ${topReason}.` : "";

  return (
    `Система рекомендует ${dir} на ${prediction.timeframe} с вероятностью ${prediction.probability}% ` +
    `(${prediction.confidence === "High" ? "высокая" : prediction.confidence === "Medium" ? "средняя" : "низкая"} уверенность).` +
    regimeNote +
    agreement +
    reasonNote
  );
}

function buildTechnicalDepth(
  prediction: PredictionResult,
  analysis?: AnalysisSnapshot,
  breakdown?: EnsembleBreakdown
): string {
  const tf = analysis?.primaryTimeframe ?? prediction.timeframe;
  const ind = analysis?.indicators[tf] ?? Object.values(analysis?.indicators ?? {})[0];
  const parts: string[] = [];

  if (ind) {
    parts.push(
      `${tf}: RSI ${ind.rsi.toFixed(1)}, ADX ${ind.adx.toFixed(1)}, ` +
        `MACD hist ${ind.macd.histogram.toFixed(4)}, SuperTrend ${ind.superTrend.direction}`
    );
  }

  if (analysis?.marketStructure) {
    parts.push(`Структура ${analysis.marketStructure.trend}, объём ${analysis.volumeAnalysis.volumeTrend}`);
  }

  if (breakdown) {
    parts.push(`Ensemble score ${(breakdown.ensembleScore * 100).toFixed(1)}%, agreement ${breakdown.agreement}`);
  }

  if (prediction.mlFeatures) {
    const top = Object.entries(prediction.mlFeatures)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 3)
      .map(([k, v]) => `${FEATURE_LABELS[k] ?? k}=${v.toFixed(2)}`)
      .join(", ");
    if (top) parts.push(`Топ ML-фичи: ${top}`);
  }

  return parts.join(". ") + ".";
}

/** Build structured Russian explanation for traders */
export function buildPredictionExplanation(prediction: PredictionResult): PredictionExplanation {
  const analysis = prediction.analysis;
  const breakdown = prediction.ensembleBreakdown;
  const regime = analysis?.marketRegime;

  const { rationale, votes } = buildEnsembleRationale(prediction, breakdown);
  const { strengths, weaknesses } = buildStrengthsWeaknesses(prediction, breakdown, analysis);

  return {
    summary: buildSummary(prediction, breakdown, regime),
    topDrivers: buildTopDrivers(prediction, analysis),
    ensembleRationale: rationale,
    ensembleVotes: votes,
    strengths,
    weaknesses,
    technicalDepth: buildTechnicalDepth(prediction, analysis, breakdown),
  };
}

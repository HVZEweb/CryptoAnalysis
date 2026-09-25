import {
  analyzeMarketStructure,
  analyzeVolume,
  calculateIndicators,
  calculateLevels,
  calculateVolatility,
} from "@/lib/indicators";
import { TIMEFRAME_CANDLE_CONFIG } from "@/lib/timeframe";
import type { ProgressEvent } from "@/lib/progress";
import { fetchCandlesForTimeframe, fetchMarketData } from "@/services/candles";
import {
  fetchBtcDominance,
  fetchFearGreedIndex,
  fetchGlobalMarket,
  fetchNews,
  fetchOnChainFlow,
} from "@/services/market-data";
import { detectMarketRegimeWithGuards } from "@/lib/market-regime";
import { getCachedRegime, setCachedRegime } from "@/lib/feature-cache";
import { generatePrediction } from "@/services/ai-prediction";
import { ensemblePredictor } from "@/services/ensemble-prediction";
import { extractMlFeatures } from "@/services/ml-features";
import { refinePrediction } from "@/lib/prediction-refinement";
import { buildPredictionExplanation } from "@/lib/explainability/prediction-explainer";
import { resolveTradeLevels } from "@/lib/trade-levels";
import type { AnalysisContext, AnalysisSnapshot, Coin, MarketType, PredictionResult, Timeframe } from "@/types";

export type ProgressCallback = (event: ProgressEvent) => void;

/** Market context up to (but not including) LLM — shared by pipeline and ensemble debug */
export async function buildAnalysisContext(
  coin: Coin,
  market: MarketType,
  timeframe: Timeframe
): Promise<{ context: AnalysisContext; snapshot: AnalysisSnapshot }> {
  const marketData = await fetchMarketData(coin.symbol, market);
  const candles = await fetchCandlesForTimeframe(coin.symbol, market, timeframe);

  const [fearGreed, btcDominance, globalMarket, news] = await Promise.all([
    fetchFearGreedIndex(),
    fetchBtcDominance(),
    fetchGlobalMarket(),
    fetchNews(coin.id, coin.name, coin.symbol),
  ]);

  const primaryInterval = TIMEFRAME_CANDLE_CONFIG[timeframe].primaryInterval;
  const primaryCandles = candles[primaryInterval] ?? Object.values(candles).find((c) => c.length >= 20) ?? [];

  if (primaryCandles.length < 5) {
    throw {
      code: "API_UNAVAILABLE" as const,
      message: "Недостаточно рыночных данных для анализа. Попробуйте другую монету или таймфрейм.",
    };
  }

  const indicators: AnalysisContext["indicators"] = {};
  for (const [interval, candleData] of Object.entries(candles)) {
    if (candleData.length >= 20) indicators[interval] = calculateIndicators(candleData);
  }

  const marketStructure = analyzeMarketStructure(primaryCandles);
  const volumeAnalysis = analyzeVolume(primaryCandles);
  const volatility = calculateVolatility(primaryCandles);
  const srLevels = calculateLevels(primaryCandles, marketData.price);

  const onChainFlow = await fetchOnChainFlow(coin.symbol, market, marketData.price, primaryCandles);

  if (market === "Futures") {
    marketData.fundingRate = onChainFlow.fundingOi.fundingRate;
    marketData.openInterest = onChainFlow.fundingOi.openInterest;
    marketData.longShortRatio = onChainFlow.fundingOi.longShortRatio;
  }

  const contextBase: AnalysisContext = {
    coin,
    market,
    timeframe,
    marketData,
    candles,
    indicators,
    marketStructure,
    volumeAnalysis,
    volatility,
    levels: srLevels,
    news,
    fearGreed,
    btcDominance,
    globalMarket,
    onChainFlow,
  };

  const regimeKey = `${coin.symbol}:${market}:${timeframe}:${marketData.price}`;
  let marketRegime = await getCachedRegime(regimeKey);
  if (!marketRegime) {
    marketRegime = detectMarketRegimeWithGuards(contextBase, {
      indicators,
      marketData,
      marketStructure,
      volumeAnalysis,
      volatility,
      levels: srLevels,
      news,
      fearGreed,
      btcDominance,
      globalMarket,
      primaryTimeframe: primaryInterval,
      onChainFlow,
    });
    await setCachedRegime(regimeKey, marketRegime).catch(() => undefined);
  }

  const snapshot: AnalysisSnapshot = {
    indicators,
    marketData,
    marketStructure,
    volumeAnalysis,
    volatility,
    levels: srLevels,
    news,
    fearGreed,
    btcDominance,
    globalMarket,
    primaryTimeframe: primaryInterval,
    onChainFlow,
    marketRegime,
  };

  const context: AnalysisContext = {
    ...contextBase,
    marketRegime,
  };

  return { context, snapshot };
}

export async function runPredictionPipeline(
  coin: Coin,
  market: MarketType,
  timeframe: Timeframe,
  onProgress?: ProgressCallback,
  modelOverride?: string
): Promise<PredictionResult> {
  const emit = (step: ProgressEvent["step"], progress: number, message: string) => {
    onProgress?.({ step, progress, message });
  };

  emit("market_data", 10, "Загрузка рыночных данных Binance...");
  const { context, snapshot: analysisSnapshot } = await buildAnalysisContext(coin, market, timeframe);

  emit("candles", 25, "Получение свечей для выбранного таймфрейма...");
  emit("sentiment", 45, "Анализ новостей, Fear & Greed, доминации BTC...");
  emit("indicators", 60, "Расчёт технических индикаторов...");

  emit("ai_analysis", 75, "Генерация AI-прогноза (OpenRouter, может занять 1–3 мин)...");
  const llmPrediction = await generatePrediction(context, modelOverride);

  emit("ensemble", 85, "Ensemble: ML-модель + rule-based + взвешенное голосование...");
  const { prediction: ensembleMerged, breakdown } = await ensemblePredictor.combine(
    context,
    analysisSnapshot,
    llmPrediction
  );

  emit("validation", 92, "Коррекция уровней: ATR, старшие ТФ, мин. ход...");

  const resultBase: PredictionResult = {
    ...ensembleMerged,
    market,
    timeframe,
    coinId: coin.id,
    priceAtPrediction: context.marketData.price,
    analysis: analysisSnapshot,
    ensembleBreakdown: breakdown,
    createdAt: new Date().toISOString(),
  };

  const result = refinePrediction(resultBase, analysisSnapshot, timeframe);

  emit("done", 100, "Прогноз готов");

  const levels = resolveTradeLevels(result);
  const mlFeatures = extractMlFeatures(context).values;
  const withMeta = {
    ...result,
    tradeLevels: { entry: levels.entry, tp: levels.tp, sl: levels.sl, exit: levels.exit },
    mlFeatures,
  };
  return {
    ...withMeta,
    explanation: buildPredictionExplanation(withMeta),
  };
}

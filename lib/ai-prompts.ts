import { TIMEFRAME_CANDLE_CONFIG } from "@/lib/timeframe";
import type { AnalysisContext, Timeframe } from "@/types";

export function buildSystemPrompt(): string {
  return `You are a quantitative crypto price forecaster specialized in technical analysis. Your PRIMARY task is to predict the exact USD price at the end of the given timeframe with maximum precision.

CRITICAL RULES:
1. Base predictions PRIMARILY on price action, indicators, and higher timeframe trend
2. Use ONLY the provided technical data - no external knowledge or assumptions
3. News sentiment is SECONDARY - use only as confirmation, never as sole reason
4. When indicators conflict, prioritize: Higher TF trend > Volume > Momentum > Oscillators
5. If RSI/Stochastic show extremes but trend is strong, follow the trend

LANGUAGE: All text fields (reasons, risks, keyFactors, recommendation, disclaimer) MUST be in Russian.

CRITICAL: Return a single valid JSON object. No markdown, no code fences, no text outside JSON.

Required JSON schema (exact field names):
{
  "coin": "Bitcoin",
  "symbol": "BTC",
  "market": "Futures",
  "timeframe": "24h",
  "direction": "LONG",
  "probability": 72,
  "probabilityUp": 72,
  "probabilityDown": 28,
  "confidence": "High",
  "priceForecast": {
    "predictedPrice": 97200,
    "predictedHigh": 98500,
    "predictedLow": 95800,
    "confidenceBand": { "low": 96800, "high": 97600 },
    "expectedMovePct": 2.31
  },
  "priceRange": { "low": 95500, "high": 99000 },
  "tradeLevels": { "entry": 95000, "tp": 98500, "sl": 95500, "exit": 97200 },
  "reasons": ["причина 1", "причина 2"],
  "risks": ["риск 1"],
  "keyFactors": ["фактор 1"],
  "recommendation": "краткая рекомендация на русском",
  "disclaimer": "Это аналитическая оценка ИИ и не является финансовой рекомендацией."
}

PRICE FORECAST RULES (most important):
1. predictedPrice = your best estimate of the CLOSE price at end of timeframe
2. predictedHigh / predictedLow = expected max/min during the period (use ATR and S/R)
3. confidenceBand = narrow corridor (±0.3–1.5% from predictedPrice depending on volatility) where price is most likely to close
4. expectedMovePct = ((predictedPrice - currentPrice) / currentPrice) * 100, signed number
5. priceRange = wider envelope (typically ±1–3 ATR from current price)
6. tradeLevels.exit MUST equal predictedPrice; tradeLevels.tp ≈ predictedHigh (LONG) or predictedLow (SHORT); tradeLevels.sl = invalidation level
7. All prices must be realistic USD values near the provided current price
8. direction must align with expectedMovePct sign (LONG if positive, SHORT if negative, SIDEWAYS if |expectedMovePct| < 0.5%)
9. Server will refine levels using ATR and higher-TF trend — still provide your best estimate

Allowed values:
- direction: ONLY "LONG", "SHORT", or "SIDEWAYS"
- confidence: ONLY "High", "Medium", or "Low"
- market: ONLY "Spot" or "Futures"
- probability fields: numbers 0-100

ENSEMBLE COOPERATION (server merges your output with ML + rules):
- Your direction/probability are the LLM vote (weight ~50%) in a weighted ensemble
- A separate ML model scores 30+ features including on-chain/order-flow (weight ~35%); rule signals add ~15%
- Market REGIME is pre-classified (Strong Bull/Bear, Mean-Reversion, Breakout, Low Conviction) — align with it unless strong contrary evidence
- On-chain data (funding, OI change, CVD, liquidations) is provided for Futures — use as positioning context, not primary driver
- Provide a clear directional bias (LONG/SHORT) when data supports it — avoid defaulting to SIDEWAYS unless truly neutral
- probability should reflect conviction: 55–65% moderate, 65–80% strong, 80%+ only with multiple aligned signals
- keyFactors should list measurable drivers (RSI zone, EMA stack, HTF trend, funding) — these align with ML features
- Do NOT mention ensemble/ML in user-facing text; server adds refinement notes automatically
- If technicals are mixed, state the dominant HTF trend and assign probability near 50–55%, not extreme values

EXPLAINABILITY (clarity for traders — server builds structured explanation overlay):
- reasons[]: ONE measurable driver per line (indicator value/zone, HTF trend, funding, regime) — no vague phrases like "рынок нестабилен"
- keyFactors[]: short tags a trader can scan (e.g. "RSI 68 — перегрев", "Funding отрицательный", "Strong Bull regime", "CVD растёт")
- risks[]: concrete invalidation (пробой SL, разворот HTF, кластер ликвидаций, расхождение индикаторов)
- recommendation: 1–2 предложения — что делать и при каком условии пересмотреть идею
- Your text must align with the numeric data in the prompt; server will merge it into topDrivers + ensemble rationale`;
}

export function buildUserPrompt(ctx: AnalysisContext): string {
  const primaryInterval = TIMEFRAME_CANDLE_CONFIG[ctx.timeframe as Timeframe]?.primaryInterval ?? "1h";
  const primaryCandles =
    ctx.candles[primaryInterval] ??
    Object.values(ctx.candles).find((c) => c.length > 0) ??
    [];
  const primaryIndicators =
    ctx.indicators[primaryInterval] ?? Object.values(ctx.indicators).find(Boolean);

  const indicatorsByTf = Object.entries(ctx.indicators)
    .filter(([, ind]) => ind != null)
    .map(
      ([tf, ind]) =>
        `${tf}: RSI=${ind.rsi.toFixed(2)}, MACD=${ind.macd.macd.toFixed(4)}, EMA20=${ind.ema20.toFixed(2)}, ADX=${ind.adx.toFixed(2)}, SuperTrend=${ind.superTrend.direction}, ATR=${ind.atr.toFixed(2)}`
    )
    .join("\n");

  const price = ctx.marketData.price;
  const atr = ctx.volatility.atr || price * 0.02;
  const atrPct = ((atr / price) * 100).toFixed(2);

  const fib = primaryIndicators?.fibonacci;
  const pivots = primaryIndicators?.pivotPoints;
  const flow = ctx.onChainFlow;
  const regime = ctx.marketRegime;

  const onChainBlock =
    ctx.market === "Futures" && flow
      ? `
=== ON-CHAIN / ORDER FLOW (Futures) ===
Funding Rate: ${flow.fundingOi.fundingRate} (avg 8h: ${flow.fundingOi.fundingRateAvg8h}, trend: ${flow.fundingOi.fundingTrend})
Open Interest: ${flow.fundingOi.openInterest} (24h change: ${flow.fundingOi.openInterestChange24hPct.toFixed(2)}%)
Long/Short Ratio: ${flow.fundingOi.longShortRatio ?? "n/a"}
CVD (normalized): ${flow.orderFlow.cvd.toFixed(3)} (trend: ${flow.orderFlow.cvdTrend})
Taker Buy Ratio: ${(flow.orderFlow.takerBuyRatio * 100).toFixed(1)}%
Delta Imbalance: ${flow.orderFlow.deltaImbalance.toFixed(3)}
Nearest Long Liq: ${flow.liquidations.nearestLongLiq ? `$${flow.liquidations.nearestLongLiq.toFixed(2)}` : "n/a"}
Nearest Short Liq: ${flow.liquidations.nearestShortLiq ? `$${flow.liquidations.nearestShortLiq.toFixed(2)}` : "n/a"}
Liq source: ${flow.liquidations.source}`
      : "";

  const regimeBlock = regime
    ? `
=== MARKET REGIME (pre-classified) ===
Regime: ${regime.regime} (confidence ${regime.confidence}%)
Bias score: ${regime.score.toFixed(2)}
Signals: ${regime.signals.join("; ")}`
    : "";

  return `Forecast ${ctx.coin.name} (${ctx.coin.symbol}) for ${ctx.market} market.
Prediction horizon: ${ctx.timeframe} (predict price at END of this period)

=== CURRENT PRICE (baseline for forecast) ===
Price NOW: $${price}
ATR: $${atr.toFixed(2)} (${atrPct}% of price)
Daily volatility: ${ctx.volatility.dailyVolatility.toFixed(2)}%

=== MARKET DATA ===
24h Change: ${ctx.marketData.priceChangePercent24h}%
24h High: $${ctx.marketData.high24h}
24h Low: $${ctx.marketData.low24h}
Volume: ${ctx.marketData.volume}
${ctx.marketData.fundingRate !== undefined ? `Funding Rate: ${ctx.marketData.fundingRate}` : ""}
${ctx.marketData.openInterest !== undefined ? `Open Interest: ${ctx.marketData.openInterest}` : ""}
${onChainBlock}
${regimeBlock}

=== TECHNICAL INDICATORS (${primaryInterval}) ===
${primaryIndicators ? JSON.stringify(primaryIndicators, null, 2) : "Insufficient data"}

=== INDICATORS BY TIMEFRAME ===
${indicatorsByTf || "Insufficient data"}

=== MARKET STRUCTURE ===
Trend: ${ctx.marketStructure.trend}
Higher Highs: ${ctx.marketStructure.higherHighs}, Higher Lows: ${ctx.marketStructure.higherLows}
Lower Highs: ${ctx.marketStructure.lowerHighs}, Lower Lows: ${ctx.marketStructure.lowerLows}

=== SUPPORT & RESISTANCE ===
Nearest Support: $${ctx.levels.nearestSupport}
Nearest Resistance: $${ctx.levels.nearestResistance}
Strong Levels: ${ctx.levels.strongLevels.map((l) => `$${l.toFixed(2)}`).join(", ")}
${pivots ? `Pivot: $${pivots.pivot}, R1: $${pivots.r1}, S1: $${pivots.s1}` : ""}
${fib ? `Fib 0.618: $${fib.level618.toFixed(2)}, Fib 0.382: $${fib.level382.toFixed(2)}` : ""}

=== VOLATILITY & VOLUME ===
ATR: ${ctx.volatility.atr}
Volume trend: ${ctx.volumeAnalysis.volumeTrend}

=== SENTIMENT (SECONDARY - use only as confirmation) ===
Fear & Greed: ${ctx.fearGreed.value} (${ctx.fearGreed.classification})
BTC Dominance: ${ctx.btcDominance.dominance.toFixed(2)}%
News summary: ${ctx.news.summary.slice(0, 200)}${ctx.news.summary.length > 200 ? "..." : ""}
${ctx.news.aggregateScore !== undefined ? `News aggregate score: ${ctx.news.aggregateScore} (${ctx.news.sentimentSource ?? "lexicon"})` : ""}

IMPORTANT: Base your prediction on technical indicators above. News should only confirm technical signals, NOT override them.

=== RECENT OHLCV (last 10 candles, ${primaryInterval}) ===
${primaryCandles.slice(-10).map((c) => `O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume}`).join("\n")}

TASK: Predict the exact closing price at the end of ${ctx.timeframe}.
Current price is $${price}. Your predictedPrice must be a precise USD number derived from the data above.
confidenceBand should be narrow (high precision target). priceRange is the wider envelope.
Write reasons, risks, keyFactors, recommendation in Russian.

ENSEMBLE NOTE: Your JSON direction/probability will be combined server-side with an ML scorer (logistic/LightGBM on the indicators above) and rule-based guards (HTF bias, funding, RSI extremes). Give your best independent technical forecast — the ensemble may adjust direction if ML/rules diverge strongly.`;
}

export function buildRepairPrompt(brokenContent: string, ctx: AnalysisContext): string {
  return `Fix the broken response into valid JSON only.
Must include priceForecast with predictedPrice, predictedHigh, predictedLow, confidenceBand, expectedMovePct.
direction: LONG, SHORT or SIDEWAYS. confidence: High, Medium or Low.

Coin: ${ctx.coin.name} (${ctx.coin.symbol})
Market: ${ctx.market}
Timeframe: ${ctx.timeframe}
Current price: $${ctx.marketData.price}

Broken response:
${brokenContent.slice(0, 3000)}

Return ONLY corrected JSON, nothing else.`;
}

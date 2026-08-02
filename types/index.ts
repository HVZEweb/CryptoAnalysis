export type MarketType = "Spot" | "Futures";

export type Timeframe =
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "12h"
  | "24h"
  | "3d"
  | "7d";

export interface Coin {
  id: string;
  symbol: string;
  name: string;
  image?: string;
}

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
}

export interface MarketData {
  symbol: string;
  price: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  high24h: number;
  low24h: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  fundingRate?: number;
  openInterest?: number;
  longShortRatio?: number;
}

export interface TechnicalIndicators {
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  ema20: number;
  ema50: number;
  ema100: number;
  ema200: number;
  sma: number;
  bollingerBands: { upper: number; middle: number; lower: number };
  atr: number;
  adx: number;
  vwap: number;
  obv: number;
  stochasticRsi: { k: number; d: number };
  cci: number;
  ichimoku: {
    tenkan: number;
    kijun: number;
    senkouA: number;
    senkouB: number;
    chikou: number;
  };
  pivotPoints: {
    pivot: number;
    r1: number;
    r2: number;
    r3: number;
    s1: number;
    s2: number;
    s3: number;
  };
  fibonacci: {
    level0: number;
    level236: number;
    level382: number;
    level500: number;
    level618: number;
    level786: number;
    level100: number;
  };
  superTrend: { value: number; direction: "bullish" | "bearish" };
}

export type TrendDirection = "Bullish" | "Bearish" | "Sideways";

export interface MarketStructure {
  higherHighs: boolean;
  higherLows: boolean;
  lowerHighs: boolean;
  lowerLows: boolean;
  trend: TrendDirection;
}

export interface VolumeAnalysis {
  volumeTrend: "increasing" | "decreasing" | "stable";
  averageVolume30d: number;
  anomalousVolume: boolean;
  recentVolumes: number[];
}

export interface VolatilityData {
  atr: number;
  dailyVolatility: number;
  weeklyVolatility: number;
}

export interface SupportResistance {
  nearestSupport: number;
  nearestResistance: number;
  strongLevels: number[];
  liquidityZones: number[];
}

export interface NewsItem {
  title: string;
  source: string;
  publishedAt: string;
  sentiment: "positive" | "negative" | "neutral";
}

export interface NewsSummary {
  items: NewsItem[];
  positive: number;
  negative: number;
  neutral: number;
  summary: string;
  /** Aggregated sentiment score (−1…1) */
  aggregateScore?: number;
  sentimentSource?: "finbert" | "lexicon";
}

export interface FearGreedIndex {
  value: number;
  classification: string;
}

export interface BtcDominance {
  dominance: number;
  change24h: number;
}

export interface GlobalMarket {
  totalMarketCap: number;
  totalVolume: number;
  marketCapChange24h: number;
}

/** P2: funding + open interest detail */
export interface FundingOiData {
  fundingRate: number;
  fundingRateAvg8h: number;
  fundingTrend: "rising" | "falling" | "stable";
  openInterest: number;
  openInterestChange24hPct: number;
  longShortRatio?: number;
  markPrice?: number;
  nextFundingTime?: string;
}

export interface LiquidationLevel {
  price: number;
  side: "long" | "short";
  estimatedUsd?: number;
  distancePct: number;
}

export interface LiquidationData {
  levels: LiquidationLevel[];
  nearestLongLiq?: number;
  nearestShortLiq?: number;
  totalEstimatedUsd24h?: number;
  source: "coinglass" | "binance_proxy" | "estimated";
}

export interface OrderFlowData {
  /** Normalized cumulative volume delta (−1…1) */
  cvd: number;
  cvdTrend: "rising" | "falling" | "flat";
  /** Share of taker buy volume in recent window (0–1) */
  takerBuyRatio: number;
  /** Buy vs sell pressure (−1…1) */
  deltaImbalance: number;
  source: "binance" | "proxy";
}

export interface OnChainFlowData {
  fundingOi: FundingOiData;
  liquidations: LiquidationData;
  orderFlow: OrderFlowData;
}

export type MarketRegimeType =
  | "Strong Bull"
  | "Strong Bear"
  | "Mean-Reversion"
  | "Breakout"
  | "Low Conviction";

export interface MarketRegime {
  regime: MarketRegimeType;
  /** 0–100 confidence in regime classification */
  confidence: number;
  /** Directional bias score (−1…1) */
  score: number;
  signals: string[];
  /** HTF vs regime conflict reduces actionable confidence */
  htfConflict?: boolean;
  /** Suggested confidence cap from regime logic */
  confidenceCap?: ConfidenceLevel;
  suppressTrade?: boolean;
}

export interface AnalysisContext {
  coin: Coin;
  market: MarketType;
  timeframe: Timeframe;
  marketData: MarketData;
  candles: Record<string, Candle[]>;
  indicators: Record<string, TechnicalIndicators>;
  marketStructure: MarketStructure;
  volumeAnalysis: VolumeAnalysis;
  volatility: VolatilityData;
  levels: SupportResistance;
  news: NewsSummary;
  fearGreed: FearGreedIndex;
  btcDominance: BtcDominance;
  globalMarket: GlobalMarket;
  /** P2: on-chain / order-flow (Futures-focused; neutral defaults on Spot) */
  onChainFlow?: OnChainFlowData;
  /** P2: detected market regime */
  marketRegime?: MarketRegime;
}

export type PredictionDirection = "LONG" | "SHORT" | "SIDEWAYS";

export type ConfidenceLevel = "High" | "Medium" | "Low";

/** ML sub-model output for ensemble voting */
export interface MlPrediction {
  direction: PredictionDirection;
  probability: number;
  probabilityUp: number;
  probabilityDown: number;
  model: string;
  /** 0–100 model self-confidence */
  confidence: number;
  keyFeatures: string[];
  /** Where the score was computed */
  source?: "python" | "typescript";
  /** Set when Python failed and TS fallback was used */
  fallbackReason?: string;
}

/** Ensemble vote breakdown for transparency */
export interface EnsembleBreakdown {
  weights: { llm: number; ml: number; rules: number };
  llm: { direction: PredictionDirection; probability: number; score: number };
  ml: MlPrediction;
  rules: Array<{ direction: PredictionDirection; probability: number; reason: string }>;
  ensembleScore: number;
  agreement: "full" | "partial" | "divergent";
  /** False when ML subsystem failed — vote used LLM + rules only */
  mlAvailable: boolean;
  /** Weights after ML dropout renormalization */
  effectiveWeights: { llm: number; ml: number; rules: number };
  rulesAggregateScore: number;
  finalDirection: PredictionDirection;
  finalProbability: number;
  /** Present when ML subsystem failed */
  mlError?: string;
  /** Meta-learner trust 0–100 */
  metaTrustScore?: number;
  lowConfidence?: boolean;
  dynamicWeightsUsed?: boolean;
}

/** Количественный прогноз цены на конец таймфрейма. */
export interface PriceForecast {
  /** Ожидаемая цена закрытия на конец таймфрейма */
  predictedPrice: number;
  /** Ожидаемый максимум за период */
  predictedHigh: number;
  /** Ожидаемый минимум за период */
  predictedLow: number;
  /** Узкий коридор (≈90% уверенность) */
  confidenceBand: { low: number; high: number };
  /** Ожидаемое изменение от цены прогноза, % */
  expectedMovePct: number;
}

export interface AnalysisSnapshot {
  indicators: Record<string, TechnicalIndicators>;
  marketData: MarketData;
  marketStructure: MarketStructure;
  volumeAnalysis: VolumeAnalysis;
  volatility: VolatilityData;
  levels: SupportResistance;
  news: NewsSummary;
  fearGreed: FearGreedIndex;
  btcDominance: BtcDominance;
  globalMarket: GlobalMarket;
  primaryTimeframe: string;
  onChainFlow?: OnChainFlowData;
  marketRegime?: MarketRegime;
}

export interface PredictionResult {
  coin: string;
  symbol: string;
  market: MarketType;
  timeframe: Timeframe;
  direction: PredictionDirection;
  probability: number;
  probabilityUp: number;
  probabilityDown: number;
  confidence: ConfidenceLevel;
  priceRange: { low: number; high: number };
  priceForecast?: PriceForecast;
  reasons: string[];
  risks: string[];
  keyFactors: string[];
  recommendation: string;
  disclaimer: string;
  createdAt: string;
  priceAtPrediction: number;
  coinId: string;
  tradeLevels?: { entry: number; tp: number; sl: number; exit: number };
  analysis?: AnalysisSnapshot;
  /** Серверные коррекции после ответа AI */
  refinementNotes?: string[];
  /** Weighted ensemble score (−1…1): positive = long bias */
  ensembleScore?: number;
  /** Top ML / technical features driving ensemble */
  keyFeatures?: string[];
  /** Full ensemble breakdown (optional, for API/debug) */
  ensembleBreakdown?: EnsembleBreakdown;
  /** Meta-learner: weak ensemble signal */
  lowConfidence?: boolean;
  metaTrustScore?: number;
  /** Rolling live accuracy confidence (from prediction monitor) */
  modelConfidence?: {
    score: number;
    label: "High" | "Medium" | "Low";
    rollingAccuracy30d: number;
    sampleCount: number;
    driftAlert: boolean;
    driftCount?: number;
  };
  /** Flat ML features captured at prediction time (for monitoring retrain) */
  mlFeatures?: Record<string, number>;
  /** Структурированное объяснение прогноза для трейдера */
  explanation?: PredictionExplanation;
}

/** Понятное объяснение прогноза на русском */
export interface PredictionExplanation {
  summary: string;
  topDrivers: Array<{
    label: string;
    detail: string;
    bias: "bullish" | "bearish" | "neutral";
    source: "technical" | "regime" | "onchain" | "sentiment" | "ensemble";
  }>;
  ensembleRationale: string;
  ensembleVotes: Array<{
    component: string;
    direction: string;
    weight: string;
    note: string;
  }>;
  strengths: string[];
  weaknesses: string[];
  technicalDepth: string;
}

export interface PredictionFormData {
  coinSymbol: string;
  market: MarketType;
  timeframe: Timeframe;
  model?: string;
}

export interface ApiError {
  code:
    | "API_UNAVAILABLE"
    | "OPENROUTER_ERROR"
    | "RATE_LIMIT"
    | "QUOTA_EXCEEDED"
    | "NO_INTERNET"
    | "INVALID_RESPONSE"
    | "VALIDATION_ERROR"
    | "UNKNOWN";
  message: string;
}

export interface QuotaStatus {
  tier: "anon" | "registered" | "paid";
  used: number;
  limit: number;
  remaining: number;
  isLoggedIn: boolean;
  email?: string;
  requiresAuth: boolean;
  requiresPayment: boolean;
}

export interface AuthUser {
  email: string;
  tier: "anon" | "registered" | "paid";
  predictionsUsed: number;
}

export interface PredictionHistoryItem extends PredictionResult {
  id: string;
}

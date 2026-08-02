import type { PredictionDirection } from "@/types";
import type { ImpactOnExisting } from "@/services/news-impact/prediction-link";
import type { AffectedCoin } from "@/services/news-impact/coin-resolver";
import type { NewsImpactAlert } from "@/services/news-impact/alerts";
import type {
  HistoryPerformanceSummary,
  NewsImpactHistoryRow,
} from "@/services/news-impact/history";

export type NewsImpactStrength = "Low" | "Medium" | "High" | "Extreme";
export type NewsImpactBias = "Bullish" | "Bearish" | "Neutral";
export type NewsImpactDuration = "5min" | "15min" | "1h" | ">1h";
export type NewsImpactUrgency = "Immediate" | "Short" | "Medium";
export type NewsRecommendedAction = "Long Futures" | "Short" | "Wait";

export type NewsImpactSource = "rss" | "twitter" | "cryptopanic" | "google-news" | "telegram";

export interface RawNewsSignal {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  source: string;
  sourceType: NewsImpactSource;
  publishedAt: string;
  keywordHits: string[];
  significanceScore: number;
  /** Higher = fetched/processed sooner (twitter 100, telegram 95, …) */
  sourcePriority?: number;
  /** Pre-detected symbols from source metadata ($TICKER, CryptoPanic currencies) */
  hintCoins?: string[];
}

export interface RuleAnalysisResult {
  coins: string[];
  bias: NewsImpactBias;
  strength: NewsImpactStrength;
  impactScore: number;
  duration: NewsImpactDuration;
  category: string;
  reason: string;
  matchedRules: string[];
  priorityTriggers: string[];
  filtered?: boolean;
  filterReason?: string;
  contextNote?: string;
  secondaryCoins?: string[];
  affectedCoins?: AffectedCoin[];
  sectorLabel?: string;
}

export interface LlmNewsClassification {
  coin: string;
  bias: NewsImpactBias;
  strength: NewsImpactStrength;
  duration: NewsImpactDuration;
  impactScore: number;
  reason: string;
  confidence: number;
}

export interface NewsImpactPrediction {
  coin: string;
  direction: PredictionDirection;
  impactScore: number;
  strength: NewsImpactStrength;
  reason: string;
  suggestedHoldTime: string;
  timestamp: string;
  source: string;
  sourceUrl?: string;
  category: string;
  duration: NewsImpactDuration;
  newsId: string;
  analysisMethod: "rules" | "llm" | "hybrid";
  urgency: NewsImpactUrgency;
  recommendedAction: NewsRecommendedAction;
  expectedMovePct: number;
  relatedPredictionId?: string;
  impactOnExisting: ImpactOnExisting;
  llmNote?: string;
  isSecondary?: boolean;
  confidence: number;
  mlScore?: number;
  newsContext?: string;
  marketContext?: string;
  regimeProxy?: string;
  affectedCoins?: AffectedCoin[];
  sectorLabel?: string;
  newsTitle?: string;
}

export type LlmLogOutcome = "skipped" | "success" | "failed";

export interface LlmLogEntry {
  at: string;
  newsId: string;
  title: string;
  outcome: LlmLogOutcome;
  reason: string;
  model?: string;
}

export interface NewsImpactEngineState {
  running: boolean;
  intervalMs: number;
  lastTickAt: string | null;
  lastError: string | null;
  processedCount: number;
  significantCount: number;
  filteredCount: number;
  recentImpacts: NewsImpactPrediction[];
  lastFetchedCount: number;
  recentLlmLogs: LlmLogEntry[];
  alertsEnabled: boolean;
  recentAlerts: NewsImpactAlert[];
  historyPerformance: HistoryPerformanceSummary;
  recentHistory: NewsImpactHistoryRow[];
}

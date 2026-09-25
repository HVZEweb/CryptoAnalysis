import type { PredictionDirection } from "@/types";

export type NewsImpactStrength = "Low" | "Medium" | "High" | "Extreme";
export type NewsImpactUrgency = "Immediate" | "Short" | "Medium";
export type NewsRecommendedAction = "Long Futures" | "Short" | "Wait";
export type ImpactOnExisting = "confirms" | "contradicts" | "neutral" | "none";

export interface AffectedCoin {
  coin: string;
  weight: number;
}

export interface NewsImpactSignal {
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
  duration: string;
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

export interface NewsImpactAlert {
  id: string;
  at: string;
  newsId: string;
  coin: string;
  direction: string;
  impactScore: number;
  strength: string;
  urgency: string;
  expectedMovePct: number;
  reason: string;
  sourceUrl?: string;
  sectorLabel?: string;
  affectedCoins?: string;
  channels: string[];
  success: boolean;
  error?: string;
}

export interface NewsImpactHistoryRow {
  id: string;
  newsId: string;
  coin: string;
  newsTitle: string;
  newsUrl: string | null;
  predictedDirection: string;
  impactScore: number;
  expectedMovePct: number;
  priceAtNews: number | null;
  actualMove5m: number | null;
  actualMove15m: number | null;
  actualMove30m: number | null;
  actualMove60m: number | null;
  actualDirection: string | null;
  outcomeComplete: boolean;
  createdAt: string;
}

export interface HistoryPerformanceSummary {
  total: number;
  withOutcome: number;
  directionHitRate: number;
  avgMove5m: number;
  avgMove15m: number;
  avgMove30m: number;
  avgMove60m: number;
  avgExpectedMove: number;
}

export interface NewsImpactState {
  running: boolean;
  intervalMs: number;
  lastTickAt: string | null;
  lastError: string | null;
  processedCount: number;
  significantCount: number;
  filteredCount: number;
  recentImpacts: NewsImpactSignal[];
  lastFetchedCount: number;
  recentLlmLogs?: LlmLogEntry[];
  alertsEnabled: boolean;
  recentAlerts: NewsImpactAlert[];
  historyPerformance: HistoryPerformanceSummary;
  recentHistory: NewsImpactHistoryRow[];
}

export type NewsImpactApiResponse = NewsImpactState;

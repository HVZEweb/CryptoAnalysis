import type {
  ConfidenceLevel,
  MarketRegimeType,
  MarketType,
  PredictionDirection,
  Timeframe,
} from "@/types";

export interface PredictionOutcome {
  evaluatedAt: string;
  actualPrice: number;
  score: number;
  isCorrect: boolean | null;
  label: string;
  percentChange: number;
  timeframePhase: "in_progress" | "completed";
  priceErrorPct: number;
}

export interface MonitoredPrediction {
  id: string;
  recordedAt: string;
  symbol: string;
  market: MarketType;
  timeframe: Timeframe;
  direction: PredictionDirection;
  probability: number;
  confidence: ConfidenceLevel;
  priceAtPrediction: number;
  regime?: MarketRegimeType;
  ensembleScore?: number;
  metaTrustScore?: number;
  outcome?: PredictionOutcome;
  /** ML feature vector captured at prediction time */
  features?: Record<string, number>;
}

export interface RollingWindowMetrics {
  windowDays: number;
  total: number;
  completed: number;
  inProgress: number;
  /** Fraction with score >= 72 among completed */
  accuracyRate: number;
  /** Fraction with isCorrect === true among completed */
  winRate: number;
  avgScore: number;
  avgPriceErrorPct: number;
}

export interface SegmentMetrics {
  key: string;
  label: string;
  completed: number;
  accuracyRate: number;
  avgScore: number;
}

export interface AccuracyTimePoint {
  date: string;
  completed: number;
  accuracyRate: number;
  avgScore: number;
}

export interface EquityPoint {
  timestamp: number;
  cumulativeReturnPct: number;
}

export interface DriftAlert {
  dimension: "regime" | "symbol" | "timeframe" | "overall";
  key: string;
  label: string;
  baselineAccuracy: number;
  recentAccuracy: number;
  dropPct: number;
  baselineSamples: number;
  recentSamples: number;
  severity: "warning" | "critical";
}

export interface PerformanceSnapshot {
  generatedAt: string;
  windows: RollingWindowMetrics[];
  byRegime: SegmentMetrics[];
  bySymbol: SegmentMetrics[];
  byTimeframe: SegmentMetrics[];
  accuracyOverTime: AccuracyTimePoint[];
  equityCurve: EquityPoint[];
  modelConfidence: ModelConfidenceSummary;
}

export interface ModelConfidenceSummary {
  score: number;
  label: "High" | "Medium" | "Low";
  rollingAccuracy30d: number;
  sampleCount: number;
  driftAlert: boolean;
  driftCount: number;
}

export interface MonitorStore {
  updatedAt: string;
  records: MonitoredPrediction[];
}

export type MonitoringAlertKind = "drift" | "sharp_drop" | "regime_shift";

export interface MonitoringAlert {
  id: string;
  kind: MonitoringAlertKind;
  severity: "warning" | "critical";
  title: string;
  message: string;
  dimension?: string;
  key?: string;
  createdAt: string;
  dispatched: boolean;
  channels: string[];
}

export interface RetrainRunRecord {
  id: string;
  startedAt: string;
  finishedAt: string;
  trigger: "scheduled" | "drift" | "manual" | "forced";
  ok: boolean;
  samples: number;
  backtestSamples: number;
  liveSamples: number;
  weightsPath?: string;
  error?: string;
}

export interface RetrainSchedulerState {
  updatedAt: string;
  lastRun?: RetrainRunRecord;
  history: RetrainRunRecord[];
  nextScheduledAt?: string;
  intervalDays: number;
}

export interface RetrainDecision {
  shouldRun: boolean;
  trigger?: RetrainRunRecord["trigger"];
  reason: string;
  driftAlerts: number;
  daysSinceLastRun: number | null;
}

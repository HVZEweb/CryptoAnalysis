import type {
  ConfidenceLevel,
  MarketRegimeType,
  MarketType,
  PredictionDirection,
  Timeframe,
} from "@/types";

/** Single backtest observation — prediction at T vs outcome at T+horizon */
export interface BacktestTrade {
  timestamp: number;
  timeframe: Timeframe;
  regime: MarketRegimeType;
  direction: PredictionDirection;
  probability: number;
  confidence: ConfidenceLevel;
  ensembleScore: number;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  won: boolean;
  /** Component-level accuracy for dynamic weight calibration */
  llmCorrect: boolean;
  mlCorrect: boolean;
  rulesCorrect: boolean;
  walkForwardFold?: number;
}

export interface RegimePerformanceStats {
  regime: MarketRegimeType;
  trades: number;
  winRate: number;
  avgReturnPct: number;
  llmWinRate: number;
  mlWinRate: number;
  rulesWinRate: number;
}

export interface BacktestMetrics {
  totalTrades: number;
  winRate: number;
  expectancy: number;
  sharpeRatio: number;
  profitFactor: number;
  maxDrawdownPct: number;
  avgReturnPct: number;
  accuracyByRegime: RegimePerformanceStats[];
  performanceByTimeframe: Record<string, { trades: number; winRate: number; avgReturnPct: number }>;
}

export interface WalkForwardFold {
  fold: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  trainMetrics: BacktestMetrics;
  testMetrics: BacktestMetrics;
  regimeStats: RegimePerformanceStats[];
}

export interface BacktestReport {
  symbol: string;
  market: MarketType;
  timeframe: Timeframe;
  periodStart: number;
  periodEnd: number;
  mode: BacktestMode;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  walkForward?: WalkForwardFold[];
  generatedAt: string;
  notes: string[];
  runId?: string;
  trainingExport?: TrainingExportResult;
  mlRetrain?: MlRetrainReport;
  /** In-memory training rows (not sent to client by default) */
  trainingRecords?: import("@/lib/backtesting/training-export").BacktestTrainingRecord[];
}

export type BacktestMode = "ensemble" | "full";

export interface BacktestConfig {
  symbol: string;
  market: MarketType;
  timeframe: Timeframe;
  /** Period length in days (max 730) */
  periodDays: number;
  mode?: BacktestMode;
  /** Cap observations to protect API runtime */
  maxTrades?: number;
  walkForward?: {
    trainDays: number;
    testDays: number;
    stepDays: number;
  };
  /** Use stored regime performance for weight hints */
  useDynamicWeights?: boolean;
  /** Collect and export training JSONL after run */
  exportTraining?: boolean;
  /** Retrain the price predictor after export (requires exportTraining) */
  retrainMl?: boolean;
}

export interface TrainingExportResult {
  path: string;
  count: number;
  labeledCount: number;
}

export interface MlRetrainReport {
  ok: boolean;
  samples: number;
  outputPath: string;
  weightsPath?: string;
  error?: string;
}

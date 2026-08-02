export * from "@/services/news-impact/types";
export { fetchImpactNews, IMPACT_KEYWORDS } from "@/services/news-impact/news-fetcher";
export {
  preFilterSignal,
  detectPriorityTriggers,
  normalizeTitleForDedup,
  isSimilarHeadline,
  buildNewsFingerprint,
  NOISE_PATTERNS,
  BLACKLIST_WORDS,
} from "@/services/news-impact/news-filter";
export { DedupCooldownStore, COIN_COOLDOWN_MS } from "@/services/news-impact/dedup-cooldown";
export {
  getActivePredictionForCoin,
  resolveImpactOnExisting,
  biasAlignmentBoost,
} from "@/services/news-impact/prediction-link";
export {
  detectCoinsFromText,
  resolveCoinsFromText,
  resolvePrimaryCoin,
  resolveSecondaryCoins,
  resolveAffectedCoins,
  getSectorLabel,
  sectorImpactBoost,
  isMajorCoin,
  ECOSYSTEM_ALIASES,
  MAJOR_SYMBOLS,
  SECTOR_PEERS,
} from "@/services/news-impact/coin-resolver";
export {
  IMPACT_RULES,
  matchImpactRules,
  applyRuleContext,
} from "@/services/news-impact/impact-rules";
export {
  analyzeWithRules,
  classifyWithLlm,
  runPreFilter,
  shouldUseLlm,
  evaluateLlmDecision,
} from "@/services/news-impact/news-analyzer";
export {
  buildImpactPrediction,
  buildImpactPredictionsWithContext,
  buildImpactPredictionWithContext,
  rankPredictions,
  isHotSignal,
} from "@/services/news-impact/impact-predictor";
export { scoreImpactMl, blendImpactScore } from "@/services/news-impact/impact-ml";
export { fetchNewsPriceContext } from "@/services/news-impact/news-context";
export { fetchCoinMarketSnapshot } from "@/services/news-impact/market-snapshot";
export { NewsImpactEngine, getNewsImpactEngine } from "@/services/news-impact/news-impact-engine";
export {
  shouldSendAlert,
  dispatchNewsImpactAlert,
  formatAlertMessage,
  isAlertsEnabled,
  setAlertsEnabled,
  loadAlertsSettings,
  getRecentAlerts,
} from "@/services/news-impact/alerts";
export {
  saveImpactHistory,
  processOutcomeQueue,
  getRecentHistory,
  getHistoryPerformance,
  startOutcomeTrackingJob,
  stopOutcomeTrackingJob,
} from "@/services/news-impact/history";

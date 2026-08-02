import fs from "fs/promises";
import path from "path";
import { fetchImpactNews } from "@/services/news-impact/news-fetcher";
import { DedupCooldownStore } from "@/services/news-impact/dedup-cooldown";
import { isSimilarHeadline } from "@/services/news-impact/news-filter";
import {
  analyzeWithRules,
  classifyWithLlm,
  evaluateLlmDecision,
  logLlmSkipped,
  runPreFilter,
} from "@/services/news-impact/news-analyzer";
import { resolvePrimaryCoin } from "@/services/news-impact/coin-resolver";
import { buildImpactPredictionsWithContext, rankPredictions } from "@/services/news-impact/impact-predictor";
import { getRecentLlmLogs, loadLlmLogsFromDisk } from "@/services/news-impact/llm-log";
import { fetchNewsPriceContext } from "@/services/news-impact/news-context";
import { fetchCoinMarketSnapshot } from "@/services/news-impact/market-snapshot";
import {
  dispatchNewsImpactAlert,
  getRecentAlerts,
  isAlertsEnabled,
  loadAlertsFromDisk,
  loadAlertsSettings,
} from "@/services/news-impact/alerts";
import {
  getHistoryPerformance,
  getRecentHistory,
  saveImpactHistory,
  startOutcomeTrackingJob,
  stopOutcomeTrackingJob,
} from "@/services/news-impact/history";
import type { NewsImpactEngineState, NewsImpactPrediction } from "@/services/news-impact/types";

const CACHE_DIR = path.join(process.cwd(), ".cache", "news-impact");
const STATE_PATH = path.join(CACHE_DIR, "state.json");
const SEEN_PATH = path.join(CACHE_DIR, "seen-ids.json");
const MAX_RECENT = 50;
const MAX_SEEN = 2000;
const DEFAULT_HISTORY_PERF = {
  total: 0,
  withOutcome: 0,
  directionHitRate: 0,
  avgMove5m: 0,
  avgMove15m: 0,
  avgMove30m: 0,
  avgMove60m: 0,
  avgExpectedMove: 0,
};

async function loadHistoryState(): Promise<{
  recentHistory: Awaited<ReturnType<typeof getRecentHistory>>;
  historyPerformance: Awaited<ReturnType<typeof getHistoryPerformance>>;
}> {
  const [recentHistory, historyPerformance] = await Promise.all([
    getRecentHistory(15),
    getHistoryPerformance(),
  ]);
  return { recentHistory, historyPerformance };
}

function getIntervalMs(): number {
  const raw = parseInt(process.env.NEWS_IMPACT_INTERVAL_MS ?? "", 10);
  if (Number.isFinite(raw) && raw >= 30_000 && raw <= 300_000) return raw;
  return 60_000;
}

async function loadSeenIds(): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(SEEN_PATH, "utf-8");
    const ids = JSON.parse(raw) as string[];
    return new Set(ids);
  } catch {
    return new Set();
  }
}

async function saveSeenIds(seen: Set<string>): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const arr = [...seen].slice(-MAX_SEEN);
  await fs.writeFile(SEEN_PATH, JSON.stringify(arr), "utf-8");
}

async function persistState(state: NewsImpactEngineState): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

async function loadState(): Promise<NewsImpactEngineState | null> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf-8");
    return JSON.parse(raw) as NewsImpactEngineState;
  } catch {
    return null;
  }
}

export class NewsImpactEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private seenIds = new Set<string>();
  private dedup = new DedupCooldownStore();
  private state: NewsImpactEngineState = {
    running: false,
    intervalMs: getIntervalMs(),
    lastTickAt: null,
    lastError: null,
    processedCount: 0,
    significantCount: 0,
    filteredCount: 0,
    recentImpacts: [],
    lastFetchedCount: 0,
    recentLlmLogs: [],
    alertsEnabled: false,
    recentAlerts: [],
    historyPerformance: DEFAULT_HISTORY_PERF,
    recentHistory: [],
  };

  async init(): Promise<void> {
    this.seenIds = await loadSeenIds();
    await this.dedup.load();
    await loadLlmLogsFromDisk(30);
    await loadAlertsSettings();
    await loadAlertsFromDisk(20);
    const historyState = await loadHistoryState();
    const saved = await loadState();
    if (saved) {
      this.state = {
        ...saved,
        running: false,
        intervalMs: getIntervalMs(),
        filteredCount: saved.filteredCount ?? 0,
        recentLlmLogs: saved.recentLlmLogs ?? getRecentLlmLogs(20),
        alertsEnabled: isAlertsEnabled(),
        recentAlerts: getRecentAlerts(15),
        historyPerformance: historyState.historyPerformance,
        recentHistory: historyState.recentHistory,
      };
    } else {
      this.state.recentLlmLogs = getRecentLlmLogs(20);
      this.state.alertsEnabled = isAlertsEnabled();
      this.state.recentAlerts = getRecentAlerts(15);
      this.state.historyPerformance = historyState.historyPerformance;
      this.state.recentHistory = historyState.recentHistory;
    }
  }

  private async refreshAuxState(): Promise<void> {
    const historyState = await loadHistoryState();
    this.state.alertsEnabled = isAlertsEnabled();
    this.state.recentAlerts = getRecentAlerts(15);
    this.state.historyPerformance = historyState.historyPerformance;
    this.state.recentHistory = historyState.recentHistory;
  }

  getState(): NewsImpactEngineState {
    return {
      ...this.state,
      recentImpacts: [...this.state.recentImpacts],
      recentLlmLogs: getRecentLlmLogs(20),
      alertsEnabled: isAlertsEnabled(),
      recentAlerts: getRecentAlerts(15),
    };
  }

  isRunning(): boolean {
    return this.state.running;
  }

  async start(): Promise<NewsImpactEngineState> {
    await this.init();
    if (this.timer) return this.getState();

    this.state.running = true;
    this.state.intervalMs = getIntervalMs();
    startOutcomeTrackingJob();
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.state.intervalMs);

    await persistState(this.state);
    return this.getState();
  }

  async stop(): Promise<NewsImpactEngineState> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state.running = false;
    stopOutcomeTrackingJob();
    await persistState(this.state);
    return this.getState();
  }

  private shouldSkipSignal(signal: { id: string; title: string }, fingerprint: string): string | null {
    if (this.seenIds.has(signal.id)) return "seen_id";
    if (this.dedup.isFingerprintSeen(fingerprint)) return "cached_fingerprint";
    if (this.dedup.hasSimilarRecentTitle(signal.title, isSimilarHeadline)) return "similar_headline";
    return null;
  }

  async tick(): Promise<NewsImpactPrediction[]> {
    if (this.ticking) return [];
    this.ticking = true;
    const newImpacts: NewsImpactPrediction[] = [];

    try {
      await this.dedup.load();
      const signals = await fetchImpactNews();
      this.state.lastFetchedCount = signals.length;

      for (const signal of signals.slice(0, 12)) {
        const pre = runPreFilter(signal);
        if (!pre.ok) {
          this.state.filteredCount += 1;
          this.seenIds.add(signal.id);
          this.dedup.markFingerprint(pre.fingerprint, signal.title);
          continue;
        }

        const skipReason = this.shouldSkipSignal(signal, pre.fingerprint);
        if (skipReason) {
          this.state.filteredCount += 1;
          continue;
        }

        this.seenIds.add(signal.id);
        this.dedup.markFingerprint(pre.fingerprint, signal.title);
        this.state.processedCount += 1;

        const rules = await analyzeWithRules(signal, pre);
        if (!rules || rules.filtered) {
          this.state.filteredCount += 1;
          continue;
        }

        const primaryCoin = resolvePrimaryCoin(rules.coins);
        if (primaryCoin && this.dedup.isCoinOnCooldown(primaryCoin)) {
          this.state.filteredCount += 1;
          continue;
        }

        const llmDecision = evaluateLlmDecision(rules);
        let llm = null;
        let llmNote: string | undefined;

        if (llmDecision.use) {
          const primary = resolvePrimaryCoin(rules.coins);
          let llmContext = {};
          if (primary) {
            const [newsCtx, mkt] = await Promise.all([
              fetchNewsPriceContext(primary).catch(() => null),
              fetchCoinMarketSnapshot(primary).catch(() => null),
            ]);
            llmContext = {
              newsContextSummary: newsCtx?.summary,
              marketContextSummary: mkt?.summary,
            };
          }
          llm = await classifyWithLlm(signal, rules, llmContext);
          if (!llm) {
            llmNote = "llm_failed_rules_only";
          }
        } else {
          await logLlmSkipped(signal, llmDecision.reason);
          llmNote = llmDecision.reason;
        }

        const predictions = await buildImpactPredictionsWithContext(signal, rules, llm, llmNote);

        for (const prediction of predictions) {
          if (this.dedup.isCoinOnCooldown(prediction.coin)) {
            this.state.filteredCount += 1;
            continue;
          }

          this.dedup.markCoinImpact(prediction.coin);
          this.state.significantCount += 1;
          newImpacts.push(prediction);

          if (!prediction.isSecondary) {
            void saveImpactHistory(prediction, signal).catch(() => undefined);
            void dispatchNewsImpactAlert(prediction, signal.title).catch(() => undefined);
          }
        }

        if (predictions.length > 0) {
          this.dedup.addRecentTitle(signal.title);
        } else {
          this.state.filteredCount += 1;
        }
      }

      if (newImpacts.length) {
        this.state.recentImpacts = rankPredictions([
          ...newImpacts,
          ...this.state.recentImpacts,
        ]).slice(0, MAX_RECENT);
      }

      this.state.lastTickAt = new Date().toISOString();
      this.state.lastError = null;
      this.state.recentLlmLogs = getRecentLlmLogs(20);
      await this.refreshAuxState();
      await saveSeenIds(this.seenIds);
      await this.dedup.persist();
      await persistState(this.state);
      return newImpacts;
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : String(error);
      await persistState(this.state);
      return [];
    } finally {
      this.ticking = false;
    }
  }
}

const globalForEngine = globalThis as unknown as { __newsImpactEngine?: NewsImpactEngine };

export async function getNewsImpactEngine(): Promise<NewsImpactEngine> {
  if (!globalForEngine.__newsImpactEngine) {
    globalForEngine.__newsImpactEngine = new NewsImpactEngine();
    await globalForEngine.__newsImpactEngine.init();
    if (process.env.NEWS_IMPACT_AUTO_START === "true") {
      await globalForEngine.__newsImpactEngine.start();
    }
  }
  return globalForEngine.__newsImpactEngine;
}

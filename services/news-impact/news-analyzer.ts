import axios from "axios";
import {
  detectPriorityTriggers,
  preFilterSignal,
  type PreFilterResult,
} from "@/services/news-impact/news-filter";
import {
  detectCoinsFromText,
  resolveCoinsFromText,
  resolvePrimaryCoin,
  resolveSecondaryCoins,
  resolveAffectedCoins,
  getSectorLabel,
} from "@/services/news-impact/coin-resolver";
import {
  applyRuleContext,
  matchImpactRules,
  mergeMatchedRules,
} from "@/services/news-impact/impact-rules";
import type {
  LlmNewsClassification,
  NewsImpactBias,
  NewsImpactDuration,
  NewsImpactStrength,
  RawNewsSignal,
  RuleAnalysisResult,
} from "@/services/news-impact/types";
import { appendLlmLog } from "@/services/news-impact/llm-log";

export {
  detectCoinsFromText,
  resolvePrimaryCoin,
  resolveSecondaryCoins,
} from "@/services/news-impact/coin-resolver";

function getBaseUrl(): string {
  return process.env.OMNIROUTE_URL || process.env.OPENROUTER_URL || "http://localhost:20128/v1";
}

function getFastModel(): string {
  return process.env.NEWS_IMPACT_MODEL?.trim() || "cl/deepseek/deepseek-v4-flash";
}

export function runPreFilter(signal: RawNewsSignal): PreFilterResult {
  return preFilterSignal(signal);
}

function strengthRank(s: NewsImpactStrength): number {
  return { Low: 0, Medium: 1, High: 2, Extreme: 3 }[s];
}

export async function analyzeWithRules(
  signal: RawNewsSignal,
  pre?: PreFilterResult
): Promise<RuleAnalysisResult | null> {
  const filter = pre ?? preFilterSignal(signal);
  if (!filter.ok) {
    return {
      coins: [],
      bias: "Neutral",
      strength: "Low",
      impactScore: 0,
      duration: "1h",
      category: "filtered",
      reason: filter.reason ?? "filtered",
      matchedRules: [],
      priorityTriggers: filter.priorityTriggers,
      filtered: true,
      filterReason: filter.reason,
    };
  }

  const text = `${signal.title} ${signal.summary ?? ""}`;
  const priorityTriggers = filter.priorityTriggers.length
    ? filter.priorityTriggers
    : detectPriorityTriggers(text);

  const matched = matchImpactRules(text);

  if (matched.length === 0) {
    if (priorityTriggers.length === 0) return null;

    const bias: NewsImpactBias = priorityTriggers.some((t) =>
      ["hack", "delisting", "regulation_ban", "sec_action", "liquidation_event"].includes(t)
    )
      ? "Bearish"
      : priorityTriggers.some((t) =>
            ["listing", "etf_approval", "major_partnership", "whale_flow"].includes(t)
          )
        ? "Bullish"
        : "Neutral";

    if (bias === "Neutral") return null;

    const coins = await resolveCoinsFromText(text, signal.hintCoins ?? []);
    const primary = resolvePrimaryCoin(coins);
    if (!primary) return null;

    return {
      coins,
      secondaryCoins: resolveSecondaryCoins(coins),
      affectedCoins: resolveAffectedCoins(primary, coins),
      sectorLabel: getSectorLabel(primary),
      bias,
      strength: signal.significanceScore >= 48 ? "Medium" : "Low",
      impactScore: Math.min(68, signal.significanceScore + filter.priorityBoost + 8),
      duration: bias === "Bearish" && priorityTriggers.includes("hack") ? "15min" : "15min",
      category: "priority_trigger",
      reason: `${priorityTriggers.join(", ")}: ${signal.title}`,
      matchedRules: [],
      priorityTriggers,
    };
  }

  const { top, allIds, combinedScore } = mergeMatchedRules(matched);
  const coins = top.coins?.length
    ? top.coins
    : await resolveCoinsFromText(text, signal.hintCoins ?? []);

  if (!resolvePrimaryCoin(coins)) return null;

  const primary = resolvePrimaryCoin(coins)!;
  const adjusted = applyRuleContext(top, coins, signal.sourceType);
  const impactScore = Math.min(
    100,
    Math.max(combinedScore, adjusted.score, signal.significanceScore) + filter.priorityBoost
  );

  const reasonParts = [
    top.id.replace(/_/g, " "),
    adjusted.contextNote ? `(${adjusted.contextNote})` : null,
    signal.title,
  ].filter(Boolean);

  return {
    coins,
    secondaryCoins: resolveSecondaryCoins(coins),
    affectedCoins: resolveAffectedCoins(primary, coins),
    sectorLabel: getSectorLabel(primary),
    bias: adjusted.bias,
    strength: adjusted.strength,
    impactScore,
    duration: adjusted.duration,
    category: adjusted.category,
    reason: reasonParts.join(": "),
    matchedRules: allIds,
    priorityTriggers,
    contextNote: adjusted.contextNote,
  };
}

function parseLlmJson(raw: string): LlmNewsClassification | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<LlmNewsClassification>;
    if (!parsed.coin || !parsed.bias || !parsed.strength) return null;
    return {
      coin: String(parsed.coin).toUpperCase().slice(0, 10),
      bias: parsed.bias as NewsImpactBias,
      strength: parsed.strength as NewsImpactStrength,
      duration: (parsed.duration as NewsImpactDuration) ?? "15min",
      impactScore: Math.min(100, Math.max(0, Number(parsed.impactScore) || 50)),
      reason: String(parsed.reason ?? "").slice(0, 300),
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 50)),
    };
  } catch {
    return null;
  }
}

const LLM_FEW_SHOT = `Examples:
STRONG: "Binance lists new token PEPE" → {"coin":"PEPE","bias":"Bullish","strength":"Extreme","impactScore":88,"confidence":82}
STRONG: "Bridge exploit drains $40M from ETH protocol" → {"coin":"ETH","bias":"Bearish","strength":"Extreme","impactScore":90,"confidence":85}
WEAK: "Analyst says Bitcoin could reach $100k" → {"coin":"BTC","bias":"Neutral","strength":"Low","impactScore":22,"confidence":30}
WEAK: "Ripple CEO said SEC lawsuit was hard" (retrospective) → {"coin":"XRP","bias":"Neutral","strength":"Low","impactScore":15,"confidence":25}`;

export interface LlmContextOptions {
  newsContextSummary?: string;
  marketContextSummary?: string;
}

export async function classifyWithLlm(
  signal: RawNewsSignal,
  ruleHint: RuleAnalysisResult,
  context: LlmContextOptions = {}
): Promise<LlmNewsClassification | null> {
  const model = getFastModel();
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const baseURL = getBaseUrl();
  const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");

  if (!apiKey && !isLocal) {
    await appendLlmLog({
      at: new Date().toISOString(),
      newsId: signal.id,
      title: signal.title,
      outcome: "skipped",
      reason: "no_api_key",
      model,
    });
    return null;
  }

  const prompt = `Classify crypto news impact. Reply JSON only:
{"coin":"ETH","bias":"Bullish|Bearish|Neutral","strength":"Low|Medium|High|Extreme","duration":"5min|15min|1h|>1h","impactScore":0-100,"reason":"one sentence","confidence":0-100}

${LLM_FEW_SHOT}

News: ${signal.title}
${signal.summary ? `Summary: ${signal.summary}` : ""}
Source: ${signal.source} (${signal.sourceType})
Rule hint: ${ruleHint.bias} ${ruleHint.strength} coins=${ruleHint.coins.join(",")}
${context.newsContextSummary ? `30m price context: ${context.newsContextSummary}` : ""}
${context.marketContextSummary ? `Market/on-chain: ${context.marketContextSummary}` : ""}`;

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const { data } = await axios.post<{
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    }>(
      `${baseURL}/chat/completions`,
      {
        model,
        stream: false,
        temperature: 0.1,
        max_tokens: 220,
        messages: [
          { role: "system", content: "You are a crypto news impact classifier. JSON only." },
          { role: "user", content: prompt },
        ],
      },
      { headers, timeout: 25_000 }
    );

    if (data.error?.message) {
      await appendLlmLog({
        at: new Date().toISOString(),
        newsId: signal.id,
        title: signal.title,
        outcome: "failed",
        reason: `api_error: ${data.error.message}`,
        model,
      });
      return null;
    }

    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseLlmJson(content);
    if (!parsed) {
      await appendLlmLog({
        at: new Date().toISOString(),
        newsId: signal.id,
        title: signal.title,
        outcome: "failed",
        reason: "invalid_json_response",
        model,
      });
      return null;
    }

    await appendLlmLog({
      at: new Date().toISOString(),
      newsId: signal.id,
      title: signal.title,
      outcome: "success",
      reason: `coin=${parsed.coin} strength=${parsed.strength}`,
      model,
    });
    return parsed;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await appendLlmLog({
      at: new Date().toISOString(),
      newsId: signal.id,
      title: signal.title,
      outcome: "failed",
      reason: msg.slice(0, 200),
      model,
    });
    return null;
  }
}

export function evaluateLlmDecision(rules: RuleAnalysisResult): { use: boolean; reason: string } {
  if (process.env.NEWS_IMPACT_LLM === "false") {
    return { use: false, reason: "llm_disabled_env" };
  }
  if (rules.filtered) {
    return { use: false, reason: "rules_filtered" };
  }
  if (strengthRank(rules.strength) < strengthRank("High")) {
    return { use: false, reason: `strength_${rules.strength}_below_high` };
  }
  return { use: true, reason: "strength_high_or_extreme" };
}

export async function logLlmSkipped(signal: RawNewsSignal, reason: string): Promise<void> {
  await appendLlmLog({
    at: new Date().toISOString(),
    newsId: signal.id,
    title: signal.title,
    outcome: "skipped",
    reason,
    model: getFastModel(),
  });
}

export function shouldUseLlm(_signal: RawNewsSignal, rules: RuleAnalysisResult): boolean {
  return evaluateLlmDecision(rules).use;
}

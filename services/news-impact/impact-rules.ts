import type {
  NewsImpactBias,
  NewsImpactDuration,
  NewsImpactStrength,
} from "@/services/news-impact/types";
import { isMajorCoin } from "@/services/news-impact/coin-resolver";

export interface ImpactRule {
  id: string;
  pattern: RegExp;
  bias: NewsImpactBias;
  strength: NewsImpactStrength;
  score: number;
  duration: NewsImpactDuration;
  category: string;
  coins?: string[];
  /** Context modifier key */
  context?: "listing" | "etf" | "hack" | "regulation" | "macro" | "flow";
}

export interface AdjustedRuleResult {
  bias: NewsImpactBias;
  strength: NewsImpactStrength;
  score: number;
  duration: NewsImpactDuration;
  category: string;
  contextNote?: string;
}

export const IMPACT_RULES: ImpactRule[] = [
  {
    id: "binance_listing",
    pattern: /\b(binance\s+(lists?|listing|adds?|will list)|lists?\s+on\s+binance)\b/i,
    bias: "Bullish", strength: "High", score: 84, duration: "15min",
    category: "exchange_listing", context: "listing",
  },
  {
    id: "coinbase_listing",
    pattern: /\b(coinbase\s+(lists?|listing|adds?)|lists?\s+on\s+coinbase)\b/i,
    bias: "Bullish", strength: "High", score: 80, duration: "15min",
    category: "exchange_listing", context: "listing",
  },
  {
    id: "okx_listing",
    pattern: /\b(okx\s+(lists?|listing|adds?)|lists?\s+on\s+okx)\b/i,
    bias: "Bullish", strength: "High", score: 76, duration: "15min",
    category: "exchange_listing", context: "listing",
  },
  {
    id: "upbit_listing",
    pattern: /\b(upbit\s+(lists?|listing|adds?)|lists?\s+on\s+upbit)\b/i,
    bias: "Bullish", strength: "High", score: 78, duration: "15min",
    category: "exchange_listing", context: "listing",
  },
  {
    id: "etf_approved",
    pattern: /\b(etf\s+(approved|approval|greenlight)|sec\s+approves\s+.*etf)\b/i,
    bias: "Bullish", strength: "Extreme", score: 94, duration: "1h",
    category: "regulation", coins: ["BTC", "ETH"], context: "etf",
  },
  {
    id: "etf_rejected",
    pattern: /\b(etf\s+(rejected|denied|delay(ed)?)|sec\s+denies\s+.*etf)\b/i,
    bias: "Bearish", strength: "High", score: 78, duration: "1h",
    category: "regulation", coins: ["BTC", "ETH"], context: "etf",
  },
  {
    id: "etf_filing",
    pattern: /\b(etf\s+(filing|filed|application)|s-1\s+filing)\b/i,
    bias: "Bullish", strength: "Medium", score: 58, duration: "1h",
    category: "regulation", context: "etf",
  },
  {
    id: "hack_exploit",
    pattern: /\b(hack(ed)?|exploit(ed)?|drained|compromised)\b/i,
    bias: "Bearish", strength: "Extreme", score: 91, duration: "15min",
    category: "security", context: "hack",
  },
  {
    id: "bridge_hack",
    pattern: /\b(bridge\s+(hack|exploit|attack)|cross[- ]chain\s+exploit)\b/i,
    bias: "Bearish", strength: "Extreme", score: 93, duration: "15min",
    category: "security", context: "hack",
  },
  {
    id: "oracle_failure",
    pattern: /\b(oracle\s+(exploit|manipulation|failure)|price\s+oracle\s+attack)\b/i,
    bias: "Bearish", strength: "Extreme", score: 90, duration: "15min",
    category: "security", context: "hack",
  },
  {
    id: "rug_pull",
    pattern: /\b(rug\s*pull|exit\s+scam|team\s+disappeared)\b/i,
    bias: "Bearish", strength: "Extreme", score: 88, duration: "5min",
    category: "security", context: "hack",
  },
  {
    id: "sec_lawsuit",
    pattern: /\b(sec\s+(sues?|charges?|lawsuit|investigation)|cftc\s+charges?)\b/i,
    bias: "Bearish", strength: "High", score: 82, duration: "1h",
    category: "regulation", context: "regulation",
  },
  {
    id: "sec_win",
    pattern: /\b(sec\s+(drops?|dismiss(es)?|settles?)|lawsuit\s+dismissed)\b/i,
    bias: "Bullish", strength: "High", score: 76, duration: "1h",
    category: "regulation", context: "regulation",
  },
  {
    id: "sanctions",
    pattern: /\b(sanction(s|ed)?|ofac|blacklist(ed)?\s+address)\b/i,
    bias: "Bearish", strength: "High", score: 74, duration: "1h",
    category: "regulation", context: "regulation",
  },
  {
    id: "delist",
    pattern: /\b(delist(ing|ed)?|removes?\s+trading|suspends?\s+trading)\b/i,
    bias: "Bearish", strength: "High", score: 78, duration: "15min",
    category: "exchange_listing",
  },
  {
    id: "exchange_halt",
    pattern: /\b(halt(s|ed)?\s+(trading|withdrawals)|withdrawals?\s+suspended|outage)\b/i,
    bias: "Bearish", strength: "High", score: 72, duration: "15min",
    category: "exchange_ops",
  },
  {
    id: "whale_buy",
    pattern: /\b(whale\s+(buy|accumulat|deposit|bought)|large\s+inflow|\d+\s*(m|b)\s+usdt\s+inflow)\b/i,
    bias: "Bullish", strength: "Medium", score: 64, duration: "15min",
    category: "onchain_flow", context: "flow",
  },
  {
    id: "whale_sell",
    pattern: /\b(whale\s+(sell|dump|withdraw|sold)|large\s+outflow|\d+\s*(m|b)\s+usdt\s+outflow)\b/i,
    bias: "Bearish", strength: "Medium", score: 66, duration: "15min",
    category: "onchain_flow", context: "flow",
  },
  {
    id: "treasury_buy",
    pattern: /\b(treasury\s+(buy|purchase|adds?)|company\s+buys?\s+\d+.*(btc|bitcoin|eth))\b/i,
    bias: "Bullish", strength: "High", score: 74, duration: "1h",
    category: "institutional", context: "flow",
  },
  {
    id: "partnership_major",
    pattern: /\b(partnership|partners?\s+with)\b.*\b(google|microsoft|blackrock|visa|mastercard|paypal|amazon|apple|nvidia)\b/i,
    bias: "Bullish", strength: "High", score: 72, duration: "1h",
    category: "partnership",
  },
  {
    id: "partnership_generic",
    pattern: /\b(partnership|partners?\s+with|integrat(es|ion)\s+with)\b/i,
    bias: "Bullish", strength: "Medium", score: 54, duration: "1h",
    category: "partnership",
  },
  {
    id: "liquidation_cascade",
    pattern: /\b(liquidation\s+cascade|mass\s+liquidat|forced\s+liquidat|\$\d+b\s+liquidat)\b/i,
    bias: "Bearish", strength: "High", score: 76, duration: "5min",
    category: "derivatives", coins: ["BTC", "ETH"],
  },
  {
    id: "fed_rate_cut",
    pattern: /\b(fed\s+(cuts?|lowers?)\s+(interest\s+)?rates?|rate\s+cuts?|dovish\s+fed)\b/i,
    bias: "Bullish", strength: "High", score: 70, duration: "1h",
    category: "macro", coins: ["BTC", "ETH"], context: "macro",
  },
  {
    id: "fed_rate_hike",
    pattern: /\b(fed\s+(hikes?|raises?)\s+(interest\s+)?rates?|rate\s+hikes?|hawkish\s+fed)\b/i,
    bias: "Bearish", strength: "High", score: 68, duration: "1h",
    category: "macro", coins: ["BTC", "ETH"], context: "macro",
  },
  {
    id: "stablecoin_depeg",
    pattern: /\b(depeg(ged)?|lost\s+peg|usdt\s+depeg|usdc\s+depeg)\b/i,
    bias: "Bearish", strength: "Extreme", score: 90, duration: "5min",
    category: "stablecoin", coins: ["BTC", "ETH"],
  },
  {
    id: "bankruptcy",
    pattern: /\b(bankrupt(cy)?|insolvent|chapter\s+11|cease(s)?\s+operations)\b/i,
    bias: "Bearish", strength: "Extreme", score: 86, duration: "1h",
    category: "insolvency",
  },
  {
    id: "token_unlock",
    pattern: /\b(token\s+unlock|vesting\s+unlock|cliff\s+unlock)\b/i,
    bias: "Bearish", strength: "Medium", score: 58, duration: "1h",
    category: "supply",
  },
  {
    id: "mainnet_launch",
    pattern: /\b(mainnet\s+(launch|live|goes?\s+live)|genesis\s+block)\b/i,
    bias: "Bullish", strength: "High", score: 70, duration: "1h",
    category: "launch",
  },
  {
    id: "network_outage",
    pattern: /\b(network\s+(halt|outage|congestion)|chain\s+halted|block\s+production\s+stopped)\b/i,
    bias: "Bearish", strength: "High", score: 74, duration: "15min",
    category: "infrastructure",
  },
  {
    id: "spot_etf_inflow",
    pattern: /\b(etf\s+inflow|record\s+inflow.*etf|\$\d+m\s+inflow.*etf)\b/i,
    bias: "Bullish", strength: "High", score: 72, duration: "1h",
    category: "institutional", coins: ["BTC", "ETH"], context: "etf",
  },
];

export function matchImpactRules(text: string): ImpactRule[] {
  return IMPACT_RULES.filter((rule) => rule.pattern.test(text));
}

/** Contextual strength/score adjustments */
export function applyRuleContext(
  rule: ImpactRule,
  coins: string[],
  sourceType: string
): AdjustedRuleResult {
  let { bias, strength, score, duration, category } = rule;
  let contextNote: string | undefined;
  const primary = coins[0]?.toUpperCase();

  if (rule.context === "listing" && primary) {
    if (!isMajorCoin(primary)) {
      strength = "Extreme";
      score = Math.min(100, score + 12);
      contextNote = "new_token_listing";
    } else {
      strength = "Medium";
      score = Math.max(45, score - 18);
      contextNote = "major_coin_listing";
    }
  }

  if (rule.context === "etf" && primary === "BTC") {
    score = Math.min(100, score + 4);
  }

  if (rule.context === "hack" && rule.id === "oracle_failure") {
    score = Math.min(100, score + 3);
  }

  if (rule.context === "flow" && sourceType === "telegram") {
    score = Math.min(100, score + 6);
    contextNote = contextNote ?? "telegram_flow";
  }

  if (rule.context === "macro") {
    duration = "1h";
  }

  if (sourceType === "twitter" && strengthRank(strength) >= strengthRank("High")) {
    score = Math.min(100, score + 4);
    contextNote = contextNote ?? "fast_source";
  }

  return { bias, strength, score, duration, category, contextNote };
}

function strengthRank(s: NewsImpactStrength): number {
  return { Low: 0, Medium: 1, High: 2, Extreme: 3 }[s];
}

export function pickTopRule(rules: ImpactRule[]): ImpactRule | null {
  if (rules.length === 0) return null;
  return [...rules].sort((a, b) => b.score - a.score)[0];
}

export function mergeMatchedRules(rules: ImpactRule[]): {
  top: ImpactRule;
  allIds: string[];
  combinedScore: number;
} {
  const sorted = [...rules].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const combinedScore = Math.min(
    100,
    top.score + sorted.slice(1, 3).reduce((sum, r) => sum + Math.round(r.score * 0.15), 0)
  );
  return { top, allIds: sorted.map((r) => r.id), combinedScore };
}

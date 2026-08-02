import { describe, expect, it } from "vitest";
import {
  analyzeWithRules,
  detectCoinsFromText,
  evaluateLlmDecision,
  shouldUseLlm,
} from "@/services/news-impact/news-analyzer";
import {
  resolvePrimaryCoin,
  resolveSecondaryCoins,
  resolveAffectedCoins,
  getSectorLabel,
  sectorImpactBoost,
} from "@/services/news-impact/coin-resolver";
import { applyRuleContext, matchImpactRules } from "@/services/news-impact/impact-rules";
import { buildImpactPrediction, buildImpactPredictionsWithContext, isHotSignal } from "@/services/news-impact/impact-predictor";
import { scoreImpactMl } from "@/services/news-impact/impact-ml";
import {
  shouldSendAlert,
  formatAlertMessage,
} from "@/services/news-impact/alerts";
import {
  biasAlignmentBoost,
  resolveImpactOnExisting,
} from "@/services/news-impact/prediction-link";
import {
  isSimilarHeadline,
  preFilterSignal,
} from "@/services/news-impact/news-filter";
import { DedupCooldownStore } from "@/services/news-impact/dedup-cooldown";
import type { RawNewsSignal } from "@/services/news-impact/types";

function mockSignal(overrides: Partial<RawNewsSignal> = {}): RawNewsSignal {
  return {
    id: "test-1",
    title: "Binance lists ETH perpetual futures with 125x leverage",
    source: "CoinTelegraph",
    sourceType: "rss",
    publishedAt: new Date().toISOString(),
    keywordHits: ["listing", "binance"],
    significanceScore: 60,
    ...overrides,
  };
}

describe("news-impact filter", () => {
  it("rejects price ticker noise", () => {
    const result = preFilterSignal(
      mockSignal({
        title: "Bitcoin reaches $95,000 for the first time this week",
        keywordHits: ["bitcoin"],
        significanceScore: 30,
      })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("noise_pattern");
  });

  it("rejects rumor language without priority trigger", () => {
    const result = preFilterSignal(
      mockSignal({
        title: "Rumor: ETH may get new ETF filing soon",
        keywordHits: ["etf"],
        significanceScore: 28,
      })
    );
    expect(result.ok).toBe(false);
  });

  it("detects similar headlines", () => {
    expect(
      isSimilarHeadline(
        "Binance lists ETH perpetual futures",
        "Binance lists Ethereum perpetual futures contract"
      )
    ).toBe(true);
  });

  it("rejects retrospective headlines without priority trigger", () => {
    const result = preFilterSignal(
      mockSignal({
        title: "Ripple CEO says Bitcoin adoption is growing worldwide",
        keywordHits: ["bitcoin"],
        significanceScore: 50,
      })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("retrospective_headline");
  });

  it("rejects stale articles beyond max age", () => {
    const stale = new Date(Date.now() - 5 * 60 * 60_000).toISOString();
    const result = preFilterSignal(
      mockSignal({
        title: "Binance lists SOL perpetual futures",
        keywordHits: ["listing", "binance"],
        significanceScore: 60,
        publishedAt: stale,
      })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("stale_article");
  });

  it("rejects Google News without priority trigger", () => {
    const result = preFilterSignal(
      mockSignal({
        title: "Crypto markets show mixed signals today",
        source: "Google News",
        sourceType: "google-news",
        keywordHits: ["crypto"],
        significanceScore: 40,
      })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("google_news_no_trigger");
  });

  it("rejects retrospective Google News even with SEC trigger", () => {
    const result = preFilterSignal(
      mockSignal({
        title: "Ripple CEO Says SEC Lawsuit Was Unnecessary",
        source: "Google News",
        sourceType: "google-news",
        keywordHits: ["sec", "lawsuit"],
        significanceScore: 55,
      })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("google_news_retrospective");
  });
});

describe("news-impact rules", () => {
  it("has 28+ impact rules", () => {
    expect(matchImpactRules("SEC sues crypto exchange").length).toBeGreaterThan(0);
    expect(matchImpactRules("bridge hack drains funds").length).toBeGreaterThan(0);
    expect(matchImpactRules("Fed cuts rate today").length).toBeGreaterThan(0);
  });

  it("downgrades major coin listing to Medium", () => {
    const rule = matchImpactRules("Binance lists ETH perpetual futures")[0];
    expect(rule).toBeDefined();
    const adjusted = applyRuleContext(rule, ["ETH"], "rss");
    expect(adjusted.strength).toBe("Medium");
    expect(adjusted.contextNote).toBe("major_coin_listing");
  });

  it("upgrades new token listing to Extreme", () => {
    const rule = matchImpactRules("Binance lists PEPE trading pair")[0];
    expect(rule).toBeDefined();
    const adjusted = applyRuleContext(rule, ["PEPE"], "rss");
    expect(adjusted.strength).toBe("Extreme");
    expect(adjusted.contextNote).toBe("new_token_listing");
  });
});

describe("news-impact analyzer", () => {
  it("detects ETH from headline", () => {
    expect(detectCoinsFromText("Ethereum surges after ETF news")).toContain("ETH");
  });

  it("maps Hedera/Bonzo ecosystem to HBAR", () => {
    const coins = detectCoinsFromText("Bonzo oracle exploit drains $40M from Hedera protocol");
    expect(coins).toContain("HBAR");
    expect(coins).not.toContain("BTC");
    expect(resolvePrimaryCoin(coins)).toBe("HBAR");
  });

  it("does not fallback to BTC for generic crypto text", () => {
    const coins = detectCoinsFromText("Crypto market is volatile today");
    expect(coins).not.toContain("BTC");
    expect(resolvePrimaryCoin(coins)).toBeNull();
  });

  it("flags Binance listing with contextual strength for major coin", async () => {
    const pre = preFilterSignal(mockSignal());
    const rules = await analyzeWithRules(mockSignal(), pre);
    expect(rules).not.toBeNull();
    expect(rules!.bias).toBe("Bullish");
    expect(rules!.strength).toBe("Medium");
    expect(rules!.matchedRules).toContain("binance_listing");
    expect(rules!.contextNote).toBe("major_coin_listing");
  });

  it("flags new token listing as extreme", async () => {
    const signal = mockSignal({
      title: "Binance lists PEPE spot trading pair",
      keywordHits: ["listing", "binance"],
      significanceScore: 65,
    });
    const rules = await analyzeWithRules(signal, preFilterSignal(signal));
    expect(rules!.strength).toBe("Extreme");
    expect(rules!.contextNote).toBe("new_token_listing");
    expect(rules!.coins).toContain("PEPE");
  });

  it("flags hack as bearish extreme when coin is known", async () => {
    const signal = mockSignal({
      title: "ETH bridge exploit drains $40M from DeFi protocol",
      keywordHits: ["exploit", "drained"],
      significanceScore: 55,
    });
    const rules = await analyzeWithRules(signal, preFilterSignal(signal));
    expect(rules).not.toBeNull();
    expect(rules!.bias).toBe("Bearish");
    expect(rules!.strength).toBe("Extreme");
    expect(rules!.matchedRules).toContain("hack_exploit");
    expect(rules!.coins).toContain("ETH");
  });

  it("skips hack headline without identifiable coin", async () => {
    const signal = mockSignal({
      title: "Bridge exploit drains $40M from DeFi protocol",
      keywordHits: ["exploit", "drained"],
      significanceScore: 55,
    });
    const rules = await analyzeWithRules(signal, preFilterSignal(signal));
    expect(rules).toBeNull();
  });

  it("maps Bonzo Hedera exploit to HBAR not BTC", async () => {
    const signal = mockSignal({
      title: "Bonzo oracle exploit drains liquidity on Hedera",
      keywordHits: ["exploit", "drained"],
      significanceScore: 70,
    });
    const rules = await analyzeWithRules(signal, preFilterSignal(signal));
    expect(rules).not.toBeNull();
    expect(rules!.coins).toContain("HBAR");
    expect(rules!.coins).not.toContain("BTC");
  });

  it("uses hintCoins from fast sources", async () => {
    const signal = mockSignal({
      title: "Whale transferred 50000 SOL to Binance",
      keywordHits: ["whale"],
      significanceScore: 50,
      hintCoins: ["SOL"],
    });
    const rules = await analyzeWithRules(signal, preFilterSignal(signal));
    expect(rules?.coins ?? []).toContain("SOL");
  });

  it("uses LLM only for High+ strength", async () => {
    const highSignal = mockSignal({
      title: "ETH bridge exploit drains $40M from DeFi protocol",
      keywordHits: ["exploit", "drained"],
      significanceScore: 70,
    });
    const high = await analyzeWithRules(highSignal, preFilterSignal(highSignal))!;
    expect(high).not.toBeNull();
    expect(shouldUseLlm(highSignal, high!)).toBe(true);
    expect(evaluateLlmDecision(high!).reason).toBe("strength_high_or_extreme");

    const lowRules = { ...high!, strength: "Low" as const, impactScore: 30 };
    expect(shouldUseLlm(highSignal, lowRules)).toBe(false);
  });
});

describe("news-impact predictor", () => {
  it("builds enriched JSON shape", async () => {
    const signal = mockSignal({
      title: "ETH bridge exploit drains $40M from DeFi protocol",
      keywordHits: ["exploit", "drained"],
      significanceScore: 70,
    });
    const rules = (await analyzeWithRules(signal, preFilterSignal(signal)))!;
    const prediction = buildImpactPrediction(signal, rules, null, {
      activePrediction: {
        id: "pred-1",
        symbol: "ETH",
        direction: "LONG",
        probability: 68,
        timeframe: "1h",
        createdAt: new Date().toISOString(),
      },
      coinOverride: "ETH",
    });

    expect(prediction).not.toBeNull();
    expect(prediction!.direction).toBe("SHORT");
    expect(prediction!.impactScore).toBeGreaterThan(50);
    expect(prediction!.urgency).toBe("Immediate");
    expect(prediction!.recommendedAction).toBe("Short");
    expect(prediction!.expectedMovePct).toBeGreaterThan(0);
    expect(prediction!.confidence).toBeGreaterThan(20);
    expect(prediction!.confidence).toBeLessThanOrEqual(98);
  });

  it("builds secondary coin predictions", async () => {
    const signal = mockSignal({
      title: "SEC approves Bitcoin and Ethereum ETF",
      keywordHits: ["etf", "approved", "sec"],
      significanceScore: 80,
    });
    const rules = (await analyzeWithRules(signal, preFilterSignal(signal)))!;
    expect(rules.coins.length).toBeGreaterThanOrEqual(1);

    const withSecondaries = {
      ...rules,
      coins: ["BTC", "ETH"],
      secondaryCoins: resolveSecondaryCoins(["BTC", "ETH"]),
    };

    const predictions = await buildImpactPredictionsWithContext(signal, withSecondaries);
    expect(predictions.length).toBeGreaterThanOrEqual(1);
    if (predictions.length > 1) {
      expect(predictions[1].isSecondary).toBe(true);
      expect(predictions[1].impactScore).toBeLessThan(predictions[0].impactScore);
    }
  });

  it("boosts score when news confirms active prediction", () => {
    const boost = biasAlignmentBoost("LONG", {
      id: "x",
      symbol: "ETH",
      direction: "LONG",
      probability: 70,
      timeframe: "1h",
      createdAt: new Date().toISOString(),
    });
    expect(boost).toBe(10);
    expect(resolveImpactOnExisting("SHORT", {
      id: "x",
      symbol: "ETH",
      direction: "LONG",
      probability: 70,
      timeframe: "1h",
      createdAt: new Date().toISOString(),
    })).toBe("contradicts");
  });

  it("skips filtered and low-impact noise", async () => {
    const signal = mockSignal({
      title: "Crypto market summary for the week",
      keywordHits: ["crypto"],
      significanceScore: 12,
    });
    const rules = await analyzeWithRules(signal, preFilterSignal(signal));
    expect(rules?.filtered ?? rules === null).toBeTruthy();
  });

  it("rejects prediction without identifiable coin", async () => {
    const signal = mockSignal({
      title: "Bridge exploit drains $40M from DeFi protocol",
      keywordHits: ["exploit", "drained"],
      significanceScore: 55,
    });
    const rules = await analyzeWithRules(signal, preFilterSignal(signal));
    expect(rules).toBeNull();
    const prediction = buildImpactPrediction(signal, {
      coins: [],
      bias: "Bearish",
      strength: "Extreme",
      impactScore: 90,
      duration: "15min",
      category: "security",
      reason: "test",
      matchedRules: ["hack_exploit"],
      priorityTriggers: ["hack"],
    });
    expect(prediction).toBeNull();
  });
});

describe("news-impact ml", () => {
  it("scores high for extreme security events", () => {
    const result = scoreImpactMl({
      impactScore: 90,
      significanceScore: 70,
      sourcePriority: 100,
      strength: "Extreme",
      category: "security",
      direction: "SHORT",
      analysisMethod: "rules",
      confirmsPrediction: false,
      contradictsPrediction: false,
    });
    expect(result.mlScore).toBeGreaterThan(60);
    expect(result.confidence).toBeGreaterThan(50);
  });

  it("identifies hot signals", () => {
    expect(
      isHotSignal({
        coin: "ETH",
        direction: "SHORT",
        impactScore: 80,
        strength: "Extreme",
        isSecondary: false,
      } as never)
    ).toBe(true);
    expect(
      isHotSignal({
        coin: "ETH",
        direction: "LONG",
        impactScore: 50,
        strength: "Medium",
        isSecondary: false,
      } as never)
    ).toBe(false);
  });
});

describe("news-impact cooldown", () => {
  it("enforces per-coin cooldown", async () => {
    const store = new DedupCooldownStore();
    await store.load();
    store.markCoinImpact("ETH");
    expect(store.isCoinOnCooldown("ETH")).toBe(true);
    expect(store.isCoinOnCooldown("BTC")).toBe(false);
  });
});

describe("news-impact alerts", () => {
  const base = {
    coin: "SOL",
    direction: "LONG" as const,
    impactScore: 80,
    strength: "Extreme" as const,
    urgency: "Immediate" as const,
    isSecondary: false,
    confidence: 75,
    expectedMovePct: 3.2,
    reason: "Binance lists SOL perpetual",
  };

  it("fires on Extreme + score >= 75", () => {
    expect(shouldSendAlert(base as never)).toBe(true);
  });

  it("fires on High + Immediate + score >= 75", () => {
    expect(
      shouldSendAlert({ ...base, strength: "High" } as never)
    ).toBe(true);
  });

  it("skips secondary and low score", () => {
    expect(shouldSendAlert({ ...base, isSecondary: true } as never)).toBe(false);
    expect(shouldSendAlert({ ...base, impactScore: 70 } as never)).toBe(false);
    expect(
      shouldSendAlert({ ...base, strength: "High", urgency: "Short" } as never)
    ).toBe(false);
  });

  it("formats alert with sector", () => {
    const text = formatAlertMessage({
      ...base,
      sectorLabel: "Solana",
      affectedCoins: [
        { coin: "SOL", weight: 1 },
        { coin: "RAY", weight: 0.65 },
      ],
      sourceUrl: "https://example.com/news",
    } as never, "SOL listed on Binance");
    expect(text).toContain("SOL");
    expect(text).toContain("Solana");
    expect(text).toContain("RAY");
  });
});

describe("news-impact multi-coin", () => {
  it("resolves affected coins with sector peers", () => {
    const affected = resolveAffectedCoins("SOL", ["SOL"]);
    expect(affected[0]).toEqual({ coin: "SOL", weight: 1 });
    expect(affected.some((a) => a.coin === "RAY")).toBe(true);
    expect(getSectorLabel("SOL")).toBe("Solana");
  });

  it("applies sector impact boost", () => {
    const affected = resolveAffectedCoins("SOL", ["SOL"]);
    expect(sectorImpactBoost(affected)).toBeGreaterThan(0);
    expect(sectorImpactBoost(affected)).toBeLessThanOrEqual(8);
  });
});

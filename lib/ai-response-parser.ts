import { aiResponseSchema, type AiResponse } from "@/lib/schemas";
import { sanitizeAiTradeLevels } from "@/lib/trade-levels";
import type { AnalysisContext, ConfidenceLevel, PredictionDirection, PriceForecast } from "@/types";

function coerceNumber(value: unknown, fallback = 50): number {
  if (typeof value === "number" && !Number.isNaN(value)) return Math.min(100, Math.max(0, value));
  if (typeof value === "string") {
    const parsed = parseFloat(value.replace("%", "").trim());
    if (!Number.isNaN(parsed)) return Math.min(100, Math.max(0, parsed));
  }
  return fallback;
}

function coercePrice(value: unknown, fallback: number): number {
  if (typeof value === "number" && !Number.isNaN(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value.replace(/[$,\s]/g, "").trim());
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function normalizeDirection(value: unknown): PredictionDirection {
  const raw = String(value ?? "").toUpperCase().trim();
  if (raw.includes("LONG") || raw.includes("BULL") || raw.includes("БЫЧ") || raw === "UP") {
    return "LONG";
  }
  if (raw.includes("SHORT") || raw.includes("BEAR") || raw.includes("МЕДВ") || raw === "DOWN") {
    return "SHORT";
  }
  return "SIDEWAYS";
}

function normalizeConfidence(value: unknown): ConfidenceLevel {
  const raw = String(value ?? "").toLowerCase();
  if (raw.includes("high") || raw.includes("высок")) return "High";
  if (raw.includes("low") || raw.includes("низк")) return "Low";
  return "Medium";
}

function normalizeMarket(value: unknown, fallback: "Spot" | "Futures"): "Spot" | "Futures" {
  const raw = String(value ?? "").toLowerCase();
  if (raw.includes("spot")) return "Spot";
  if (raw.includes("future")) return "Futures";
  return fallback;
}

function toStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean);
    return items.length > 0 ? items : fallback;
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return fallback;
}

function stripModelArtifacts(raw: string): string {
  return raw
    .replace(/[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/^[\s\S]*?(?=\{)/m, (match) => (match.includes("{") ? "" : match))
    .trim();
}

function repairJsonString(raw: string): string {
  let text = stripModelArtifacts(raw);

  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  text = text.replace(/[\u201C\u201D]/g, '"');
  text = text.replace(/,\s*([}\]])/g, "$1");
  text = text.replace(/'/g, '"');

  return text;
}

function extractJsonObject(raw: string): string | null {
  const trimmed = stripModelArtifacts(raw);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }

  const end = trimmed.lastIndexOf("}");
  if (end > start) return trimmed.slice(start, end + 1);

  return null;
}

export function getMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          if ("text" in part && typeof part.text === "string") return part.text;
          if ("content" in part && typeof part.content === "string") return part.content;
        }
        return "";
      })
      .join("\n");
  }
  if (content && typeof content === "object" && "text" in content) {
    return String((content as { text: string }).text);
  }
  return "";
}

function parseJsonLoose(raw: string): Record<string, unknown> | null {
  const extracted = extractJsonObject(raw);
  if (!extracted) return null;

  const attempts = [extracted, repairJsonString(extracted)];

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function unwrapPayload(data: Record<string, unknown>): Record<string, unknown> {
  const nested = data.prediction ?? data.result ?? data.response ?? data.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return data;
}

function validatePriceRange(
  low: number,
  high: number,
  price: number,
  atr: number,
  support: number,
  resistance: number
): { low: number; high: number } {
  const isInvalid =
    low <= 0 ||
    high <= 0 ||
    low >= high ||
    low < price * 0.2 ||
    high > price * 5 ||
    Math.abs(low - price) / price > 0.5 ||
    Math.abs(high - price) / price > 0.5;

  if (!isInvalid) {
    return { low, high };
  }

  const fallbackLow = Math.min(support, price - atr * 2);
  const fallbackHigh = Math.max(resistance, price + atr * 2);

  return {
    low: Math.min(fallbackLow, fallbackHigh),
    high: Math.max(fallbackLow, fallbackHigh),
  };
}

function buildPriceForecast(
  data: Record<string, unknown>,
  price: number,
  atr: number,
  priceRange: { low: number; high: number },
  direction: PredictionDirection
): PriceForecast {
  const raw =
    data.priceForecast ??
    data.price_forecast ??
    data.forecast ??
    data.target;

  let predictedPrice = price;
  let predictedHigh = priceRange.high;
  let predictedLow = priceRange.low;
  let bandLow = price - atr * 0.5;
  let bandHigh = price + atr * 0.5;

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const f = raw as Record<string, unknown>;
    predictedPrice = coercePrice(
      f.predictedPrice ?? f.predicted_price ?? f.targetPrice ?? f.close ?? f.price,
      price
    );
    predictedHigh = coercePrice(f.predictedHigh ?? f.predicted_high ?? f.high ?? priceRange.high, priceRange.high);
    predictedLow = coercePrice(f.predictedLow ?? f.predicted_low ?? f.low ?? priceRange.low, priceRange.low);
    const band = f.confidenceBand ?? f.confidence_band ?? f.band;
    if (band && typeof band === "object" && !Array.isArray(band)) {
      const b = band as Record<string, unknown>;
      bandLow = coercePrice(b.low ?? b.min, predictedPrice - atr * 0.4);
      bandHigh = coercePrice(b.high ?? b.max, predictedPrice + atr * 0.4);
    }
  } else if (typeof raw === "number" || typeof raw === "string") {
    predictedPrice = coercePrice(raw, price);
  } else {
    const exitHint = data.tradeLevels ?? data.trade_levels;
    if (exitHint && typeof exitHint === "object") {
      const l = exitHint as Record<string, unknown>;
      predictedPrice = coercePrice(l.exit ?? l.target ?? l.tp, (priceRange.low + priceRange.high) / 2);
    } else {
      predictedPrice =
        direction === "LONG"
          ? priceRange.high * 0.65 + priceRange.low * 0.35
          : direction === "SHORT"
            ? priceRange.low * 0.65 + priceRange.high * 0.35
            : (priceRange.low + priceRange.high) / 2;
    }
  }

  if (predictedHigh < predictedLow) {
    [predictedHigh, predictedLow] = [predictedLow, predictedHigh];
  }
  if (bandLow > bandHigh) {
    [bandLow, bandHigh] = [bandHigh, bandLow];
  }

  predictedHigh = Math.max(predictedHigh, predictedPrice, predictedLow);
  predictedLow = Math.min(predictedLow, predictedPrice, predictedHigh);

  const expectedMovePct = price > 0 ? ((predictedPrice - price) / price) * 100 : 0;

  const bandHalf = Math.max(atr * 0.35, Math.abs(predictedPrice - price) * 0.2);
  if (bandLow >= bandHigh || bandHigh - bandLow < bandHalf) {
    bandLow = predictedPrice - bandHalf;
    bandHigh = predictedPrice + bandHalf;
  }

  return {
    predictedPrice,
    predictedHigh,
    predictedLow,
    confidenceBand: { low: bandLow, high: bandHigh },
    expectedMovePct,
  };
}

export function normalizeAiPayload(
  data: Record<string, unknown>,
  ctx: AnalysisContext
): AiResponse {
  const price = ctx.marketData.price;
  const atr = ctx.volatility.atr || price * 0.02;

  const direction = normalizeDirection(data.direction ?? data.signal ?? data.trend);
  const probabilityUp = coerceNumber(data.probabilityUp ?? data.prob_up ?? data.up_probability, 50);
  const probabilityDown = coerceNumber(
    data.probabilityDown ?? data.prob_down ?? data.down_probability,
    50
  );
  const probability = coerceNumber(
    data.probability ?? data.confidence_score ?? data.prob,
    direction === "LONG" ? probabilityUp : direction === "SHORT" ? probabilityDown : 50
  );

  const priceRangeRaw = data.priceRange ?? data.price_range ?? data.range;
  let priceRange = { low: price - atr, high: price + atr };

  if (priceRangeRaw && typeof priceRangeRaw === "object" && !Array.isArray(priceRangeRaw)) {
    const range = priceRangeRaw as Record<string, unknown>;
    priceRange = {
      low: coercePrice(range.low ?? range.min ?? range.from, price - atr),
      high: coercePrice(range.high ?? range.max ?? range.to, price + atr),
    };
  }

  priceRange = validatePriceRange(
    priceRange.low,
    priceRange.high,
    price,
    atr,
    ctx.levels.nearestSupport,
    ctx.levels.nearestResistance
  );

  const priceForecast = buildPriceForecast(data, price, atr, priceRange, direction);

  const disclaimer =
    String(data.disclaimer ?? "").trim() ||
    "Это аналитическая оценка ИИ и не является финансовой рекомендацией.";

  const levelsRaw = data.tradeLevels ?? data.trade_levels ?? data.levels;
  let tradeLevels: { entry: number; tp: number; sl: number; exit: number } | undefined;
  if (levelsRaw && typeof levelsRaw === "object" && !Array.isArray(levelsRaw)) {
    const l = levelsRaw as Record<string, unknown>;
    const candidate = {
      entry: coercePrice(l.entry ?? l.entryPrice ?? price, price),
      tp: coercePrice(l.tp ?? l.takeProfit ?? priceForecast.predictedHigh, priceForecast.predictedHigh),
      sl: coercePrice(l.sl ?? l.stopLoss ?? priceForecast.predictedLow, priceForecast.predictedLow),
      exit: coercePrice(l.exit ?? l.exitPrice ?? priceForecast.predictedPrice, priceForecast.predictedPrice),
    };
    tradeLevels = sanitizeAiTradeLevels(candidate, direction, price);
  }

  return {
    coin: ctx.coin.name,
    symbol: ctx.coin.symbol,
    market: normalizeMarket(data.market, ctx.market),
    timeframe: String(data.timeframe ?? ctx.timeframe),
    direction,
    probability,
    probabilityUp,
    probabilityDown,
    confidence: normalizeConfidence(data.confidence ?? data.confidence_level),
    priceRange,
    priceForecast,
    tradeLevels,
    reasons: toStringArray(data.reasons ?? data.reason, ["Недостаточно данных для детального анализа"]),
    risks: toStringArray(data.risks ?? data.risk, ["Высокая волатильность рынка"]),
    keyFactors: toStringArray(
      data.keyFactors ?? data.key_factors ?? data.factors,
      ["Технические индикаторы", "Рыночные настроения"]
    ),
    recommendation: String(
      data.recommendation ?? data.advice ?? "Дождитесь подтверждения сигнала перед действиями."
    ),
    disclaimer,
  };
}

export function parseAndValidateAiResponse(
  rawContent: string,
  ctx: AnalysisContext
): AiResponse | null {
  const parsed = parseJsonLoose(rawContent);
  if (!parsed) return null;

  const normalized = normalizeAiPayload(unwrapPayload(parsed), ctx);
  const validated = aiResponseSchema.safeParse(normalized);

  if (validated.success) return validated.data;

  const relaxed = aiResponseSchema.safeParse({
    ...normalized,
    reasons: normalized.reasons.length ? normalized.reasons : ["Анализ на основе переданных данных"],
    risks: normalized.risks.length ? normalized.risks : ["Рыночная волатильность"],
    keyFactors: normalized.keyFactors.length
      ? normalized.keyFactors
      : ["Индикаторы", "Объём", "Тренд"],
  });

  return relaxed.success ? relaxed.data : null;
}

/**
 * News sentiment — FinBERT via HuggingFace (optional) + financial lexicon fallback.
 */

import axios from "axios";
import type { NewsItem, NewsSummary } from "@/types";

const FINBERT_URL = "https://api-inference.huggingface.co/models/ProsusAI/finbert";
const HF_TIMEOUT_MS = 12_000;

const POSITIVE_WORDS = [
  "surge", "rally", "bull", "gain", "rise", "record", "adoption", "partnership", "launch",
  "upgrade", "approval", "inflow", "breakout", "accumulation", "etf inflow",
  "рост", "рали", "быч", "партнёр", "рекорд", "принят", "одобрен", "прорыв",
];
const NEGATIVE_WORDS = [
  "crash", "drop", "bear", "fall", "hack", "scam", "ban", "lawsuit", "fraud", "decline",
  "outflow", "liquidation", "selloff", "dump", "sec", "fine", "exploit",
  "паден", "медв", "взлом", "скам", "запрет", "суд", "обвал", "ликвидац",
];

type SentimentLabel = NewsItem["sentiment"];

interface ScoredText {
  label: SentimentLabel;
  score: number;
}

function labelFromScore(score: number): SentimentLabel {
  if (score > 0.12) return "positive";
  if (score < -0.12) return "negative";
  return "neutral";
}

/** Lexicon-based scorer — improved financial keywords */
export function scoreTextLexicon(text: string): ScoredText {
  const lower = text.toLowerCase();
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE_WORDS) {
    if (lower.includes(w)) pos += w.includes(" ") ? 1.5 : 1;
  }
  for (const w of NEGATIVE_WORDS) {
    if (lower.includes(w)) neg += w.includes(" ") ? 1.5 : 1;
  }
  const total = pos + neg || 1;
  const score = (pos - neg) / total;
  return { label: labelFromScore(score), score: Math.max(-1, Math.min(1, score)) };
}

async function scoreTextFinbert(text: string): Promise<ScoredText | null> {
  const apiKey = process.env.HF_API_KEY?.trim() || process.env.HUGGINGFACE_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const { data } = await axios.post<Array<Array<{ label: string; score: number }>>>(
      FINBERT_URL,
      { inputs: text.slice(0, 512) },
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: HF_TIMEOUT_MS,
      }
    );

    const preds = data[0];
    if (!preds?.length) return null;

    const pos = preds.find((p) => p.label.toLowerCase().includes("positive"))?.score ?? 0;
    const neg = preds.find((p) => p.label.toLowerCase().includes("negative"))?.score ?? 0;
    const neu = preds.find((p) => p.label.toLowerCase().includes("neutral"))?.score ?? 0;
    const score = pos - neg;
    const label: SentimentLabel =
      pos >= neg && pos >= neu ? "positive" : neg >= pos && neg >= neu ? "negative" : "neutral";

    return { label, score: Math.max(-1, Math.min(1, score)) };
  } catch {
    return null;
  }
}

/** Score single headline — FinBERT first, lexicon fallback */
export async function analyzeHeadlineSentiment(text: string): Promise<ScoredText> {
  const finbert = await scoreTextFinbert(text);
  if (finbert) return finbert;
  return scoreTextLexicon(text);
}

export function buildNewsSummary(
  items: NewsItem[],
  options: { source?: NewsSummary["sentimentSource"]; scores?: number[] } = {}
): NewsSummary {
  const positive = items.filter((i) => i.sentiment === "positive").length;
  const negative = items.filter((i) => i.sentiment === "negative").length;
  const neutral = items.filter((i) => i.sentiment === "neutral").length;

  let aggregateScore = 0;
  if (options.scores?.length) {
    aggregateScore = options.scores.reduce((a, b) => a + b, 0) / options.scores.length;
  } else {
    aggregateScore = (positive - negative) / Math.max(1, items.length);
  }

  let summary = "Нейтральный новостной фон.";
  if (aggregateScore > 0.15) summary = "Преобладают позитивные новости.";
  else if (aggregateScore < -0.15) summary = "Преобладают негативные новости.";

  return {
    items,
    positive,
    negative,
    neutral,
    summary,
    aggregateScore: Math.round(aggregateScore * 1000) / 1000,
    sentimentSource: options.source ?? "lexicon",
  };
}

/** Full pipeline: score + summarize */
export async function processNewsItems(items: NewsItem[]): Promise<NewsSummary> {
  const scored: NewsItem[] = [];
  const scores: number[] = [];
  let source: NewsSummary["sentimentSource"] = "lexicon";
  const hasHf = !!(process.env.HF_API_KEY?.trim() || process.env.HUGGINGFACE_API_KEY?.trim());

  for (const item of items.slice(0, 10)) {
    let result: ScoredText;
    if (hasHf) {
      const fb = await scoreTextFinbert(item.title);
      if (fb) {
        result = fb;
        source = "finbert";
      } else {
        result = scoreTextLexicon(item.title);
      }
    } else {
      result = scoreTextLexicon(item.title);
    }
    scored.push({ ...item, sentiment: result.label });
    scores.push(result.score);
  }

  return buildNewsSummary(scored, { source, scores });
}

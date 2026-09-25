/**
 * News event study: what the price of BTC (and of the coin in the headline) really did after each
 * type of news. Topics come from the same rules the live news monitor uses, plus a few macro topics
 * that move BTC, so the history and the live feed are classified identically.
 *
 * Many outlets repeat one story, so per topic only the first report within CLUSTER_MS counts.
 */

import type { Candle } from "@/types";
import { IMPACT_RULES, matchImpactRules } from "@/services/news-impact/impact-rules";
import { detectPriorityTriggers, isRetrospectiveHeadline } from "@/services/news-impact/news-filter";

export const HORIZONS = [
  { key: "m15", label: "15 мин", ms: 15 * 60_000 },
  { key: "h1", label: "1 ч", ms: 60 * 60_000 },
  { key: "h4", label: "4 ч", ms: 4 * 60 * 60_000 },
  { key: "h24", label: "24 ч", ms: 24 * 60 * 60_000 },
] as const;

export type HorizonKey = (typeof HORIZONS)[number]["key"];
export type Moves = Partial<Record<HorizonKey, number>>;

/** Macro topics the crypto rules don't cover but that move BTC. */
const MACRO_TOPICS: Array<{ id: string; pattern: RegExp }> = [
  { id: "cpi_inflation", pattern: /\b(cpi|consumer price|inflation (data|report|print)|pce)\b/i },
  { id: "fed_policy", pattern: /\b(fomc|powell|federal reserve|fed (meeting|minutes|decision|chair))\b/i },
  { id: "jobs_report", pattern: /\b(nonfarm|non-farm|payrolls|jobs report|unemployment rate)\b/i },
  { id: "tariffs", pattern: /\b(tariffs?|trade war)\b/i },
  { id: "btc_reserve", pattern: /\b(strategic bitcoin reserve|bitcoin reserve)\b/i },
  { id: "etf_outflow", pattern: /\betfs?\b.*\boutflows?\b|\boutflows?\b.*\betfs?\b/i },
];

export const TOPIC_LABELS: Record<string, string> = {
  cpi_inflation: "Инфляция (CPI, PCE)",
  fed_policy: "ФРС, Пауэлл, FOMC",
  jobs_report: "Рынок труда США",
  tariffs: "Пошлины, торговые войны",
  btc_reserve: "Государственный резерв биткоина",
  etf_outflow: "Отток из ETF",
  binance_listing: "Листинг на Binance",
  coinbase_listing: "Листинг на Coinbase",
  okx_listing: "Листинг на OKX",
  upbit_listing: "Листинг на Upbit",
  etf_approved: "Одобрение ETF",
  etf_rejected: "Отказ по ETF",
  etf_filing: "Заявка на ETF",
  hack_exploit: "Взлом протокола или биржи",
  bridge_hack: "Взлом моста",
  oracle_failure: "Сбой оракула",
  rug_pull: "Rug pull, скам",
  sec_lawsuit: "Иск SEC",
  sec_win: "Победа над SEC",
  sanctions: "Санкции",
  delist: "Делистинг",
  exchange_halt: "Остановка торгов или выводов",
  whale_buy: "Киты покупают",
  whale_sell: "Киты продают",
  treasury_buy: "Компания покупает крипту в резерв",
  partnership_major: "Партнёрство с крупной компанией",
  partnership_generic: "Партнёрство",
  liquidation_cascade: "Каскад ликвидаций",
  fed_rate_cut: "Снижение ставки ФРС",
  fed_rate_hike: "Повышение ставки ФРС",
  stablecoin_depeg: "Отвязка стейблкоина",
  bankruptcy: "Банкротство",
  token_unlock: "Разлок токенов",
  mainnet_launch: "Запуск основной сети",
  network_outage: "Остановка сети",
  spot_etf_inflow: "Приток в ETF",
};

export function topicLabel(topic: string): string {
  if (topic.startsWith("trigger:")) return `Прочее: ${topic.slice(8)}`;
  return TOPIC_LABELS[topic] ?? topic;
}

/** "Bitcoin falls 5% as …", "ETH surges after …": a report of a move, not news that could cause one. */
const PRICE_MOVE_REPORT =
  /\b(falls?|fell|drops?|dropped|slides?|slid|plunges?|plunged|tumbles?|tumbled|sinks?|sank|slumps?|jumps?|jumped|rises?|rose|surges?|surged|soars?|soared|rall(y|ies|ied)|climbs?|climbed|spikes?|spiked|dips?|dipped|crash(es|ed)?|rebounds?|rebounded)\b.*(\d+(\.\d+)?\s?%|\b(after|as|amid|following|on)\b)/i;

const ruleScore = new Map(IMPACT_RULES.map((r) => [r.id, r.score]));

/**
 * The topic of a headline: the strongest matching news rule, else a macro topic, else a priority trigger.
 * Headlines that retell a move that already happened ("Bitcoin falls 5% after …") get no topic: counting
 * them would credit the news with a move that came before it.
 */
export function newsTopic(title: string, summary = ""): string | null {
  const text = `${title} ${summary}`;
  if (isRetrospectiveHeadline(text) || PRICE_MOVE_REPORT.test(title)) return null;
  const rules = matchImpactRules(text).sort((a, b) => (ruleScore.get(b.id) ?? 0) - (ruleScore.get(a.id) ?? 0));
  if (rules[0]) return rules[0].id;
  const macro = MACRO_TOPICS.find((t) => t.pattern.test(text));
  if (macro) return macro.id;
  const trigger = detectPriorityTriggers(text)[0];
  return trigger ? `trigger:${trigger}` : null;
}

/** Price at time t: the open of the first bar that starts at or after t (what a trader could actually get). */
export function priceAt(candles: Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].openTime < t) lo = mid + 1;
    else hi = mid;
  }
  const c = candles[lo];
  // A gap longer than one hour means there is no price near t.
  return c && c.openTime - t <= 60 * 60_000 ? c.open : NaN;
}

/** Percent moves after t for every horizon; a horizon past the end of the candles is left out. */
export function movesAfter(candles: Candle[], t: number): Moves {
  const start = priceAt(candles, t);
  const moves: Moves = {};
  if (!(start > 0)) return moves;
  const last = candles.at(-1);
  for (const h of HORIZONS) {
    if (!last || last.openTime < t + h.ms) continue;
    const p = priceAt(candles, t + h.ms);
    if (p > 0) moves[h.key] = (p / start - 1) * 100;
  }
  return moves;
}

export interface NewsEvent {
  topic: string;
  time: number;
  moves: Moves;
}

export const CLUSTER_MS = 6 * 60 * 60_000;

/** Keeps the first report of each topic within CLUSTER_MS: ten outlets retelling one story are one event. */
export function clusterEvents(events: NewsEvent[]): NewsEvent[] {
  const lastByTopic = new Map<string, number>();
  const out: NewsEvent[] = [];
  for (const e of [...events].sort((a, b) => a.time - b.time)) {
    const last = lastByTopic.get(e.topic);
    if (last !== undefined && e.time - last < CLUSTER_MS) continue;
    lastByTopic.set(e.topic, e.time);
    out.push(e);
  }
  return out;
}

export interface HorizonStats {
  n: number;
  /** Mean move after the news minus the usual mean move over the same horizon, % */
  meanPct: number;
  /** Share of events after which price went up */
  upShare: number;
  /** Mean absolute move relative to the usual one (1 = as on any random hour) */
  sizeRatio: number;
  tStat: number;
  /** Mean excess move in the first and second half of the events — the sign should agree */
  halves: [number, number];
}

export interface TopicStats {
  topic: string;
  label: string;
  events: number;
  horizons: Partial<Record<HorizonKey, HorizonStats>>;
  verdict: "up" | "down" | "volatile" | "none" | "few";
  summary: string;
}

/** The usual behaviour of the price: mean and mean absolute move over each horizon from every hour. */
export interface Baseline {
  mean: Partial<Record<HorizonKey, number>>;
  meanAbs: Partial<Record<HorizonKey, number>>;
}

export function baselineOf(candles: Candle[], stepMs = 60 * 60_000): Baseline {
  const sums: Record<string, { s: number; a: number; n: number }> = {};
  if (!candles.length) return { mean: {}, meanAbs: {} };
  for (let t = candles[0].openTime; t < candles.at(-1)!.openTime; t += stepMs) {
    const m = movesAfter(candles, t);
    for (const h of HORIZONS) {
      const v = m[h.key];
      if (v === undefined) continue;
      const acc = (sums[h.key] ??= { s: 0, a: 0, n: 0 });
      acc.s += v;
      acc.a += Math.abs(v);
      acc.n++;
    }
  }
  const mean: Baseline["mean"] = {};
  const meanAbs: Baseline["meanAbs"] = {};
  for (const [k, v] of Object.entries(sums)) {
    mean[k as HorizonKey] = v.s / v.n;
    meanAbs[k as HorizonKey] = v.a / v.n;
  }
  return { mean, meanAbs };
}

export const MIN_EVENTS = 20;
const MIN_T = 2;
const MIN_SIZE_RATIO = 1.3;

function horizonStats(values: number[], base: number, baseAbs: number): HorizonStats {
  const n = values.length;
  const excess = values.map((v) => v - base);
  const mean = excess.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(excess.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const half = Math.floor(n / 2);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    n,
    meanPct: mean,
    upShare: values.filter((v) => v > 0).length / n,
    sizeRatio: baseAbs > 0 ? avg(values.map(Math.abs)) / baseAbs : 0,
    tStat: sd > 0 ? (mean / sd) * Math.sqrt(n) : 0,
    halves: [avg(excess.slice(0, half)), avg(excess.slice(half))],
  };
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

/**
 * Per-topic statistics. A direction counts only with ≥ MIN_EVENTS separate events, |t| ≥ 2 at 1 or 4 hours
 * and the same sign in both halves of the history; otherwise the news may still make price move more than usual.
 */
export function studyTopics(events: NewsEvent[], baseline: Baseline): TopicStats[] {
  const byTopic = new Map<string, NewsEvent[]>();
  for (const e of clusterEvents(events)) byTopic.set(e.topic, [...(byTopic.get(e.topic) ?? []), e]);

  const out: TopicStats[] = [];
  for (const [topic, list] of byTopic) {
    const horizons: TopicStats["horizons"] = {};
    for (const h of HORIZONS) {
      const values = list.map((e) => e.moves[h.key]).filter((v): v is number => v !== undefined);
      if (values.length) horizons[h.key] = horizonStats(values, baseline.mean[h.key] ?? 0, baseline.meanAbs[h.key] ?? 0);
    }
    const s: TopicStats = { topic, label: topicLabel(topic), events: list.length, horizons, verdict: "few", summary: "" };
    const directional = (["h1", "h4"] as const)
      .map((k) => ({ k, h: horizons[k] }))
      .find(({ h }) => h && h.n >= MIN_EVENTS && Math.abs(h.tStat) >= MIN_T && Math.sign(h.halves[0]) === Math.sign(h.halves[1]) && h.halves[0] !== 0);
    const h1 = horizons.h1;
    if (!h1 || h1.n < MIN_EVENTS) {
      s.summary = `мало случаев (${list.length}) — вывода нет`;
    } else if (directional) {
      const h = directional.h!;
      const label = HORIZONS.find((x) => x.key === directional.k)!.label;
      s.verdict = h.meanPct > 0 ? "up" : "down";
      s.summary = `через ${label} цена в среднем ${pct(h.meanPct)} к обычному, вверх в ${Math.round(h.upShare * 100)}% случаев (t = ${h.tStat.toFixed(1)}, ${h.n} событий)`;
    } else if (h1.sizeRatio >= MIN_SIZE_RATIO) {
      s.verdict = "volatile";
      s.summary = `цена двигается в ${h1.sizeRatio.toFixed(1)} раза сильнее обычного, но направление не устойчиво (${h1.n} событий)`;
    } else {
      s.verdict = "none";
      s.summary = `заметного влияния нет: через 1 ч ${pct(h1.meanPct)} к обычному, размах как обычно (${h1.n} событий)`;
    }
    out.push(s);
  }
  const rank = { up: 0, down: 0, volatile: 1, none: 2, few: 3 };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.events - a.events);
}

export function describeTopics(stats: TopicStats[], asset = "BTC"): string[] {
  const lines = [`Реакция ${asset} на новости по типам (событий · 1 ч · 4 ч · 24 ч · вывод):`];
  for (const s of stats) {
    const cell = (k: HorizonKey) => {
      const h = s.horizons[k];
      return h ? `${pct(h.meanPct)} (${Math.round(h.upShare * 100)}%↑, ×${h.sizeRatio.toFixed(1)})` : "—";
    };
    lines.push(`  ${s.label}: ${s.events} · ${cell("h1")} · ${cell("h4")} · ${cell("h24")} · ${s.summary}`);
  }
  return lines;
}

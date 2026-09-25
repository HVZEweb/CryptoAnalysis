/**
 * Event study: trade only on rare, sharp positioning events and check whether the move that follows
 * pays after costs. Events are read from the pooled feature rows (services/pooled/features), so the
 * same definitions can run live on the collector's data.
 *
 * Binance publishes no liquidation history, so a liquidation wave is proxied by open interest
 * collapsing during a sharp price move: positions closing en masse while price runs.
 */

import type { Candle } from "@/types";
import { POOLED_FEATURE_NAMES } from "@/services/pooled/features";
import { atr14 } from "@/services/strategy-lab/lab";
import { selectAndValidate, simulateIntents, type Candidate, type ResearchVerdict, type TradeIntent } from "@/services/research/common";

type Row = Record<(typeof POOLED_FEATURE_NAMES)[number], number>;

export interface EventDef {
  key: string;
  title: string;
  fires: (r: Row) => boolean;
  /** The side the event points to: the price move, or the crowded side of positioning */
  side: (r: Row) => 1 | -1;
}

const sign = (v: number): 1 | -1 => (v >= 0 ? 1 : -1);

export const EVENTS: EventDef[] = [
  {
    key: "oi_spike",
    title: "Скачок открытого интереса (≥3σ за час)",
    fires: (r) => r.oi_chg_1 >= 3,
    side: (r) => sign(r.ret_1),
  },
  {
    key: "oi_flush",
    title: "Волна закрытий: открытый интерес падает ≥3σ при движении цены ≥2σ (признак ликвидаций)",
    fires: (r) => r.oi_chg_1 <= -3 && Math.abs(r.ret_1) >= 2,
    side: (r) => sign(r.ret_1),
  },
  {
    // `funding` = rate × 1e4 / 3, so 1 ≈ 3 bp per 8h — three times the usual 1 bp baseline.
    key: "funding_extreme",
    title: "Экстремальный фандинг (≥2,5σ от обычного и ≥3 п. за 8 ч)",
    fires: (r) => Math.abs(r.funding_z) >= 2.5 && Math.abs(r.funding) >= 1,
    side: (r) => sign(r.funding),
  },
  {
    key: "ls_extreme",
    title: "Перекос лонгов/шортов по всем счетам (≥2,5σ)",
    fires: (r) => Math.abs(r.ls_global_z) >= 2.5,
    side: (r) => sign(r.ls_global_z),
  },
  {
    key: "taker_extreme",
    title: "Перевес рыночных покупок/продаж (≥3σ)",
    fires: (r) => Math.abs(r.taker_z) >= 3,
    side: (r) => sign(r.taker_z),
  },
];

/** One event per coin within this many bars: a wave is one event, not ten. */
export const EVENT_COOLDOWN = 24;

export interface EventHit {
  symbol: string;
  index: number;
  side: 1 | -1;
}

export function detectEvents(
  def: EventDef,
  series: Array<{ symbol: string; candles: Candle[]; rows: Array<number[] | null> }>
): EventHit[] {
  const hits: EventHit[] = [];
  for (const s of series) {
    let last = -Infinity;
    for (let i = 0; i < s.rows.length; i++) {
      const x = s.rows[i];
      if (!x || i - last < EVENT_COOLDOWN) continue;
      const row = Object.fromEntries(POOLED_FEATURE_NAMES.map((n, k) => [n, x[k]])) as Row;
      if (!def.fires(row)) continue;
      hits.push({ symbol: s.symbol, index: i, side: def.side(row) });
      last = i;
    }
  }
  return hits;
}

const SETUPS = [
  ...[1, 2].flatMap((slAtr) => [1, 2, 3].flatMap((rr) => [6, 24].map((horizon) => ({ slAtr, rr, horizon })))),
];

export function studyEvents(
  series: Array<{ symbol: string; candles: Candle[]; rows: Array<number[] | null> }>,
  from: number,
  to: number
): Array<ResearchVerdict & { events: number }> {
  const candlesBySymbol = new Map(series.map((s) => [s.symbol, s.candles]));
  const atrBySymbol = new Map(series.map((s) => [s.symbol, atr14(s.candles)]));
  return EVENTS.map((def) => {
    const hits = detectEvents(def, series);
    const candidates: Candidate[] = [];
    for (const mode of ["follow", "fade"] as const) {
      for (const setup of SETUPS) {
        const intents: TradeIntent[] = hits.flatMap((h) => {
          const atr = atrBySymbol.get(h.symbol)![h.index];
          if (!(atr > 0)) return [];
          const sl = atr * setup.slAtr;
          return [{ symbol: h.symbol, index: h.index, side: mode === "follow" ? h.side : (-h.side as 1 | -1), slDist: sl, tpDist: sl * setup.rr, horizon: setup.horizon }];
        });
        candidates.push({
          label: `${mode === "follow" ? "по направлению" : "против"}; стоп ${setup.slAtr} ATR, цель ×${setup.rr}, до ${setup.horizon} ч`,
          trades: simulateIntents(intents, candlesBySymbol),
        });
      }
    }
    return { ...selectAndValidate(def.title, candidates, from, to), events: hits.length };
  });
}

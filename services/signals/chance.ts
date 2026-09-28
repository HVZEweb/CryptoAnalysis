/**
 * "Chances": trade ideas the owner asked for even without proven profit — a model with a validated
 * direction edge is confident, or a strong news alert points one way. Each goes out as a full trade
 * plan with a symmetric target and stop, so the chance to reach the target is about the direction
 * accuracy itself, and is logged (signal_log.kind) so its live result is measured like any signal.
 */

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n: number) => (n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toPrecision(4));
const msk = (t: number) => new Date(t).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });

/** Minutes in a Binance interval such as "15m", "1h", "4h", "1d". */
export function intervalMinutes(interval: string): number {
  const m = /^(\d+)([mhd])$/.exec(interval);
  if (!m) throw new Error(`unknown interval ${interval}`);
  return Number(m[1]) * { m: 1, h: 60, d: 1440 }[m[2] as "m" | "h" | "d"];
}

export interface TradePlan {
  side: "LONG" | "SHORT";
  entry: number;
  tp: number;
  sl: number;
  closeBy: number;
}

/**
 * Target and stop at the same distance: one ATR scaled to the holding time (moves grow with √time),
 * so reaching the target first is roughly as likely as being right about the direction.
 */
export function chancePlan(side: "LONG" | "SHORT", price: number, atr: number, horizonBars: number, entryTime: number, barMinutes: number): TradePlan | null {
  if (!(price > 0) || !(atr > 0) || !(horizonBars > 0)) return null;
  const dist = atr * Math.sqrt(horizonBars);
  const dir = side === "LONG" ? 1 : -1;
  return { side, entry: price, tp: price + dir * dist, sl: price - dir * dist, closeBy: entryTime + horizonBars * barMinutes * 60_000 };
}

/** Plan for a news alert: target at the expected move, stop at the same distance. */
export function newsPlan(side: "LONG" | "SHORT", price: number, expectedMovePct: number, holdMinutes: number, entryTime: number): TradePlan | null {
  if (!(price > 0) || !(expectedMovePct > 0) || !(holdMinutes > 0)) return null;
  const dist = (price * Math.min(expectedMovePct, 10)) / 100;
  const dir = side === "LONG" ? 1 : -1;
  return { side, entry: price, tp: price + dir * dist, sl: price - dir * dist, closeBy: entryTime + holdMinutes * 60_000 };
}

/** News hold times ("5-15 min" … "1-4 hours") → the upper bound in minutes. */
export function holdMinutes(label: string): number {
  const m = /(\d+)\s*(min|hour)/i.exec(label.replace(/^\d+\s*-\s*/, ""));
  if (!m) return 60;
  return Number(m[1]) * (m[2].toLowerCase() === "hour" ? 60 : 1);
}

const signedPct = (to: number, from: number) => {
  const p = ((to - from) / from) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
};

/** Step-by-step instructions shared by chance and news messages. */
export function planSteps(plan: TradePlan): string[] {
  const long = plan.side === "LONG";
  const stopPct = Math.abs(plan.sl - plan.entry) / plan.entry;
  const size = 0.01 / stopPct;
  return [
    `<b>Что делать</b>`,
    `1. Открыть ${plan.side} рыночным ордером сейчас, цена ~${fmt(plan.entry)}.`,
    `2. Сразу поставить тейк-профит лимитным ордером: ${fmt(plan.tp)} (${signedPct(plan.tp, plan.entry)}).`,
    `3. Поставить стоп-лосс (стоп-маркет): ${fmt(plan.sl)} (${signedPct(plan.sl, plan.entry)}).`,
    `4. Если до ${msk(plan.closeBy)} МСК не сработало ни то ни другое — закрыть рыночным.`,
    `Размер: чтобы стоп стоил не больше 1% депозита, позиция ≈ ${size >= 1 ? `${size.toFixed(1)} депозита` : `${(size * 100).toFixed(0)}% депозита`}. Меньше — безопаснее.`,
    `${long ? "Рост" : "Падение"} до цели и до стопа одинаково далеко, поэтому шанс дойти до цели примерно равен точности направления.`,
  ];
}

export interface ChanceInfo {
  symbol: string;
  title: string;
  pUp: number;
  /** Direction accuracy of the model when it is this confident, on history it was not trained on */
  confidentAccuracy: number | null;
  plan: TradePlan;
}

export function chanceMessage(c: ChanceInfo): string {
  const acc = c.confidentAccuracy != null ? `${(c.confidentAccuracy * 100).toFixed(1)}%` : "не измерена";
  return [
    `🎯 <b>Шанс: ${c.plan.side} ${c.symbol}</b> · ${escapeHtml(c.title)}`,
    `Модель: ${(c.pUp * 100).toFixed(1)}% за рост. В таких уверенных случаях на истории направление угадано в ${acc}.`,
    ``,
    ...planSteps(c.plan),
    ``,
    `⚠️ Не проверенная сделка: прибыль после комиссий (0,1–0,16% за сделку) для таких шансов не подтверждена. Итог придёт сам, живая статистика — /stats. /observe off — выключить шансы.`,
  ].join("\n");
}

/**
 * Runs the funding forward test (rules in services/funding-carry/rule.ts) on a paper book: each closed
 * UTC day earns the weights set at the previous close, and every Monday's close sets new weights.
 * Missed days are caught up from Binance history, so a restart or a quiet night changes nothing.
 * No orders are placed anywhere.
 */

import { getTelegramConfig, sendTelegram } from "@/lib/telegram";
import { dailyBars, dailyFunding, gently, usdtPerpetuals } from "@/services/funding-carry/binance";
import {
  CARRY_MIN_DAYS,
  CARRY_START,
  CARRY_VARIANTS,
  CARRY_WINDOW,
  DAY,
  carryStats,
  dayResult,
  eligibleAt,
  isRebalanceDay,
  rebalanceCost,
  targetWeights,
  universeAt,
  type CoinDays,
  type DayMove,
} from "@/services/funding-carry/rule";
import * as store from "@/services/funding-carry/store";

/** Daily bars and funding are final a little after 00:00 UTC. */
const SETTLE_MS = 15 * 60_000;
/** A rebalance with more coins missing than this is retried later rather than trusted. */
const MAX_MISSING = 0.05;

export async function rebalance(day: number): Promise<Record<string, Record<string, number>>> {
  const symbols = await usdtPerpetuals();
  const bars = await gently(symbols, (s) => dailyBars(s, day - CARRY_MIN_DAYS * DAY, day));
  const missing = bars.filter((b) => b === null).length;
  if (missing > symbols.length * MAX_MISSING) throw new Error(`нет свечей у ${missing} из ${symbols.length} монет`);
  const coins: CoinDays[] = symbols
    .map((symbol, i) => ({ symbol, close: bars[i]?.close ?? new Map(), volume: bars[i]?.volume ?? new Map(), funding: new Map<number, number>() }))
    .filter((c) => c.close.size > 0);

  const eligible = [...new Set(CARRY_VARIANTS.flatMap((v) => eligibleAt(universeAt(day, coins), v.top)))];
  const funding = await gently(eligible, (s) => dailyFunding(s, day - (CARRY_WINDOW - 1) * DAY, day));
  if (funding.some((f) => f === null)) throw new Error("не загрузился фандинг части монет");
  const bySymbol = new Map(coins.map((c) => [c.symbol, c]));
  eligible.forEach((s, i) => (bySymbol.get(s)!.funding = funding[i]!));

  const universe = universeAt(day, coins);
  return Object.fromEntries(CARRY_VARIANTS.map((v) => [v.key, targetWeights(universe, v.top)]));
}

async function movesOn(day: number, symbols: string[]): Promise<Record<string, DayMove>> {
  const rows = await gently(symbols, async (s) => {
    const [bars, funding] = await Promise.all([dailyBars(s, day - DAY, day), dailyFunding(s, day, day)]);
    return { prevClose: bars.close.get(day - DAY), close: bars.close.get(day), funding: funding.get(day) ?? 0 };
  });
  const failed = symbols.filter((_, i) => rows[i] === null);
  if (failed.length) throw new Error(`не загрузились данные ${failed.slice(0, 5).join(", ")}`);
  return Object.fromEntries(symbols.map((s, i) => [s, rows[i]!]));
}

export async function runCarryCycle(now = Date.now()): Promise<{ daysProcessed: number }> {
  await store.ensureCarryTables();
  const lastClosed = Math.floor((now - SETTLE_MS) / DAY) * DAY - DAY;
  const done = await Promise.all(CARRY_VARIANTS.map((v) => store.lastDay(v.key)));
  let processed = 0;

  for (let day = Math.min(...done.map((d) => d ?? CARRY_START - DAY)) + DAY; day <= lastClosed; day += DAY) {
    const held = await Promise.all(CARRY_VARIANTS.map((v) => store.weightsAt(v.key, day - DAY)));
    const symbols = [...new Set(held.flatMap((h) => Object.keys(h?.weights ?? {})))];
    // Everything for the day is fetched before anything is saved, so a failure retries the whole day.
    const moves = symbols.length ? await movesOn(day, symbols) : {};
    const targets = isRebalanceDay(day) ? await rebalance(day) : null;

    for (const [i, v] of CARRY_VARIANTS.entries()) {
      const h = held[i];
      const r = dayResult(h?.weights ?? {}, moves);
      // As in the backtest, a rebalance is charged on the day after it.
      await store.saveDay({ variant: v.key, day, price_ret: r.price, funding_ret: r.funding, cost: h && h.day === day - DAY ? h.cost : 0 });
      if (targets) await store.saveWeights(v.key, day, targets[v.key], rebalanceCost(h?.weights ?? {}, targets[v.key]));
    }
    processed++;
    // Report a current rebalance only, not one caught up from the past.
    if (targets && day === lastClosed && getTelegramConfig()) await sendTelegram(await carryReport());
  }
  return { daysProcessed: processed };
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

/** Text for /carry and the weekly message. */
export async function carryReport(): Promise<string> {
  await store.ensureCarryTables();
  const lines = [`💰 <b>Фандинг-портфель: проверка на новых данных</b> (бумажный счёт с ${new Date(CARRY_START).toLocaleDateString("ru-RU")})`];
  for (const v of CARRY_VARIANTS) {
    const rows = await store.days(v.key);
    const returns = rows.map((r) => r.price_ret + r.funding_ret - r.cost);
    const s = carryStats(returns);
    const week = carryStats(returns.slice(-7));
    const funding = rows.reduce((a, r) => a + r.funding_ret, 0) * 100;
    const mark = v.main ? "▶" : "▫️";
    lines.push(
      s.days && returns.some((r) => r !== 0)
        ? `${mark} ${v.label}: с начала ${pct(s.totalPct)} за ${s.days} дн. (за неделю ${pct(week.totalPct)}), из них фандинг ${pct(funding)}, просадка ${s.maxDrawdownPct.toFixed(1)}%, t = ${s.tStat.toFixed(1)}`
        : `${mark} ${v.label}: результатов пока нет, первая пересборка в понедельник после закрытия дня`
    );
  }
  const main = CARRY_VARIANTS.find((v) => v.main)!;
  const current = await store.weightsAt(main.key, Number.MAX_SAFE_INTEGER);
  if (current) {
    const names = (side: number) =>
      Object.entries(current.weights)
        .filter(([, w]) => Math.sign(w) === side)
        .map(([s]) => s.replace(/USDT$/, ""))
        .sort()
        .join(", ");
    lines.push(
      `Позиции главного варианта с ${new Date(current.day + DAY).toLocaleDateString("ru-RU")}, половина капитала на сторону, доли равные:`,
      `🟢 лонг (самый низкий фандинг): ${names(1)}`,
      `🔴 шорт (самый высокий фандинг): ${names(-1)}`
    );
  }
  lines.push(
    "Правило объявлено заранее и не меняется. Итог через 26 недель: в плюсе после комиссий и просадка не глубже 32%. " +
      "За полгода перевес статистически не доказать, это проверка, что правило вживую ведёт себя как на истории. Сделки не открываются."
  );
  return lines.join("\n");
}

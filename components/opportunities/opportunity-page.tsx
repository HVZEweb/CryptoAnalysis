"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { PriceChart, type ChartCandle } from "@/components/opportunities/price-chart";
import { entryLimits } from "@/services/signals/chance";
import {
  KIND,
  KindBadge,
  ProgressTrack,
  ResultValue,
  SideBadge,
  STATUS,
  bpPct,
  dateTime,
  pctOf,
  price,
  relative,
  signed,
  tone,
  type OpportunitySummary,
  type TrackRecord,
} from "@/components/opportunities/shared";

interface Details {
  pUp?: number;
  modelTitle?: string;
  accuracy?: number;
  confidentAccuracy?: number;
  holdout?: { trades: number; winRate: number; avgNetBp: number };
  coinVerdict?: string;
  atr?: number;
  news?: { title?: string; url?: string; reason?: string; impactScore?: number; expectedMovePct?: number; strength?: string; urgency?: string; source?: string; holdTime?: string };
}

interface Detail extends OpportunitySummary {
  modelKey: string;
  barInterval: string;
  details: Details | null;
  market: "Spot" | "Futures";
  coin: {
    base: string;
    market: {
      price: number | null;
      changePct24h: number | null;
      high24h: number | null;
      low24h: number | null;
      quoteVolume24h: number | null;
      fundingRate: number | null;
      nextFundingTime: number | null;
      openInterestUsd: number | null;
    };
    profile: {
      binanceSpot: boolean | null;
      binanceFutures: boolean | null;
      coingecko: {
        name: string;
        ambiguous: boolean;
        rank: number | null;
        marketCap: number | null;
        fdv: number | null;
        circulatingShare: number | null;
        categories: string[];
        homepage: string | null;
      } | null;
    } | null;
  };
  chart: { interval: string; candles: ChartCandle[] };
  similar: { label: string; record: TrackRecord };
  sameCoin: OpportunitySummary[];
}

const usd = (v: number | null | undefined) => (v == null ? "—" : `$${formatNumber(v, v >= 1e6 ? 2 : 0)}`);
const pct = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);

function Section({ title, children, className, aside }: { title: string; children: React.ReactNode; className?: string; aside?: React.ReactNode }) {
  return (
    <section className={cn("card-premium rounded-2xl p-4 sm:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold tracking-wide text-foreground/90">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub, valueClass }: { label: string; value: React.ReactNode; sub?: React.ReactNode; valueClass?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/8">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-base font-semibold tabular-nums", valueClass)}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-2 text-sm last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums">{children}</dd>
    </div>
  );
}

function Plan({ o }: { o: Detail }) {
  const stopPct = Math.abs(o.sl - o.entry) / o.entry;
  const size = 0.01 / stopPct;
  const limits = entryLimits({ side: o.side, entry: o.entry, tp: o.tp, entryTime: o.sentAt, closeBy: o.closeBy });
  const long = o.side === "LONG";
  const steps = [
    `Открыть ${o.side} рыночным ордером по цене около ${price(o.entry)}. Не входить, если уже позже ${dateTime(limits.validUntil)} МСК или цена ${long ? "выше" : "ниже"} ${price(limits.chaseLimit)} (прошла половину пути до цели) либо ${long ? "ниже" : "выше"} стопа.`,
    `Сразу поставить тейк-профит лимитным ордером: ${price(o.tp)} (${pctOf(o.tp, o.entry)}%).`,
    `Поставить стоп-лосс (стоп-маркет): ${price(o.sl)} (${pctOf(o.sl, o.entry)}%).`,
    `Если до ${dateTime(o.closeBy)} МСК не сработало ни то ни другое — закрыть рыночным.`,
    `Размер: чтобы стоп стоил не больше 1% депозита, позиция ≈ ${size >= 1 ? `${size.toFixed(1)} депозита` : `${(size * 100).toFixed(0)}% депозита`}. Меньше — безопаснее.`,
  ];
  return (
    <Section title="План сделки">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Вход" value={price(o.entry)} sub={o.market === "Futures" ? "фьючерс USDT" : "цена спота Binance"} />
        <Stat label="Цель" value={price(o.tp)} sub={`${pctOf(o.tp, o.entry)}%`} valueClass="text-emerald-300" />
        <Stat label="Стоп" value={price(o.sl)} sub={`${pctOf(o.sl, o.entry)}%`} valueClass="text-red-300" />
        <Stat label="Закрыть до" value={dateTime(o.closeBy)} sub="МСК" />
      </div>
      <ol className="mt-4 space-y-2 text-sm">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-[11px] font-semibold text-indigo-200">{i + 1}</span>
            <span className="text-foreground/90">{s}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        Комиссии в расчёте результата: вход и стоп рыночными (0,05% + проскальзывание 0,03%), цель лимитным (0,02%).
      </p>
    </Section>
  );
}

function Outcome({ o }: { o: Detail }) {
  const now = Date.now();
  if (o.status === "open") {
    const live = o.live;
    return (
      <Section title="Сейчас" aside={<span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-200 ring-1 ring-sky-500/30">идёт</span>}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Цена" value={live ? price(live.price) : "—"} sub={live ? `${pctOf(live.price, o.entry)}% от входа` : undefined} />
          <Stat label="Если закрыть сейчас" value={<ResultValue o={o} />} sub="после комиссий" />
          <Stat label="До закрытия" value={o.closeBy > now ? relative(o.closeBy, now).replace("через ", "") : "время вышло"} sub={dateTime(o.closeBy) + " МСК"} />
        </div>
        {live && (
          <div className="mt-4 space-y-1.5">
            <ProgressTrack progress={live.progress} />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>стоп {price(o.sl)}</span>
              <span>вход</span>
              <span>цель {price(o.tp)}</span>
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Итог посчитается сам по свечам Binance, бот пришлёт его в Telegram.</p>
      </Section>
    );
  }
  return (
    <Section title="Итог">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Как закрылась" value={STATUS[o.status]} valueClass={o.status === "tp" ? "text-emerald-300" : o.status === "sl" ? "text-red-300" : undefined} />
        <Stat label="Выход" value={o.exitPrice != null ? price(o.exitPrice) : "—"} sub={o.closedAt ? `${dateTime(o.closedAt)} МСК` : undefined} />
        <Stat label="Результат" value={<ResultValue o={o} />} sub="после комиссий" />
      </div>
    </Section>
  );
}

function Why({ o }: { o: Detail }) {
  const d = o.details;
  if (o.kind === "news") {
    const n = d?.news;
    return (
      <Section title="Почему прислано">
        <p className="text-sm text-foreground/90">{n?.title ?? o.title}</p>
        {n?.reason && <p className="mt-2 text-sm text-muted-foreground">{n.reason}</p>}
        <dl className="mt-3">
          {n?.impactScore != null && <Row label="Сила новости">{n.impactScore}/100</Row>}
          {n?.expectedMovePct != null && <Row label="Ожидаемое движение">~{n.expectedMovePct}%</Row>}
          {n?.strength && <Row label="Сила · срочность">{`${n.strength} · ${n.urgency ?? "—"}`}</Row>}
          {n?.holdTime && <Row label="Держать">{n.holdTime}</Row>}
          {n?.source && <Row label="Источник">{n.source}</Row>}
        </dl>
        {n?.url && (
          <a href={n.url} target="_blank" rel="noreferrer noopener" className="mt-3 inline-flex items-center gap-1.5 text-sm text-indigo-300 hover:text-indigo-200">
            Открыть новость <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{KIND.news.about}</p>
      </Section>
    );
  }
  const dir = o.side === "LONG" ? "роста" : "падения";
  return (
    <Section title="Почему прислано">
      <dl>
        <Row label="Модель">{d?.modelTitle ?? o.title}</Row>
        {d?.pUp != null && <Row label={`Вероятность ${dir}`}>{pct(o.side === "LONG" ? d.pUp : 1 - d.pUp)}</Row>}
        {d?.confidentAccuracy != null && <Row label="Точность, когда уверена">{pct(d.confidentAccuracy)}</Row>}
        {d?.accuracy != null && <Row label="Точность направления в целом">{pct(d.accuracy)}</Row>}
        {d?.holdout && (
          <Row label="Проверка на новых данных">
            {`${d.holdout.trades} сделок, в плюс ${pct(d.holdout.winRate, 0)}, ${bpPct(d.holdout.avgNetBp)}`}
          </Row>
        )}
        {d?.coinVerdict && <Row label={`По ${o.symbol.replace(/USDT$/, "")}`}>{d.coinVerdict}</Row>}
      </dl>
      {!d && <p className="text-sm text-muted-foreground">Подробности модели для этой старой записи не сохранялись.</p>}
      <p className="mt-3 text-xs text-muted-foreground">{KIND[o.kind].about} Точность — на истории, которую модель не видела при обучении.</p>
    </Section>
  );
}

function Coin({ o }: { o: Detail }) {
  const m = o.coin.market;
  const g = o.coin.profile?.coingecko;
  const funding = m.fundingRate;
  return (
    <Section title={`Монета ${o.coin.base}`} aside={g ? <span className="truncate text-xs text-muted-foreground">{g.name}</span> : undefined}>
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Цена"
          value={m.price != null ? price(m.price) : "—"}
          sub={m.changePct24h != null ? <span className={tone(m.changePct24h)}>{signed(m.changePct24h)}% за 24 ч</span> : undefined}
        />
        <Stat label="Оборот 24 ч" value={usd(m.quoteVolume24h)} sub="фьючерсы Binance" />
      </div>
      <dl className="mt-3">
        {m.high24h != null && m.low24h != null && <Row label="Диапазон 24 ч">{`${price(m.low24h)} – ${price(m.high24h)}`}</Row>}
        {funding != null && (
          <Row label="Фандинг за 8 ч">
            <span className={tone(-funding)}>{`${(funding * 100).toFixed(4)}%`}</span>
            <span className="text-muted-foreground">{` · ${(funding * 3 * 365 * 100).toFixed(1)}% годовых`}</span>
          </Row>
        )}
        {m.openInterestUsd != null && <Row label="Открытый интерес">{usd(m.openInterestUsd)}</Row>}
        {g?.rank != null && <Row label="Место по капитализации">№{g.rank}</Row>}
        {g?.marketCap != null && <Row label="Капитализация">{usd(g.marketCap)}</Row>}
        {g?.fdv != null && <Row label="FDV">{usd(g.fdv)}</Row>}
        {g?.circulatingShare != null && <Row label="В обращении">{pct(g.circulatingShare, 0)} монет</Row>}
        {g?.categories?.length ? <Row label="Категории">{g.categories.join(", ")}</Row> : null}
      </dl>
      {funding != null && (
        <p className="mt-2 text-xs text-muted-foreground">
          Фандинг {funding >= 0 ? "положительный: лонги платят шортам" : "отрицательный: шорты платят лонгам"} каждые 8 часов.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <ExtLink href={`https://www.binance.com/ru/futures/${o.symbol}`}>Binance</ExtLink>
        <ExtLink href={`https://www.tradingview.com/chart/?symbol=BINANCE:${o.symbol}.P`}>TradingView</ExtLink>
        {g?.homepage && <ExtLink href={g.homepage}>Сайт проекта</ExtLink>}
      </div>
    </Section>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground ring-1 ring-white/10 hover:text-foreground"
    >
      {children} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function Record({ o }: { o: Detail }) {
  const r = o.similar.record;
  return (
    <Section title="Похожие сделки">
      <p className="text-xs text-muted-foreground">{o.similar.label}, закрытые</p>
      {r.closed ? (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Stat label="Закрыто" value={r.closed} />
          <Stat label="В плюс" value={`${Math.round((r.wins / r.closed) * 100)}%`} />
          <Stat label="В среднем" value={bpPct(r.avgNetBp)} valueClass={tone(r.avgNetBp)} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Пока ни одна не закрылась.</p>
      )}
      {o.sameCoin.length > 0 && (
        <>
          <p className="mt-4 text-xs text-muted-foreground">Другие возможности по {o.coin.base}</p>
          <ul className="mt-1">
            {o.sameCoin.slice(0, 8).map((x) => (
              <li key={x.id}>
                <Link href={`/opportunities/${x.id}`} className="flex items-center justify-between gap-2 border-b border-white/5 py-2 text-sm last:border-0 hover:text-indigo-200">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <KindBadge kind={x.kind} />
                    <SideBadge side={x.side} />
                    <span className="truncate text-xs text-muted-foreground">{dateTime(x.sentAt)}</span>
                  </span>
                  <span className="shrink-0 text-xs">{x.status === "open" ? "идёт" : <ResultValue o={x} />}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

export function OpportunityPage({ id }: { id: string }) {
  const [o, setO] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/opportunities/${id}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Не удалось загрузить карточку");
        setO(body as Detail);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <main className="relative flex min-h-[100dvh] flex-col">
      <div className="mesh-bg pointer-events-none absolute inset-0" />
      <div className="relative mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <Link href="/?tab=opportunities" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Все возможности
          </Link>
          <button type="button" onClick={load} className="rounded-lg p-2 text-muted-foreground ring-1 ring-white/10 hover:text-foreground" aria-label="Обновить">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>

        {error && !o && <p className="text-sm text-red-400">{error}</p>}
        {!o && !error && <p className="text-sm text-muted-foreground">Загрузка…</p>}

        {o && (
          <div className="space-y-4">
            <header className="card-premium rounded-2xl p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <KindBadge kind={o.kind} />
                <SideBadge side={o.side} />
                <span className="text-xs text-muted-foreground">
                  №{o.id} · {dateTime(o.sentAt)} МСК
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="font-display text-2xl font-semibold sm:text-3xl">
                    {o.side === "LONG" ? "Покупка" : "Продажа"} {o.coin.base}
                    <span className="ml-2 text-base font-normal text-muted-foreground">{o.timeframe}</span>
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {o.kind === "news" ? KIND.news.label : `${KIND[o.kind].label} · модель ${o.title}`}
                  </p>
                </div>
                <div className="sm:text-right">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{o.status === "open" ? "если закрыть сейчас" : STATUS[o.status]}</p>
                  <ResultValue o={o} className="font-display text-2xl" />
                </div>
              </div>
            </header>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="space-y-4 lg:col-span-7">
                <Section title="График">
                  <PriceChart
                    candles={o.chart.candles}
                    interval={o.chart.interval}
                    entry={o.entry}
                    tp={o.tp}
                    sl={o.sl}
                    entryTime={o.sentAt}
                    closeBy={o.closeBy}
                    closedAt={o.closedAt}
                    exitPrice={o.exitPrice}
                  />
                </Section>
                <Outcome o={o} />
                <Plan o={o} />
              </div>
              <div className="space-y-4 lg:col-span-5">
                <Why o={o} />
                <Coin o={o} />
                <Record o={o} />
              </div>
            </div>
            <p className="pb-2 text-center text-xs text-muted-foreground">Не является финансовой рекомендацией. Рискуйте только той суммой, которую готовы потерять.</p>
          </div>
        )}
      </div>
    </main>
  );
}

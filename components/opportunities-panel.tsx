"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
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
  tone,
  type Kind,
  type OpportunitySummary,
  type TrackRecord,
} from "@/components/opportunities/shared";

interface ListData {
  items: OpportunitySummary[];
  records: Record<Kind, TrackRecord>;
}

type StateFilter = "all" | "open" | "closed";

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors",
        active ? "bg-indigo-500/20 text-indigo-100 ring-indigo-400/40" : "text-muted-foreground ring-white/10 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function RecordTile({ kind, r }: { kind: Kind; r: TrackRecord }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/8">
      <div className="flex items-center justify-between gap-2">
        <KindBadge kind={kind} />
        <span className="text-[11px] text-muted-foreground">{r.closed ? `${r.closed} закрыто` : "итогов нет"}</span>
      </div>
      {r.closed > 0 ? (
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className={cn("text-lg font-semibold tabular-nums", tone(r.avgNetBp))}>{bpPct(r.avgNetBp)}</span>
          <span className="text-xs text-muted-foreground">в плюс {Math.round((r.wins / r.closed) * 100)}%</span>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">ещё не закрывались</p>
      )}
    </div>
  );
}

function OpportunityTile({ o }: { o: OpportunitySummary }) {
  const now = Date.now();
  return (
    <Link
      href={`/opportunities/${o.id}`}
      className="group flex flex-col gap-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/8 transition hover:bg-white/[0.05] hover:ring-indigo-400/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <KindBadge kind={o.kind} />
            <SideBadge side={o.side} />
            <span className="font-display text-base font-semibold">{o.symbol.replace(/USDT$/, "")}</span>
            <span className="text-xs text-muted-foreground">{o.timeframe}</span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{o.kind === "news" ? o.newsTitle ?? o.title : o.title}</p>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Вход</dt>
          <dd className="tabular-nums">{price(o.entry)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Цель</dt>
          <dd className="tabular-nums text-emerald-300">{pctOf(o.tp, o.entry)}%</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Стоп</dt>
          <dd className="tabular-nums text-red-300">{pctOf(o.sl, o.entry)}%</dd>
        </div>
      </dl>

      {o.status === "open" && o.live && <ProgressTrack progress={o.live.progress} />}

      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {o.status === "open" ? (o.closeBy > now ? `закрыть ${relative(o.closeBy, now)}` : "ждёт закрытия") : STATUS[o.status]}
        </span>
        <span className="flex items-baseline gap-1">
          <span className="text-muted-foreground">{o.status === "open" ? "сейчас" : "итог"}</span>
          <ResultValue o={o} />
        </span>
      </div>
      <p className="-mt-1 text-[11px] text-muted-foreground">{dateTime(o.sentAt)} МСК</p>
    </Link>
  );
}

export function OpportunitiesPanel() {
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<Kind | "all">("all");
  const [state, setState] = useState<StateFilter>("all");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/opportunities")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Не удалось загрузить возможности");
        setData(body as ListData);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    // Open trades move: refresh their live result every minute.
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const items = useMemo(
    () =>
      (data?.items ?? []).filter(
        (o) => (kind === "all" || o.kind === kind) && (state === "all" || (state === "open" ? o.status === "open" : o.status !== "open"))
      ),
    [data, kind, state]
  );

  if (error && !data) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Загрузка…</p>;

  const openCount = data.items.filter((o) => o.status === "open").length;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Всё, что бот присылал в Telegram: проверенные сигналы, шансы и новости. Нажмите на карточку — там план сделки, график, итог и
          всё о монете. Результаты — после комиссий и проскальзывания, в % от суммы позиции.
        </p>
        <button
          type="button"
          onClick={load}
          className="shrink-0 rounded-lg p-2 text-muted-foreground ring-1 ring-white/10 hover:text-foreground"
          aria-label="Обновить"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(["signal", "chance", "news"] as const).map((k) => (
          <RecordTile key={k} kind={k} r={data.records[k]} />
        ))}
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <Chip active={state === "all"} onClick={() => setState("all")}>
          Все
        </Chip>
        <Chip active={state === "open"} onClick={() => setState("open")}>
          Открытые{openCount ? ` · ${openCount}` : ""}
        </Chip>
        <Chip active={state === "closed"} onClick={() => setState("closed")}>
          Закрытые
        </Chip>
        <span className="mx-1 w-px shrink-0 bg-white/10" aria-hidden />
        <Chip active={kind === "all"} onClick={() => setKind("all")}>
          Все виды
        </Chip>
        {(["chance", "signal", "news"] as const).map((k) => (
          <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
            {KIND[k].short}
          </Chip>
        ))}
      </div>

      {items.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {items.map((o) => (
            <OpportunityTile key={o.id} o={o} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-white/[0.03] p-4 text-sm text-muted-foreground ring-1 ring-white/8">
          {data.items.length
            ? "Под выбранные фильтры ничего нет."
            : "Бот ещё ничего не присылал. Возможности появятся здесь, как только он пришлёт первый шанс, сигнал или новость. Монеты задаются боту командой /watch."}
        </p>
      )}
    </div>
  );
}

import { cn, formatPrice } from "@/lib/utils";

export type Kind = "signal" | "chance" | "news";
export type Status = "open" | "tp" | "sl" | "timeout";

export interface LiveState {
  price: number;
  netBp: number;
  progress: number;
}

export interface OpportunitySummary {
  id: number;
  kind: Kind;
  symbol: string;
  timeframe: string;
  title: string;
  side: "LONG" | "SHORT";
  entry: number;
  tp: number;
  sl: number;
  sentAt: number;
  closeBy: number;
  status: Status;
  exitPrice: number | null;
  netBp: number | null;
  closedAt: number | null;
  pUp: number | null;
  newsTitle: string | null;
  live: LiveState | null;
}

export interface TrackRecord {
  closed: number;
  wins: number;
  avgNetBp: number;
  sumNetPct: number;
}

export const KIND: Record<Kind, { label: string; short: string; className: string; about: string }> = {
  signal: {
    label: "Проверенный сигнал",
    short: "Сигнал",
    className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    about: "Настройка сделок прибыльна после комиссий на истории, которую модель не видела при подборе.",
  },
  chance: {
    label: "Шанс",
    short: "Шанс",
    className: "bg-indigo-500/15 text-indigo-200 ring-indigo-500/30",
    about: "Модель с подтверждённой точностью направления уверена. Прибыль после комиссий не подтверждена.",
  },
  news: {
    label: "Новость",
    short: "Новость",
    className: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
    about: "План сделки по сильной новости. Это оценка новости, а не проверенная стратегия.",
  },
};

export const STATUS: Record<Status, string> = { open: "открыта", tp: "цель достигнута", sl: "сработал стоп", timeout: "закрыта по времени" };

export const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
export const pctOf = (to: number, from: number) => signed(((to - from) / from) * 100);
export const bpPct = (bp: number) => `${signed(bp / 100)}%`;
export const price = (v: number) => formatPrice(v);

export const dateTime = (t: number) =>
  new Date(t).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

/** "через 2 ч 10 мин" / "5 мин назад" */
export function relative(t: number, now = Date.now()): string {
  const d = Math.abs(t - now);
  const m = Math.round(d / 60_000);
  const text = m < 60 ? `${m} мин` : m < 48 * 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ""}` : `${Math.round(m / 1440)} дн.`;
  return t > now ? `через ${text}` : `${text} назад`;
}

export const tone = (v: number | null | undefined) => (v == null || v === 0 ? undefined : v > 0 ? "text-emerald-400" : "text-red-400");

export function KindBadge({ kind, className }: { kind: Kind; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", KIND[kind].className, className)}>{KIND[kind].short}</span>;
}

export function SideBadge({ side }: { side: "LONG" | "SHORT" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-wide ring-1",
        side === "LONG" ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25" : "bg-red-500/10 text-red-300 ring-red-500/25"
      )}
    >
      {side}
    </span>
  );
}

/** Result after costs for a closed trade, or the live result if closed now. */
export function ResultValue({ o, className }: { o: Pick<OpportunitySummary, "status" | "netBp" | "live">; className?: string }) {
  const bp = o.status === "open" ? o.live?.netBp : o.netBp;
  if (bp == null) return <span className={cn("text-muted-foreground", className)}>—</span>;
  return <span className={cn("tabular-nums font-semibold", tone(bp), className)}>{bpPct(bp)}</span>;
}

/** Entry → target / stop as a bar with the current price marker (open trades only). */
export function ProgressTrack({ progress }: { progress: number }) {
  const pos = 50 + progress * 50;
  return (
    <div className="relative h-1.5 w-full rounded-full bg-white/5" aria-hidden>
      <div className="absolute inset-y-0 left-0 w-1/2 rounded-l-full bg-red-500/20" />
      <div className="absolute inset-y-0 right-0 w-1/2 rounded-r-full bg-emerald-500/20" />
      <div className="absolute inset-y-[-3px] left-1/2 w-px bg-white/40" />
      <div
        className={cn("absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#0d0d14]", progress >= 0 ? "bg-emerald-400" : "bg-red-400")}
        style={{ left: `${Math.max(2, Math.min(98, pos))}%` }}
      />
    </div>
  );
}

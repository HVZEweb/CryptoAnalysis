"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Crown, Loader2, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Not signed in: the dialog offers to register first */
  onNeedAuth?: () => void;
  /** After a payment is confirmed (refresh quota and the page) */
  onPaid?: () => void;
}

interface Billing {
  configured: boolean;
  priceUsdt: number | null;
  periodDays: number | null;
  isLoggedIn: boolean;
  paid: boolean;
  paidUntil: number | null;
  permanent: boolean;
}

interface Invoice {
  id: string;
  address: string;
  amount: string;
  days: number;
  status: "pending" | "paid" | "expired";
  expiresAt: number;
  qr: string;
}

const FEATURES = [
  "Безлимитные прогнозы по любой монете и таймфрейму",
  "Раздел «Возможности»: идущие сделки с планом, уровнями и графиком",
  "История всех сделок с реальными итогами после комиссий",
];

const day = (t: number) => new Date(t).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-left ring-1 ring-white/10 hover:bg-white/10"
      >
        <span className={mono ? "break-all font-mono text-xs" : "text-lg font-semibold tabular-nums"}>{value}</span>
        {copied ? <Check className="h-4 w-4 shrink-0 text-emerald-400" /> : <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
    </div>
  );
}

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, until - now);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return <span className="tabular-nums">{`${m}:${String(s).padStart(2, "0")}`}</span>;
}

export function UpgradeDialog({ open, onOpenChange, onNeedAuth, onPaid }: UpgradeDialogProps) {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [paidUntil, setPaidUntil] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPaidUntil(null);
    fetch("/api/billing")
      .then((r) => r.json())
      .then((b: Billing) => setBilling(b))
      .catch(() => setError("Не удалось загрузить условия подписки"));
  }, [open]);

  const createInvoice = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/billing/invoice", { method: "POST" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Не удалось создать счёт");
      setInvoice(body as Invoice);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  // While the window is open, ask every 10 s whether the transfer has arrived.
  useEffect(() => {
    if (!open || !invoice || invoice.status === "paid") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/billing/invoice/${invoice.id}`).catch(() => null);
      if (!r?.ok) return;
      const s = (await r.json()) as { status: Invoice["status"]; paidUntil: number | null };
      if (s.status !== invoice.status) setInvoice({ ...invoice, status: s.status });
      if (s.status === "paid") {
        setPaidUntil(s.paidUntil);
        onPaid?.();
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [open, invoice, onPaid]);

  const price = billing?.priceUsdt ?? 9;
  const days = billing?.periodDays ?? 30;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-400" />
            Подписка
          </DialogTitle>
          <DialogDescription>
            {billing?.paid && billing.paidUntil && !billing.permanent
              ? `Подписка активна до ${day(billing.paidUntil)}. Оплата продлит её ещё на ${days} дней.`
              : billing?.permanent
                ? "У вас бессрочный доступ."
                : `${price} USDT за ${days} дней. Оплата в USDT (сеть TRON, TRC20).`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 pb-6">
          {invoice?.status === "paid" ? (
            <div className="rounded-2xl bg-emerald-500/10 p-4 text-sm text-emerald-200 ring-1 ring-emerald-500/30">
              <p className="flex items-center gap-2 font-medium">
                <Check className="h-4 w-4" /> Оплата получена
              </p>
              <p className="mt-1">{paidUntil ? `Подписка действует до ${day(paidUntil)}.` : "Подписка активирована."}</p>
            </div>
          ) : invoice ? (
            <>
              <div className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200 ring-1 ring-amber-500/30">
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" /> Переведите ровно {invoice.amount} USDT в сети TRON (TRC20)
                </p>
                <p className="mt-1 text-amber-200/80">
                  По точной сумме сайт узнаёт ваш платёж. Если биржа удерживает комиссию из суммы, укажите к получению ровно {invoice.amount}. Другие
                  сети (ERC20, BEP20) не подходят — деньги не дойдут.
                </p>
              </div>
              <CopyField label="Сумма, USDT" value={invoice.amount} />
              <CopyField label="Адрес кошелька (TRC20)" value={invoice.address} mono />
              <div className="flex items-center gap-4">
                <div className="h-32 w-32 shrink-0 overflow-hidden rounded-xl bg-white p-1" dangerouslySetInnerHTML={{ __html: invoice.qr }} aria-label="QR-код адреса" />
                <div className="text-xs text-muted-foreground">
                  {invoice.status === "expired" ? (
                    <p className="text-red-300">Счёт истёк. Если вы уже перевели, оплата всё равно засчитается в течение суток; иначе создайте новый.</p>
                  ) : (
                    <>
                      <p className="flex items-center gap-1.5 text-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Ждём перевод
                      </p>
                      <p className="mt-1">
                        Счёт действует ещё <Countdown until={invoice.expiresAt} />. Зачисление — через 1–3 минуты после перевода, окно можно не
                        закрывать.
                      </p>
                    </>
                  )}
                </div>
              </div>
              {invoice.status === "expired" && (
                <Button className="w-full rounded-xl" onClick={createInvoice} disabled={busy}>
                  Новый счёт
                </Button>
              )}
            </>
          ) : (
            <>
              <div className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10">
                <p className="font-display text-2xl font-bold">
                  {price} USDT<span className="text-sm font-normal text-muted-foreground"> / {days} дней</span>
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                  {FEATURES.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
              {billing && !billing.configured ? (
                <Button className="w-full rounded-xl" disabled>
                  Оплата скоро будет доступна
                </Button>
              ) : billing && !billing.isLoggedIn ? (
                <Button
                  className="w-full rounded-xl"
                  onClick={() => {
                    onOpenChange(false);
                    onNeedAuth?.();
                  }}
                >
                  Зарегистрироваться и оформить
                </Button>
              ) : (
                <Button className="w-full rounded-xl" onClick={createInvoice} disabled={busy || !billing || billing.permanent}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {billing?.paid ? "Продлить" : "Оплатить"} {price} USDT
                </Button>
              )}
              <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                Это аналитический инструмент, а не инвестиционная рекомендация. Прибыль не гарантируется: наши же сделки после комиссий бывают в
                минусе, их реальные итоги открыты в разделе «Возможности».
              </p>
            </>
          )}
          {error && <p className="text-center text-sm text-red-400">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

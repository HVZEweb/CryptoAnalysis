"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Status {
  connected: boolean;
  source: "env" | "admin" | null;
  profitableTimeframes: string[];
  lastScanAt: string | null;
  lastSignalAt: string | null;
  openSignals: string[];
}

const inputClass = "min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10";

export function TelegramSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/telegram");
    if (res.ok) setStatus((await res.json()) as Status);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: string) => {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token }),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    setMessage({ ok: res.ok, text: data.message ?? data.error ?? "Ошибка" });
    if (res.ok && action === "connect") setToken("");
    setBusy(false);
    await load();
  };

  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ru-RU") : "—");

  return (
    <section className="space-y-3 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/8">
      <div>
        <h2 className="font-semibold">Сигналы в Telegram</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Сервер каждые 5 минут прогоняет модели по свежим свечам и присылает сделку, только если её настройка принесла
          прибыль после комиссий на истории, которую не видела при подборе.
        </p>
      </div>

      {status?.connected ? (
        <div className="space-y-2 text-sm">
          <p className="text-emerald-400">Бот подключён{status.source === "env" ? " (через настройки сервера)" : ""}.</p>
          <p className="text-muted-foreground">
            Стратегии, прошедшие проверку:{" "}
            {status.profitableTimeframes.length ? status.profitableTimeframes.join(", ") : "пока ни одной — сигналов не будет"}
            {" · "}последняя проверка: {time(status.lastScanAt)} · последний сигнал: {time(status.lastSignalAt)}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => act("test")}>
              Прислать проверочное сообщение
            </Button>
            {status.source === "admin" && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("disconnect")}>
                Отключить
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>
              В Telegram откройте <b>@BotFather</b>, отправьте <code>/newbot</code>, придумайте имя — он пришлёт токен.
            </li>
            <li>Откройте своего нового бота и нажмите «Start».</li>
            <li>Вставьте токен сюда и нажмите «Подключить».</li>
          </ol>
          <div className="flex gap-2">
            <input
              className={inputClass}
              placeholder="123456789:AAE…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
            <Button size="sm" disabled={busy || !token.trim()} onClick={() => act("connect")}>
              Подключить
            </Button>
          </div>
        </div>
      )}
      {message && <p className={message.ok ? "text-sm text-emerald-400" : "text-sm text-red-400"}>{message.text}</p>}
    </section>
  );
}

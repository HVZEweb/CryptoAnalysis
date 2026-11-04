"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Crown, KeyRound, Loader2, LogOut, Mail, Monitor, ShieldCheck, ShieldOff } from "lucide-react";
import { BrandMark } from "@/components/hero";
import { PasswordInput, inputClass } from "@/components/auth-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Account {
  user: {
    email: string;
    role: "user" | "admin";
    emailVerified: boolean;
    twoFactor: boolean;
    createdAt: string;
    paid: boolean;
    paidUntil: number | null;
    permanent: boolean;
    recoveryCodesLeft: number;
  };
  mail: boolean;
  sessions: Array<{ id: string; current: boolean; device: string; ip: string | null; createdAt: number; lastSeenAt: number }>;
  events: Array<{ type: string; at: number; ip: string | null; device: string }>;
}

const EVENT_LABEL: Record<string, string> = {
  login: "Вход",
  login_failed: "Неверный пароль",
  login_2fa_failed: "Неверный код второго шага",
  logout: "Выход",
  register: "Регистрация",
  password_changed: "Пароль изменён",
  password_reset: "Пароль сброшен по ссылке",
  reset_requested: "Запрошен сброс пароля",
  email_verified: "Email подтверждён",
  "2fa_enabled": "Включён двухэтапный вход",
  "2fa_disabled": "Отключён двухэтапный вход",
  recovery_code_used: "Вход по коду восстановления",
  sessions_revoked: "Завершены сеансы на других устройствах",
};
const ALERT_EVENTS = new Set(["login_failed", "login_2fa_failed", "recovery_code_used"]);

const when = (t: number) => new Date(t).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

async function post(url: string, body: object): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Не удалось выполнить");
  return data;
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Status({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (ok) return <p className="text-sm text-emerald-400">{ok}</p>;
  return null;
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-100 ring-1 ring-amber-500/30">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Сохраните коды восстановления — в менеджер паролей или на бумаге. Каждый срабатывает один раз, если телефона нет под рукой. Больше мы
        их не покажем.
      </p>
      <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-black/30 p-3 font-mono text-sm">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Скопировать
        </Button>
        <Button type="button" size="sm" variant="secondary" asChild>
          <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(`CryptoPredict — коды восстановления\n\n${text}\n`)}`} download="cryptopredict-recovery-codes.txt">
            Скачать .txt
          </a>
        </Button>
        <Button type="button" size="sm" onClick={onDone}>
          Я сохранил
        </Button>
      </div>
    </div>
  );
}

function TwoFactor({ account, reload }: { account: Account; reload: () => Promise<void> }) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [action, setAction] = useState<"disable" | "recovery-codes" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          setCodes(null);
          void reload();
        }}
      />
    );
  }

  if (account.user.twoFactor) {
    return (
      <div className="space-y-3 text-sm">
        <p className="flex items-center gap-2 text-emerald-300">
          <ShieldCheck className="h-4 w-4" /> Включён: после пароля сайт спросит код из приложения.
        </p>
        <p className="text-xs text-muted-foreground">
          Осталось кодов восстановления: {account.user.recoveryCodesLeft}
          {account.user.recoveryCodesLeft <= 3 && " — стоит получить новые"}.
        </p>
        {action ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const data = await post("/api/account/2fa", { action, password, code });
                setPassword("");
                setCode("");
                setAction(null);
                if (Array.isArray(data.recoveryCodes)) setCodes(data.recoveryCodes as string[]);
                else await reload();
              });
            }}
            className="space-y-2"
          >
            <PasswordInput id="tfa-password" value={password} onChange={setPassword} autoComplete="current-password" placeholder="Пароль" />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Код из приложения или код восстановления"
              autoComplete="one-time-code"
              required
              className={inputClass}
            />
            <Status error={error} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant={action === "disable" ? "destructive" : "default"} disabled={busy}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {action === "disable" ? "Отключить" : "Получить новые коды"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAction(null)}>
                Отмена
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAction("recovery-codes")}>
              Новые коды восстановления
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAction("disable")}>
              <ShieldOff className="h-3.5 w-3.5" /> Отключить
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (setup) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const data = await post("/api/account/2fa", { action: "enable", code });
            setSetup(null);
            setCode("");
            setCodes(data.recoveryCodes as string[]);
          });
        }}
        className="space-y-3 text-sm"
      >
        <p className="text-muted-foreground">
          1. Отсканируйте QR-код приложением-аутентификатором (Google Authenticator, Яндекс Ключ, Aegis, 1Password).
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="h-40 w-40 shrink-0 overflow-hidden rounded-xl bg-white p-1.5" dangerouslySetInnerHTML={{ __html: setup.qr }} aria-label="QR-код" />
          <div className="min-w-0 text-xs text-muted-foreground">
            <p>Не сканируется? Введите ключ вручную:</p>
            <p className="mt-1 break-all font-mono text-foreground">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</p>
          </div>
        </div>
        <p className="text-muted-foreground">2. Введите 6-значный код, который показывает приложение.</p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          maxLength={7}
          required
          className={cn(inputClass, "max-w-[180px] text-center font-mono tracking-[0.3em]")}
        />
        <Status error={error} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy || code.replace(/\s/g, "").length !== 6}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Включить
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSetup(null)}>
            Отмена
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Выключен. С ним для входа нужен ещё код из приложения на телефоне — украденного пароля станет недостаточно.
        {account.user.role === "admin" && <span className="text-amber-300"> Администратору включить обязательно.</span>}
      </p>
      <Status error={error} />
      <Button
        size="sm"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const data = await post("/api/account/2fa", { action: "setup" });
            setSetup({ secret: String(data.secret), qr: String(data.qr) });
          })
        }
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Включить двухэтапный вход
      </Button>
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setOk("");
        if (next !== repeat) return setError("Новые пароли не совпадают");
        setBusy(true);
        try {
          await post("/api/account/password", { current, password: next });
          setCurrent("");
          setNext("");
          setRepeat("");
          setOk("Пароль изменён. Другие устройства вышли из аккаунта.");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
      className="grid gap-3 sm:grid-cols-3"
    >
      {/* Lets password managers attach the new password to the right account. */}
      <input type="text" autoComplete="username" className="hidden" readOnly tabIndex={-1} aria-hidden />
      <div className="space-y-1.5">
        <Label htmlFor="pw-current">Текущий</Label>
        <PasswordInput id="pw-current" value={current} onChange={setCurrent} autoComplete="current-password" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw-new">Новый</Label>
        <PasswordInput id="pw-new" value={next} onChange={setNext} autoComplete="new-password" placeholder="От 8 символов" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw-repeat">Новый ещё раз</Label>
        <PasswordInput id="pw-repeat" value={repeat} onChange={setRepeat} autoComplete="new-password" />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <Button type="submit" size="sm" disabled={busy || !current || next.length < 8 || !repeat}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Сменить пароль
        </Button>
        <Status error={error} ok={ok} />
      </div>
    </form>
  );
}

export default function AccountPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [notice, setNotice] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/account", { cache: "no-store" });
    if (res.status === 401) {
      window.location.href = "/login?next=/account";
      return;
    }
    if (res.ok) setAccount((await res.json()) as Account);
    else setNotice({ error: "Не удалось загрузить аккаунт, обновите страницу" });
  }, []);

  useEffect(() => {
    void load();
    const p = new URLSearchParams(window.location.search);
    if (p.get("verified") === "1") setNotice({ ok: "Email подтверждён." });
    else if (p.get("verified") === "0") setNotice({ error: "Ссылка подтверждения устарела или уже использована. Отправьте письмо ещё раз." });
    else if (p.get("welcome") === "1") setNotice({ ok: "Аккаунт создан. Добро пожаловать!" });
    if (p.toString()) window.history.replaceState(null, "", "/account");
  }, [load]);

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setNotice({});
    try {
      setNotice({ ok: await fn() });
      await load();
    } catch (e) {
      setNotice({ error: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/";
  };

  if (!account) {
    return (
      <main className="flex min-h-[60dvh] items-center justify-center text-muted-foreground">
        {notice.error ? <p className="text-sm text-red-400">{notice.error}</p> : <Loader2 className="h-5 w-5 animate-spin" />}
      </main>
    );
  }

  const { user } = account;
  const others = account.sessions.filter((s) => !s.current);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <BrandMark className="h-6 w-6" />
          ← На сайт
        </Link>
        <Button size="sm" variant="ghost" onClick={logout}>
          <LogOut className="h-3.5 w-3.5" /> Выйти
        </Button>
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Аккаунт</h1>
        <p className="mt-1 break-all text-sm text-muted-foreground">
          {user.email}
          {user.role === "admin" && <span className="ml-2 rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">админ</span>} · с{" "}
          {new Date(user.createdAt).toLocaleDateString("ru-RU")}
        </p>
      </div>

      <Status error={notice.error} ok={notice.ok} />

      <Section title="Email" icon={<Mail className="h-4 w-4 text-indigo-300" />}>
        {user.emailVerified ? (
          <p className="flex items-center gap-2 text-sm text-emerald-300">
            <Check className="h-4 w-4" /> Подтверждён — по нему можно восстановить пароль.
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-amber-200">Не подтверждён. Без этого восстановить пароль по почте не выйдет, если вы ошиблись в адресе.</p>
            {account.mail ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy === "verify"}
                onClick={() =>
                  act("verify", async () => {
                    await post("/api/account/verify-email", {});
                    return `Письмо отправлено на ${user.email}. Проверьте и папку «Спам».`;
                  })
                }
              >
                {busy === "verify" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Отправить письмо ещё раз
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Отправка писем на сайте пока не подключена.</p>
            )}
          </div>
        )}
      </Section>

      <Section title="Подписка" icon={<Crown className="h-4 w-4 text-amber-400" />}>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            {user.permanent
              ? "Бессрочный доступ."
              : user.paid && user.paidUntil
                ? `Активна до ${new Date(user.paidUntil).toLocaleDateString("ru-RU")}.`
                : user.paidUntil
                  ? `Закончилась ${new Date(user.paidUntil).toLocaleDateString("ru-RU")}.`
                  : "Не оформлена: доступны бесплатные прогнозы."}
          </p>
          {!user.permanent && (
            <Button size="sm" asChild>
              <Link href="/?upgrade=1">{user.paid ? "Продлить" : "Оформить"}</Link>
            </Button>
          )}
        </div>
      </Section>

      <Section title="Пароль" icon={<KeyRound className="h-4 w-4 text-indigo-300" />}>
        <ChangePassword />
      </Section>

      <Section title="Двухэтапный вход" icon={<ShieldCheck className="h-4 w-4 text-indigo-300" />}>
        <TwoFactor account={account} reload={load} />
      </Section>

      <Section title="Устройства" icon={<Monitor className="h-4 w-4 text-indigo-300" />}>
        <ul className="divide-y divide-white/5 text-sm">
          {account.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="font-medium">
                  {s.device}
                  {s.current && <span className="ml-2 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">это устройство</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {s.ip ?? "адрес неизвестен"} · вход {when(s.createdAt)} · активность {when(s.lastSeenAt)}
                </p>
              </div>
              {!s.current && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === s.id}
                  onClick={() =>
                    act(s.id, async () => {
                      await post("/api/account/sessions", { action: "revoke", id: s.id });
                      return `${s.device}: вышли из аккаунта`;
                    })
                  }
                >
                  Выйти
                </Button>
              )}
            </li>
          ))}
        </ul>
        {others.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            disabled={busy === "others"}
            onClick={() =>
              act("others", async () => {
                await post("/api/account/sessions", { action: "revoke-others" });
                return "Все другие устройства вышли из аккаунта";
              })
            }
          >
            Выйти на всех других устройствах
          </Button>
        )}
      </Section>

      <Section title="Недавние действия" icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}>
        {account.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Пока ничего.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {account.events.map((e, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-3">
                <span className={ALERT_EVENTS.has(e.type) ? "text-amber-300" : ""}>{EVENT_LABEL[e.type] ?? e.type}</span>
                <span className="text-xs text-muted-foreground">
                  {when(e.at)} · {e.device}
                  {e.ip ? ` · ${e.ip}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Видите вход, который делали не вы? Смените пароль и нажмите «Выйти на всех других устройствах».
        </p>
      </Section>
    </main>
  );
}

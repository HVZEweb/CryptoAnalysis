"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Eye, EyeOff, KeyRound, Loader2, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type AuthMode = "login" | "register" | "forgot" | "twofa";

interface SignupStatus {
  open: boolean;
  firstAccount: boolean;
  mail: boolean;
}

interface AuthFormProps {
  initialMode?: "login" | "register";
  /** Called after a successful sign-in or signup (the session cookie is already set) */
  onSuccess: (result: { registered: boolean; verificationSent?: boolean }) => void;
  /** Report the current step, so a dialog can change its title */
  onModeChange?: (mode: AuthMode) => void;
}

export const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-500/30";

async function post(url: string, body: object): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Что-то пошло не так, попробуйте ещё раз");
  return data;
}

/** The same password rules the server checks (lib/password.ts), shown while typing. */
function passwordHints(password: string, email: string) {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return [
    { ok: password.length >= 8, text: "не короче 8 символов" },
    { ok: !(local.length >= 4 && password.toLowerCase().includes(local)), text: "без имени из email" },
  ];
}

export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={128}
        required
        className={cn(inputClass, "pr-10")}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label={shown ? "Скрыть пароль" : "Показать пароль"}
        tabIndex={-1}
      >
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function AuthForm({ initialMode = "login", onSuccess, onModeChange }: AuthFormProps) {
  const [mode, setModeState] = useState<AuthMode>(initialMode);
  const [status, setStatus] = useState<SignupStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const setMode = (m: AuthMode) => {
    setModeState(m);
    setError("");
    setInfo("");
  };

  // Every step change (also the first one and the switch to signup for the very first account) is reported.
  const modeChange = useRef(onModeChange);
  modeChange.current = onModeChange;
  useEffect(() => {
    modeChange.current?.(mode);
  }, [mode]);

  useEffect(() => {
    fetch("/api/auth/signup-status")
      .then((r) => r.json())
      .then((d: SignupStatus) => {
        setStatus(d);
        if (d.firstAccount) setModeState("register");
        else if (!d.open && initialMode === "register") setModeState("login");
      })
      .catch(() => undefined);
  }, [initialMode]);

  useEffect(() => {
    if (mode === "twofa") codeRef.current?.focus();
  }, [mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      if (mode === "login") {
        const data = await post("/api/auth/login", { email, password });
        if (data.twoFactor) {
          setChallenge(String(data.challenge));
          setCode("");
          setMode("twofa");
          return;
        }
        onSuccess({ registered: false });
      } else if (mode === "twofa") {
        await post("/api/auth/login/2fa", { challenge, code });
        onSuccess({ registered: false });
      } else if (mode === "register") {
        const data = await post("/api/auth/register", { email, password });
        onSuccess({ registered: true, verificationSent: Boolean(data.verificationSent) });
      } else {
        const data = await post("/api/auth/forgot-password", { email });
        setInfo(String(data.message ?? ""));
        if (typeof data.devResetUrl === "string") setInfo(`Ссылка (режим разработки): ${data.devResetUrl}`);
      }
    } catch (err) {
      const message = (err as Error).message;
      // The second-step challenge expired or ran out of attempts: back to the password.
      if (mode === "twofa" && /заново/.test(message)) {
        setMode("login");
        setPassword("");
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const signupOpen = status?.open ?? false;

  if (mode === "twofa") {
    return (
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl bg-indigo-500/10 p-3 text-sm text-indigo-100 ring-1 ring-indigo-500/20">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Введите 6-значный код из приложения-аутентификатора. Если телефона нет под рукой — один из кодов восстановления.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="auth-code">Код</Label>
          <input
            ref={codeRef}
            id="auth-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="text"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={32}
            required
            className={cn(inputClass, "text-center font-mono text-lg tracking-[0.3em]")}
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" className="w-full rounded-xl" disabled={loading || code.trim().length < 6}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Войти
        </Button>
        <button type="button" onClick={() => setMode("login")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Назад
        </button>
      </form>
    );
  }

  if (mode === "forgot") {
    return (
      <form onSubmit={submit} className="space-y-4">
        {status && !status.mail ? (
          <p className="rounded-xl bg-white/5 p-3 text-sm text-muted-foreground ring-1 ring-white/10">
            Восстановление по почте пока не подключено. Напишите администратору сайта — он задаст вам новый пароль.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Введите email аккаунта — пришлём ссылку, по которой можно задать новый пароль.</p>
            <div className="space-y-2">
              <Label htmlFor="auth-email">Email</Label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                maxLength={254}
                required
                className={inputClass}
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            {info && <p className="break-words text-sm text-emerald-400">{info}</p>}
            <Button type="submit" className="w-full rounded-xl" disabled={loading || !!info}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Отправить ссылку
            </Button>
          </>
        )}
        <button type="button" onClick={() => setMode("login")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Ко входу
        </button>
      </form>
    );
  }

  const register = mode === "register";
  const hints = passwordHints(password, email);

  return (
    <form onSubmit={submit} className="space-y-4">
      {(signupOpen || register) && !status?.firstAccount && (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1 text-sm">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-lg py-1.5 font-medium transition-colors",
                mode === m ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m === "login" ? "Вход" : "Регистрация"}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="auth-email">Email</Label>
        <input
          id="auth-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete={register ? "email" : "username"}
          maxLength={254}
          required
          className={inputClass}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="auth-password">Пароль</Label>
          {!register && (
            <button type="button" onClick={() => setMode("forgot")} className="text-xs text-indigo-300 hover:text-indigo-200">
              Забыли пароль?
            </button>
          )}
        </div>
        <PasswordInput id="auth-password" value={password} onChange={setPassword} autoComplete={register ? "new-password" : "current-password"} />
        {register && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            {hints.map((h) => (
              <li key={h.text} className={h.ok ? "text-emerald-400" : "text-muted-foreground"}>
                {h.ok ? "✓" : "•"} {h.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button type="submit" className="w-full rounded-xl" disabled={loading || (register && password.length < 8)}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : register ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
        {register ? "Создать аккаунт" : "Войти"}
      </Button>

      {register ? (
        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          Создавая аккаунт, вы принимаете{" "}
          <a href="/terms" target="_blank" className="underline underline-offset-2 hover:text-foreground">
            условия и риски
          </a>
          .
        </p>
      ) : (
        status &&
        !signupOpen && <p className="text-center text-xs text-muted-foreground">Нет аккаунта? Его создаёт администратор сайта.</p>
      )}
    </form>
  );
}

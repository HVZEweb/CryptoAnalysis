"use client";

import { useEffect, useState } from "react";
import { LogIn, Sparkles, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Only same-site paths are allowed as a post-login target. */
function safeNext(): string {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next") ?? "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [signupOpen, setSignupOpen] = useState(false);
  const [firstAccount, setFirstAccount] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/signup-status")
      .then((r) => r.json())
      .then((d: { open: boolean; private: boolean; firstAccount?: boolean }) => {
        setSignupOpen(d.open);
        setFirstAccount(Boolean(d.firstAccount));
        if (d.firstAccount) setMode("register");
      })
      .catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Не удалось войти");
        return;
      }
      window.location.href = safeNext();
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center p-4">
      <div className="mesh-bg pointer-events-none absolute inset-0" />
      <form onSubmit={submit} className="glass relative w-full max-w-sm space-y-4 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold">AI Crypto Predictor</h1>
            <p className="text-xs text-muted-foreground">
              {firstAccount
                ? "Создайте первый аккаунт — он станет администратором"
                : mode === "login"
                  ? "Войдите, чтобы продолжить"
                  : "Регистрация"}
            </p>
          </div>
        </div>

        {signupOpen && !firstAccount && (
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1 text-sm">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn("rounded-lg py-1.5", mode === m ? "bg-white/10 font-medium" : "text-muted-foreground")}
              >
                {m === "login" ? "Вход" : "Регистрация"}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Пароль</Label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button type="submit" className="w-full" disabled={loading}>
          {mode === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
          {mode === "login" ? "Войти" : "Создать аккаунт"}
        </Button>

        {!signupOpen && (
          <p className="text-center text-xs text-muted-foreground">
            Нет аккаунта? Его создаёт администратор сайта.
          </p>
        )}
        <p className="text-center text-xs text-muted-foreground">Забыли пароль? Новый задаст администратор.</p>
      </form>
    </main>
  );
}

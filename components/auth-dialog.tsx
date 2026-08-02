"use client";

import { useEffect, useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string) => Promise<void>;
  defaultTab?: "login" | "register";
}

export function AuthDialog({
  open,
  onOpenChange,
  onLogin,
  onRegister,
  defaultTab = "register",
}: AuthDialogProps) {
  const [tab, setTab] = useState<"login" | "register" | "forgot">(defaultTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setTab(defaultTab);
      setError("");
      setInfo("");
    }
  }, [open, defaultTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      if (tab === "forgot") {
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Ошибка");
        if (data.devResetUrl) {
          setInfo(`Ссылка для сброса (dev): ${data.devResetUrl}`);
        } else {
          setInfo("Если email зарегистрирован, инструкции отправлены.");
        }
        return;
      }
      if (tab === "register") await onRegister(email, password);
      else await onLogin(email, password);
      onOpenChange(false);
      setEmail("");
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {tab === "register" ? "Регистрация" : tab === "forgot" ? "Сброс пароля" : "Вход"}
          </DialogTitle>
          <DialogDescription>
            {tab === "register"
              ? "Зарегистрируйтесь и получите ещё 2 бесплатных прогноза (всего 3)."
              : tab === "forgot"
                ? "Введите email — мы отправим ссылку для сброса пароля."
                : "Войдите, чтобы использовать оставшиеся бесплатные прогнозы."}
          </DialogDescription>
        </DialogHeader>

        {tab !== "forgot" && (
          <div className="flex gap-1 px-6">
            {(["register", "login"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "flex-1 rounded-lg py-2 text-sm font-medium transition-colors",
                  tab === t ? "bg-indigo-500/20 text-indigo-200" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t === "register" ? "Регистрация" : "Вход"}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 px-6 pb-6">
          <div className="space-y-2">
            <Label htmlFor="auth-email">Email</Label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40"
              required
            />
          </div>
          {tab !== "forgot" && (
            <div className="space-y-2">
              <Label htmlFor="auth-password">Пароль</Label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40"
                required
              />
            </div>
          )}
          {tab === "login" && (
            <button
              type="button"
              className="text-xs text-indigo-300 hover:text-indigo-200"
              onClick={() => {
                setTab("forgot");
                setError("");
                setInfo("");
              }}
            >
              Забыли пароль?
            </button>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {info && <p className="text-sm text-emerald-400 break-all">{info}</p>}
          <Button type="submit" className="w-full rounded-xl" disabled={loading}>
            {tab === "register" ? (
              <>
                <UserPlus className="h-4 w-4" /> Зарегистрироваться
              </>
            ) : tab === "forgot" ? (
              "Отправить ссылку"
            ) : (
              <>
                <LogIn className="h-4 w-4" /> Войти
              </>
            )}
          </Button>
          {tab === "forgot" && (
            <Button type="button" variant="ghost" className="w-full rounded-xl" onClick={() => setTab("login")}>
              Назад ко входу
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

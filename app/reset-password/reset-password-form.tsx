"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { BrandMark } from "@/components/hero";
import { PasswordInput } from "@/components/auth-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== repeat) return setError("Пароли не совпадают");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не удалось сохранить пароль");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center p-4">
      <div className="mesh-bg pointer-events-none absolute inset-0" />
      <div className="card-premium relative w-full max-w-sm space-y-5 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <BrandMark className="h-10 w-10" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Новый пароль</h1>
            <p className="text-xs text-muted-foreground">CryptoPredict</p>
          </div>
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200 ring-1 ring-emerald-500/30">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              Пароль изменён. Все устройства вышли из аккаунта — войдите с новым паролем.
            </p>
            <Button asChild className="w-full rounded-xl">
              <Link href="/login">Войти</Link>
            </Button>
          </div>
        ) : !token ? (
          <p className="text-sm text-muted-foreground">
            В ссылке нет кода. Откройте ссылку из письма целиком или{" "}
            <Link href="/login" className="text-indigo-300 underline underline-offset-2">
              запросите новую
            </Link>
            .
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">Новый пароль</Label>
              <PasswordInput id="new-password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="Не короче 8 символов" autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="repeat-password">Ещё раз</Label>
              <PasswordInput id="repeat-password" value={repeat} onChange={setRepeat} autoComplete="new-password" />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" className="w-full rounded-xl" disabled={loading || password.length < 8 || !repeat}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} Сохранить пароль
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}

"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const submit = async () => {
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();
    setMessage(res.ok ? "Пароль обновлён. Можно войти." : data.error ?? "Ошибка");
  };

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center p-6">
      <h1 className="font-display text-xl font-bold">Новый пароль</h1>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={8}
        placeholder="Минимум 8 символов"
        className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2"
      />
      <Button className="mt-4 rounded-xl" onClick={submit} disabled={!token || password.length < 8}>
        Сохранить
      </Button>
      {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </main>
  );
}

"use client";

import { useState } from "react";
import { BrandMark } from "@/components/hero";
import { AuthForm, type AuthMode } from "@/components/auth-form";

/** Only same-site paths are allowed as a post-login target. */
function safeNext(): string {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next") ?? "/";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

const SUBTITLE: Record<AuthMode, string> = {
  login: "Войдите, чтобы продолжить",
  register: "Новый аккаунт",
  forgot: "Восстановление пароля",
  twofa: "Подтверждение входа",
};

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>("login");

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center p-4">
      <div className="mesh-bg pointer-events-none absolute inset-0" />
      <div className="card-premium relative w-full max-w-sm space-y-5 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <BrandMark className="h-10 w-10" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">CryptoPredict</h1>
            <p className="text-xs text-muted-foreground">{SUBTITLE[mode]}</p>
          </div>
        </div>

        <AuthForm
          onModeChange={setMode}
          onSuccess={({ registered }) => {
            // A full load, so pages checked on the server see the new session.
            window.location.href = registered ? "/account?welcome=1" : safeNext();
          }}
        />

        <p className="text-center text-xs text-muted-foreground">
          <a href="/terms" className="underline underline-offset-2 hover:text-foreground">
            Условия и риски
          </a>
        </p>
      </div>
    </main>
  );
}

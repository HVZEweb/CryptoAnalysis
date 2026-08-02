"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuthUser, QuotaStatus } from "@/types";

export function useAccount() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = (await res.json()) as { user: AuthUser | null; quota: QuotaStatus };
      setUser(data.user);
      setQuota(data.quota);
    } catch {
      setUser(null);
      setQuota(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const register = useCallback(
    async (email: string, password: string) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка регистрации");
      await refresh();
      return data;
    },
    [refresh]
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка входа");
      await refresh();
      return data;
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await refresh();
  }, [refresh]);

  return { user, quota, loading, refresh, register, login, logout };
}

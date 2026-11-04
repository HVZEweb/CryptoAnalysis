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

  // A full reload: on a private site the next page is the login form, and nothing of the account stays on screen.
  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/";
  }, []);

  return { user, quota, loading, refresh, logout };
}

"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface AdminUser {
  id: string;
  email: string;
  tier: string;
  predictionsUsed: number;
  deviceId: string | null;
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setError("");
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      setError("Не удалось загрузить пользователей");
      return;
    }
    const data = (await res.json()) as { users: AdminUser[] };
    setUsers(data.users);
    setLoaded(true);
  };

  useEffect(() => {
    load();
  }, []);

  const upgrade = async (email: string) => {
    await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, tier: "paid" }),
    });
    await load();
  };

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="font-display text-2xl font-bold">Admin</h1>
      <p className="mt-2 text-sm text-muted-foreground">Локальный проект — управление пользователями</p>
      <Button className="mt-4" onClick={load}>
        Обновить
      </Button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {loaded && (
        <div className="mt-6 space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between rounded-xl bg-white/5 p-3 text-sm">
              <div>
                <p className="font-medium">{u.email}</p>
                <p className="text-muted-foreground">
                  {u.tier} · {u.predictionsUsed} прогнозов · device {u.deviceId?.slice(0, 8) ?? "—"}
                </p>
              </div>
              {u.tier !== "paid" && (
                <Button size="sm" onClick={() => upgrade(u.email)}>
                  → paid
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

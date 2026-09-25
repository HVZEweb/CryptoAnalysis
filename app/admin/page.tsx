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
  const [secret, setSecret] = useState("");

  const adminHeaders = (): Record<string, string> => (secret ? { "x-admin-secret": secret } : {});

  const load = async () => {
    setError("");
    const res = await fetch("/api/admin/users", { headers: adminHeaders() });
    if (!res.ok) {
      setError(res.status === 401 ? "Введите ADMIN_SECRET из .env" : "Не удалось загрузить пользователей");
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
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ email, tier: "paid" }),
    });
    await load();
  };

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="font-display text-2xl font-bold">Admin</h1>
      <p className="mt-2 text-sm text-muted-foreground">Управление пользователями</p>
      <div className="mt-4 flex gap-2">
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="ADMIN_SECRET"
          className="rounded-xl bg-white/5 px-3 py-2 text-sm"
        />
        <Button onClick={load}>Обновить</Button>
      </div>
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

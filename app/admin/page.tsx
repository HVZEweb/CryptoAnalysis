"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface AdminUser {
  id: string;
  email: string;
  tier: "registered" | "paid";
  role: "user" | "admin";
  predictionsUsed: number;
  createdAt: string;
}

type UserChange = { tier?: AdminUser["tier"]; role?: AdminUser["role"]; password?: string };

const inputClass = "rounded-xl bg-white/5 px-3 py-2 text-sm ring-1 ring-white/10";

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newAdmin, setNewAdmin] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      setError(res.status === 403 ? "Доступно только администратору" : "Не удалось загрузить пользователей");
      return;
    }
    setUsers(((await res.json()) as { users: AdminUser[] }).users);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const call = async (url: string, body: object, done: string) => {
    setError("");
    setNotice("");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) setNotice(done);
    else setError(data.error ?? "Не удалось сохранить");
    await load();
    return res.ok;
  };

  const update = async (user: AdminUser, change: UserChange, done: string) => {
    setBusy(user.id);
    await call("/api/admin/users", { userId: user.id, ...change }, done);
    setBusy(null);
  };

  const resetPassword = async (user: AdminUser) => {
    const password = window.prompt(`Новый пароль для ${user.email} (минимум 8 символов):`);
    if (password) await update(user, { password }, `Пароль для ${user.email} изменён`);
  };

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await call(
      "/api/admin/users/create",
      { email: newEmail, password: newPassword, role: newAdmin ? "admin" : "user" },
      `Пользователь ${newEmail} добавлен`
    );
    if (ok) {
      setNewEmail("");
      setNewPassword("");
      setNewAdmin(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Пользователи</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Один вход для всех. Роль «админ» открывает эту страницу и служебные разделы.
          </p>
        </div>
        <div className="flex gap-4">
          <Link href="/admin/research" className="text-sm text-indigo-300 hover:underline">
            Рейтинг монет
          </Link>
          <Link href="/" className="text-sm text-indigo-300 hover:underline">
            ← На сайт
          </Link>
        </div>
      </div>

      <form onSubmit={addUser} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/8">
        <input
          type="email"
          required
          placeholder="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          required
          minLength={8}
          placeholder="пароль (от 8 символов)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={inputClass}
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={newAdmin} onChange={(e) => setNewAdmin(e.target.checked)} />
          админ
        </label>
        <Button type="submit" size="sm">
          Добавить
        </Button>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/5 p-3 text-sm">
            <div>
              <p className="font-medium">
                {u.email}
                {u.role === "admin" && (
                  <span className="ml-2 rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">админ</span>
                )}
              </p>
              <p className="text-muted-foreground">
                {u.role === "admin" || u.tier === "paid" ? "без лимита" : "обычный доступ"} · {u.predictionsUsed} прогнозов · с{" "}
                {new Date(u.createdAt).toLocaleDateString("ru-RU")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {u.role !== "admin" && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === u.id}
                  onClick={() =>
                    update(
                      u,
                      { tier: u.tier === "paid" ? "registered" : "paid" },
                      u.tier === "paid" ? "Безлимит снят" : "Безлимит выдан"
                    )
                  }
                >
                  {u.tier === "paid" ? "Снять безлимит" : "Дать безлимит"}
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={busy === u.id} onClick={() => resetPassword(u)}>
                Сменить пароль
              </Button>
              <Button
                size="sm"
                variant={u.role === "admin" ? "ghost" : "default"}
                disabled={busy === u.id}
                onClick={() =>
                  update(
                    u,
                    { role: u.role === "admin" ? "user" : "admin" },
                    u.role === "admin" ? "Права администратора сняты" : "Назначен администратором"
                  )
                }
              >
                {u.role === "admin" ? "Снять админа" : "Сделать админом"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

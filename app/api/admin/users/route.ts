import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { denyUnlessAdmin } from "@/lib/admin-auth";
import { listUsers, setUserPassword, setUserRole, setUserTierById } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;
  const users = await listUsers(200);
  return NextResponse.json({ users });
}

const updateSchema = z.object({
  userId: z.string().min(1),
  tier: z.enum(["registered", "paid"]).optional(),
  role: z.enum(["user", "admin"]).optional(),
  password: z.string().min(8, "Пароль — минимум 8 символов").optional(),
});

export async function POST(request: NextRequest) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректный запрос" }, { status: 400 });
  }
  const { userId, tier, role, password } = parsed.data;

  if (password && !(await setUserPassword(userId, password))) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  if (tier && !(await setUserTierById(userId, tier))) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }
  if (role) {
    const result = await setUserRole(userId, role);
    if (result === "last_admin") {
      return NextResponse.json({ error: "Нельзя снять права с последнего администратора" }, { status: 409 });
    }
    if (result === "not_found") return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { denyUnlessAdmin } from "@/lib/admin-auth";
import { AuthError, createUser } from "@/lib/auth";

const schema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(8, "Пароль — минимум 8 символов").max(128),
  role: z.enum(["user", "admin"]).default("user"),
});

/** Admins add people on a private site, where open signup is closed. */
export async function POST(request: NextRequest) {
  const denied = await denyUnlessAdmin(request);
  if (denied) return denied;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  try {
    const user = await createUser(parsed.data.email, parsed.data.password, parsed.data.role);
    return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, role: user.role } });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[admin/users/create]", error);
    return NextResponse.json({ error: "Не удалось создать пользователя" }, { status: 500 });
  }
}

import { redirect } from "next/navigation";
import { getUserFromCookies } from "@/lib/admin-auth";

// Checked on every request: the page is only for signed-in admins.
export const dynamic = "force-dynamic";

export default async function AdminOnlyLayout({ children }: { children: React.ReactNode }) {
  const user = await getUserFromCookies();
  if (!user) redirect("/login?next=%2Fnews-impact");
  if (user.role !== "admin") redirect("/?admin=required");
  return children;
}

import { redirect } from "next/navigation";
import { getAdminFromCookies } from "@/lib/admin-auth";

// Checked on every request: the page is only for signed-in admins.
export const dynamic = "force-dynamic";

export default async function AdminOnlyLayout({ children }: { children: React.ReactNode }) {
  if (!(await getAdminFromCookies())) redirect("/?admin=required");
  return children;
}

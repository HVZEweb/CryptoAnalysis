import { HomePage } from "@/components/home-page";
import { Landing } from "@/components/landing";
import { getUserFromCookies } from "@/lib/admin-auth";
import { isSignupOpen } from "@/lib/auth";
import { QUOTA_LIMITS } from "@/lib/quota-config";
import { billingConfig } from "@/services/payments/logic";

// Who is asking decides what "/" is: the landing page for guests, the service itself once signed in.
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getUserFromCookies()) return <HomePage />;

  // A guest who followed a link such as /?upgrade=1 lands there again after signing in.
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") query.set(k, v);
  const billing = billingConfig();
  return (
    <Landing
      signupOpen={await isSignupOpen().catch(() => false)}
      billing={billing ? { priceUsdt: billing.priceUsdt, periodDays: billing.periodDays } : null}
      freePredictions={QUOTA_LIMITS.registered}
      next={query.size ? `/?${query}` : "/"}
    />
  );
}

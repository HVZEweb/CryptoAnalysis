import type { Metadata } from "next";
import { OpportunityPage } from "@/components/opportunities/opportunity-page";

export const metadata: Metadata = { title: "Возможность — CryptoAnalysis" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <OpportunityPage id={(await params).id} />;
}

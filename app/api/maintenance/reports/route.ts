import { NextResponse } from "next/server";
import { listReports } from "@/lib/maintenance-reports";

export async function GET() {
  return NextResponse.json({ reports: listReports() });
}

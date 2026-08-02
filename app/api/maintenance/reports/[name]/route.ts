import { NextResponse } from "next/server";
import { readReportHtml, readReportJson } from "@/lib/maintenance-reports";

export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> }
) {
  const { name } = await context.params;
  const safe = name.replace(/[^a-zA-Z0-9_.-]/g, "");

  const url = new URL(_request.url);
  const format = url.searchParams.get("format");

  if (format === "html") {
    const html = readReportHtml(safe);
    if (!html) return NextResponse.json({ error: "HTML not found" }, { status: 404 });
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const json = readReportJson(safe);
  if (!json) return NextResponse.json({ error: "JSON not found" }, { status: 404 });
  return NextResponse.json(json);
}

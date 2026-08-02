import { NextResponse } from "next/server";
import { readMsbReportJson, readMsbReportMarkdown } from "@/lib/msb-reports";

export async function GET(
  request: Request,
  context: { params: Promise<{ name: string }> }
) {
  const { name } = await context.params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "json";

  if (format === "md" || format === "markdown") {
    const md = readMsbReportMarkdown(name);
    if (!md) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new NextResponse(md, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }

  const data = readMsbReportJson(name);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

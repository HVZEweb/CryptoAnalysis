import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const PROPOSALS_DIR = path.join(process.cwd(), "alpha_registry", "proposals");

export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> }
) {
  const { name } = await context.params;
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "");
  const filePath = path.join(PROPOSALS_DIR, `${safe}.md`);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const content = fs.readFileSync(filePath, "utf8");
  return new NextResponse(content, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

/**
 * Integration smoke test: unified trading bot API.
 * Usage: npx tsx scripts/verify-bots.ts [--base http://localhost:3000]
 */

const BASE = process.argv.find((a) => a.startsWith("--base="))?.split("=")[1] ?? "http://localhost:3000";
const TRADING_API = `${BASE}/api/trading`;

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  const mark = ok ? "✓" : "✗";
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  const body = await res.json();
  return { res, body };
}

async function main() {
  console.log(`\nUnified Trading Bot smoke test @ ${BASE}\n`);

  const { res, body } = await jsonFetch(TRADING_API);
  check("GET /api/trading", res.ok && body.success === true);

  const d = body.data;
  check("Field: online", d?.online !== undefined);
  check("Field: process_running", d?.process_running !== undefined);
  check("Field: status", d?.status !== undefined);
  check("Field: trades", Array.isArray(d?.trades));
  check("Field: positions", Array.isArray(d?.positions));

  const status = d?.status;
  if (status) {
    check("Status.mode", !!status.mode, `mode=${status.mode}`);
    check("Status.active_strategy", !!status.active_strategy, `strategy=${status.active_strategy}`);
    check("Status.config", !!status.config);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

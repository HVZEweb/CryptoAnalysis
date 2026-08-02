import { readFileSync } from "fs";
import { resolve } from "path";

for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\uFEFF?([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

async function main() {
  const { resolveCoinBySymbol } = await import("../lib/coins");
  const { runPredictionPipeline } = await import("../services/prediction");

  const coin = await resolveCoinBySymbol("BTC");
  try {
    const result = await runPredictionPipeline(coin, "Futures", "24h");
    console.log("OK", result.direction);
  } catch (e) {
    console.error("RAW ERROR:", e);
    if (e instanceof Error) console.error("stack:", e.stack);
  }
}

main();

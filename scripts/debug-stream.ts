import { readFileSync } from "fs";
import { resolve } from "path";

for (const line of readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\uFEFF?([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

async function main() {
  const res = await fetch("http://localhost:3000/api/predict/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "cap_device=test-device-debug" },
    body: JSON.stringify({ coinSymbol: "BTC", market: "Futures", timeframe: "24h" }),
  });

  console.log("status:", res.status, res.ok);
  const text = await res.text();
  console.log(text.slice(0, 3000));
}

main().catch(console.error);

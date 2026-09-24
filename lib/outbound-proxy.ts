/**
 * Route all outgoing HTTPS requests (Binance, OpenRouter, CoinGecko, news) through
 * OUTBOUND_PROXY, e.g. a local VPN client: http://127.0.0.1:10809 or socks5://127.0.0.1:10808.
 * Replaces Node's global HTTPS agent, which axios uses when no agent is configured.
 */

import https from "https";

let installedFor: string | null = null;

export async function installOutboundProxy(): Promise<void> {
  const url = process.env.OUTBOUND_PROXY?.trim();
  if (!url || installedFor === url) return;

  const agent = url.startsWith("socks")
    ? new (await import("socks-proxy-agent")).SocksProxyAgent(url)
    : new (await import("https-proxy-agent")).HttpsProxyAgent(url);
  https.globalAgent = agent as unknown as https.Agent;
  installedFor = url;
  console.log(`[outbound-proxy] HTTPS traffic goes through ${url.replace(/\/\/[^@]*@/, "//***@")}`);
}

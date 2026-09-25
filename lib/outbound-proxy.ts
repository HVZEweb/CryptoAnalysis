/**
 * Outgoing HTTPS for regions where some APIs are blocked. Replaces Node's global HTTPS agent,
 * which axios uses when no agent is configured. Two modes:
 *
 * - OUTBOUND_PROXY — everything goes through a local VPN client:
 *   http://127.0.0.1:10809 or socks5://127.0.0.1:10808.
 * - OUTBOUND_SOURCE_IP — a policy-based IPsec VPN that only tunnels packets from this address
 *   (e.g. 10.77.77.1). Only hosts in OUTBOUND_VPN_HOSTS (default: openrouter.ai) are bound to it;
 *   Binance and the rest stay direct, because the tunnel makes every request several times slower.
 */

import https from "https";
import type { Duplex } from "stream";

let installedFor: string | null = null;

function matchesHost(host: string | null | undefined, hosts: string[]): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return hosts.some((d) => h === d || h.endsWith(`.${d}`));
}

class SourceBoundAgent extends https.Agent {
  constructor(
    private readonly sourceIp: string,
    private readonly hosts: string[]
  ) {
    super({ keepAlive: true });
  }

  createConnection(
    options: https.RequestOptions,
    callback?: (err: Error | null, stream: Duplex) => void
  ): Duplex {
    const bound = matchesHost(options.host ?? options.hostname, this.hosts)
      ? { ...options, localAddress: this.sourceIp }
      : options;
    // http.Agent.createConnection exists at runtime; the typings don't expose it on https.Agent.
    const base = https.Agent.prototype as unknown as {
      createConnection: (o: https.RequestOptions, cb?: typeof callback) => Duplex;
    };
    return base.createConnection.call(this, bound, callback);
  }
}

export function vpnHosts(): string[] {
  return (process.env.OUTBOUND_VPN_HOSTS?.trim() || "openrouter.ai")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export async function installOutboundProxy(): Promise<void> {
  const url = process.env.OUTBOUND_PROXY?.trim();
  const sourceIp = process.env.OUTBOUND_SOURCE_IP?.trim();
  const key = url ? `proxy:${url}` : sourceIp ? `src:${sourceIp}` : null;
  if (!key || installedFor === key) return;

  if (url) {
    const agent = url.startsWith("socks")
      ? new (await import("socks-proxy-agent")).SocksProxyAgent(url)
      : new (await import("https-proxy-agent")).HttpsProxyAgent(url);
    https.globalAgent = agent as unknown as https.Agent;
    console.log(`[outbound-proxy] HTTPS traffic goes through ${url.replace(/\/\/[^@]*@/, "//***@")}`);
  } else if (sourceIp) {
    const hosts = vpnHosts();
    https.globalAgent = new SourceBoundAgent(sourceIp, hosts);
    console.log(`[outbound-proxy] ${hosts.join(", ")} via VPN source ${sourceIp}; other hosts direct`);
  }
  installedFor = key;
}

/**
 * Outgoing HTTPS for regions where some APIs are blocked. Replaces Node's global HTTPS agent,
 * which axios uses when no agent is configured. Two modes:
 *
 * - OUTBOUND_PROXY — everything goes through a local VPN client:
 *   http://127.0.0.1:10809 or socks5://127.0.0.1:10808.
 * - OUTBOUND_SOURCE_IP — a policy-based IPsec VPN that only tunnels packets from this address
 *   (e.g. 10.77.77.1). The VPN server may hand out another address in the same /24 after a reconnect,
 *   so the address actually present on the interfaces is looked up again at connection time. Only hosts in OUTBOUND_VPN_HOSTS (default: openrouter.ai and api.telegram.org,
 *   which is throttled from Russia) are bound to it;
 *   Binance and the rest stay direct, because the tunnel makes every request several times slower.
 */

import https from "https";
import os from "os";
import type { Duplex } from "stream";

let installedFor: string | null = null;

function matchesHost(host: string | null | undefined, hosts: string[]): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return hosts.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * The address to bind to: the configured one if the server still has it, otherwise another local
 * address in the same /24 (the VPN re-assigned it), otherwise none — then the request goes direct
 * rather than failing with EADDRNOTAVAIL.
 */
export function pickSourceIp(configured: string, local: string[]): string | null {
  if (local.includes(configured)) return configured;
  const prefix = configured.split(".").slice(0, 3).join(".") + ".";
  return local.find((a) => a.startsWith(prefix)) ?? null;
}

function localIpv4(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
}

class SourceBoundAgent extends https.Agent {
  private resolved: { at: number; ip: string | null } | null = null;

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
    const source = matchesHost(options.host ?? options.hostname, this.hosts) ? this.source() : null;
    const bound = source ? { ...options, localAddress: source } : options;
    // http.Agent.createConnection exists at runtime; the typings don't expose it on https.Agent.
    const base = https.Agent.prototype as unknown as {
      createConnection: (o: https.RequestOptions, cb?: typeof callback) => Duplex;
    };
    return base.createConnection.call(this, bound, callback);
  }

  /** Re-checked once a minute; a change is logged once. */
  private source(): string | null {
    const now = Date.now();
    if (this.resolved && now - this.resolved.at < 60_000) return this.resolved.ip;
    const ip = pickSourceIp(this.sourceIp, localIpv4());
    if (!this.resolved || this.resolved.ip !== ip) {
      if (ip === this.sourceIp) console.log(`[outbound-proxy] VPN source ${ip}`);
      else if (ip) console.warn(`[outbound-proxy] VPN source ${this.sourceIp} is gone; using ${ip} from the same network`);
      else console.warn(`[outbound-proxy] VPN source ${this.sourceIp} is gone and no address replaces it; ${this.hosts.join(", ")} go direct`);
    }
    this.resolved = { at: now, ip };
    return ip;
  }
}

export function vpnHosts(): string[] {
  return (process.env.OUTBOUND_VPN_HOSTS?.trim() || "openrouter.ai,api.telegram.org")
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

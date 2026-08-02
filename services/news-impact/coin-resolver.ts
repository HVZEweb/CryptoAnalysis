import { CANONICAL_COIN_IDS, getCoins } from "@/lib/coins";

const LOCAL_ALIASES: Record<string, string> = {
  bitcoin: "BTC",
  btc: "BTC",
  ethereum: "ETH",
  ether: "ETH",
  eth: "ETH",
  solana: "SOL",
  sol: "SOL",
  ripple: "XRP",
  xrp: "XRP",
  dogecoin: "DOGE",
  doge: "DOGE",
  cardano: "ADA",
  ada: "ADA",
  avalanche: "AVAX",
  avax: "AVAX",
  chainlink: "LINK",
  link: "LINK",
  arbitrum: "ARB",
  arb: "ARB",
  optimism: "OP",
  polygon: "MATIC",
  matic: "MATIC",
  polkadot: "DOT",
  dot: "DOT",
  bnb: "BNB",
  "binance coin": "BNB",
  hedera: "HBAR",
  hbar: "HBAR",
  bonzo: "HBAR",
  litecoin: "LTC",
  ltc: "LTC",
  tron: "TRX",
  trx: "TRX",
  near: "NEAR",
  aptos: "APT",
  apt: "APT",
  sui: "SUI",
  pepe: "PEPE",
  shiba: "SHIB",
  toncoin: "TON",
  ton: "TON",
  stellar: "XLM",
  cosmos: "ATOM",
  atom: "ATOM",
  injective: "INJ",
  inj: "INJ",
  sei: "SEI",
  worldcoin: "WLD",
  wld: "WLD",
};

/** Protocol / ecosystem mentions → native token */
export const ECOSYSTEM_ALIASES: Record<string, string> = {
  hedera: "HBAR",
  bonzo: "HBAR",
  arbitrum: "ARB",
  optimism: "OP",
  solana: "SOL",
  ethereum: "ETH",
  bitcoin: "BTC",
  ripple: "XRP",
  binance: "BNB",
  base: "ETH",
  uniswap: "UNI",
  aave: "AAVE",
  maker: "MKR",
  curve: "CRV",
  lido: "LDO",
  eigenlayer: "EIGEN",
  celestia: "TIA",
  starknet: "STRK",
  zksync: "ZK",
};

export const MAJOR_SYMBOLS = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "DOT", "LINK",
  "MATIC", "LTC", "TRX", "TON", "SHIB", "ATOM", "NEAR", "APT", "ARB", "OP",
]);

export interface AffectedCoin {
  coin: string;
  weight: number;
}

/** Ecosystem sector peers — weight 0–1 */
export const SECTOR_PEERS: Record<string, { sectorLabel: string; peers: AffectedCoin[] }> = {
  SOL: {
    sectorLabel: "Solana",
    peers: [
      { coin: "RAY", weight: 0.65 },
      { coin: "JTO", weight: 0.55 },
      { coin: "PYTH", weight: 0.5 },
      { coin: "WIF", weight: 0.45 },
    ],
  },
  ETH: {
    sectorLabel: "Ethereum",
    peers: [
      { coin: "ARB", weight: 0.6 },
      { coin: "OP", weight: 0.55 },
      { coin: "MATIC", weight: 0.5 },
      { coin: "LDO", weight: 0.45 },
    ],
  },
  BTC: {
    sectorLabel: "Bitcoin",
    peers: [
      { coin: "STX", weight: 0.4 },
      { coin: "ORDI", weight: 0.35 },
    ],
  },
  HBAR: {
    sectorLabel: "Hedera",
    peers: [{ coin: "HBAR", weight: 1 }],
  },
  AVAX: {
    sectorLabel: "Avalanche",
    peers: [{ coin: "JOE", weight: 0.5 }],
  },
  BNB: {
    sectorLabel: "BNB Chain",
    peers: [{ coin: "CAKE", weight: 0.55 }],
  },
};

let coinNameIndex: Array<{ symbol: string; pattern: RegExp }> | null = null;

async function getCoinNameIndex(): Promise<Array<{ symbol: string; pattern: RegExp }>> {
  if (coinNameIndex) return coinNameIndex;

  try {
    const coins = await getCoins();
    coinNameIndex = coins
      .filter((c) => c.name.length >= 3)
      .sort((a, b) => b.name.length - a.name.length)
      .map((c) => ({
        symbol: c.symbol,
        pattern: new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
      }));
  } catch {
    coinNameIndex = [];
  }

  return coinNameIndex;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Synchronous local detection — aliases, ecosystem, canonical symbols, $TICKER */
export function detectCoinsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const explicit = new Set<string>();
  const ecosystem = new Set<string>();

  for (const [alias, symbol] of Object.entries(LOCAL_ALIASES)) {
    if (new RegExp(`\\b${escapeRegex(alias)}\\b`, "i").test(lower)) {
      explicit.add(symbol);
    }
  }

  for (const symbol of Object.keys(CANONICAL_COIN_IDS)) {
    if (new RegExp(`\\b${symbol}\\b`).test(text)) explicit.add(symbol);
  }

  const cashtags = text.match(/\$([A-Z]{2,10})\b/g) ?? [];
  for (const tag of cashtags) {
    explicit.add(tag.slice(1));
  }

  // Exchange names map to native tokens only when no explicit asset is named
  if (explicit.size === 0) {
    for (const [name, symbol] of Object.entries(ECOSYSTEM_ALIASES)) {
      if (new RegExp(`\\b${escapeRegex(name)}\\b`, "i").test(lower)) {
        ecosystem.add(symbol);
      }
    }
  } else {
    // Protocol/ecosystem tokens (non-exchange) still apply alongside explicit coins
    const NON_EXCHANGE_ECOSYSTEM = new Set([
      "hedera", "bonzo", "arbitrum", "optimism", "solana", "ethereum", "bitcoin", "ripple",
      "uniswap", "aave", "maker", "curve", "lido", "eigenlayer", "celestia", "starknet", "zksync",
    ]);
    for (const [name, symbol] of Object.entries(ECOSYSTEM_ALIASES)) {
      if (NON_EXCHANGE_ECOSYSTEM.has(name) && new RegExp(`\\b${escapeRegex(name)}\\b`, "i").test(lower)) {
        ecosystem.add(symbol);
      }
    }
  }

  return rankCoins([...explicit, ...ecosystem]).slice(0, 3);
}

/** Merge hints + CoinGecko name index for richer resolution */
export async function resolveCoinsFromText(
  text: string,
  hints: string[] = []
): Promise<string[]> {
  const found = new Set<string>(detectCoinsFromText(text));

  for (const hint of hints) {
    const sym = hint.toUpperCase().trim();
    if (sym.length >= 2 && sym.length <= 10) found.add(sym);
  }

  try {
    const index = await getCoinNameIndex();
    for (const entry of index) {
      if (entry.pattern.test(text)) found.add(entry.symbol);
    }
  } catch {
    // keep local matches only
  }

  return rankCoins([...found]).slice(0, 3);
}

/** Prefer specific coin order: cashtags/hints first, then majors, then alphabetical */
function rankCoins(coins: string[]): string[] {
  const unique = [...new Set(coins.map((c) => c.toUpperCase()))];
  return unique.sort((a, b) => {
    const aMajor = MAJOR_SYMBOLS.has(a) ? 1 : 0;
    const bMajor = MAJOR_SYMBOLS.has(b) ? 1 : 0;
    if (aMajor !== bMajor) return bMajor - aMajor;
    return a.localeCompare(b);
  });
}

export function resolvePrimaryCoin(coins: string[]): string | null {
  const valid = rankCoins(coins).filter((c) => c.length >= 2 && c.length <= 10);
  return valid[0] ?? null;
}

export function resolveSecondaryCoins(coins: string[]): string[] {
  const ranked = rankCoins(coins);
  return ranked.slice(1, 3);
}

/** Primary + weighted sector/ecosystem coins */
export function resolveAffectedCoins(primary: string | null, detected: string[]): AffectedCoin[] {
  if (!primary) return [];

  const primaryUp = primary.toUpperCase();
  const result: AffectedCoin[] = [{ coin: primaryUp, weight: 1 }];
  const seen = new Set<string>([primaryUp]);

  for (const c of rankCoins(detected)) {
    if (!seen.has(c) && c !== primaryUp) {
      seen.add(c);
      result.push({ coin: c, weight: 0.75 });
    }
  }

  const sector = SECTOR_PEERS[primaryUp];
  if (sector) {
    for (const peer of sector.peers) {
      if (!seen.has(peer.coin)) {
        seen.add(peer.coin);
        result.push(peer);
      }
    }
  }

  return result.slice(0, 5);
}

export function getSectorLabel(primary: string): string | undefined {
  return SECTOR_PEERS[primary.toUpperCase()]?.sectorLabel;
}

export function sectorImpactBoost(affected: AffectedCoin[]): number {
  const secondary = affected.filter((a) => a.weight < 1);
  if (secondary.length === 0) return 0;
  const weighted = secondary.reduce((s, a) => s + a.weight, 0);
  return Math.min(8, Math.round(weighted * 2.5));
}

export function isMajorCoin(symbol: string): boolean {
  return MAJOR_SYMBOLS.has(symbol.toUpperCase());
}

/**
 * Historical crypto headlines from the GDELT DOC 2.0 API (https://api.gdeltproject.org/api/v2/doc/doc).
 * The API searches a rolling window of roughly the last three months, returns at most 250 articles per
 * request and asks for no more than one request every five seconds. A window that comes back full is
 * split in two, so busy days aren't cut off.
 *
 * `seendate` is when GDELT first saw the article (15-minute resolution), which is close to when a reader
 * could have acted on it — the right moment to measure the move from.
 */

export interface GdeltArticle {
  title: string;
  url: string;
  domain: string;
  seen: number;
}

export const GDELT_QUERY = "(bitcoin OR btc OR crypto OR cryptocurrency OR ethereum) sourcelang:english";
const MAX_RECORDS = 250;
const MIN_WINDOW_MS = 30 * 60_000;

const stamp = (t: number) => new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14);

/** "20240101T121500Z" → ms */
export function parseSeenDate(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
}

export function parseGdelt(body: string): GdeltArticle[] | null {
  let data: { articles?: Array<{ title?: string; url?: string; domain?: string; seendate?: string }> };
  try {
    data = JSON.parse(body);
  } catch {
    return null; // rate-limit notices come back as plain text
  }
  return (data.articles ?? [])
    .map((a) => ({ title: (a.title ?? "").trim(), url: a.url ?? "", domain: a.domain ?? "", seen: parseSeenDate(a.seendate ?? "") }))
    .filter((a) => a.title && Number.isFinite(a.seen));
}

export interface GdeltDeps {
  get: (url: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export const gdeltDeps: GdeltDeps = {
  get: async (url) => {
    const res = await fetch(url, { headers: { "user-agent": "CryptoAnalysis research" }, signal: AbortSignal.timeout(30_000) });
    return res.text();
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** After this many windows in a row without an answer GDELT is treated as unreachable. */
const MAX_FAILED_WINDOWS = 5;

async function fetchWindow(from: number, to: number, deps: GdeltDeps): Promise<GdeltArticle[] | null> {
  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc?format=json&mode=artlist&sort=dateasc" +
    `&maxrecords=${MAX_RECORDS}&query=${encodeURIComponent(GDELT_QUERY)}&startdatetime=${stamp(from)}&enddatetime=${stamp(to)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    await deps.sleep(attempt ? 20_000 : 5_500);
    const parsed = await deps.get(url).then(parseGdelt).catch(() => null);
    if (parsed) return parsed;
  }
  deps.log?.(`  GDELT: окно ${stamp(from)} пропущено после 4 попыток`);
  return null;
}

/** Headlines between `from` and `to`, split into windows of `windowMs` and halved while a window is full. */
export async function fetchGdeltHeadlines(
  from: number,
  to: number,
  deps: GdeltDeps = gdeltDeps,
  windowMs = 6 * 60 * 60_000
): Promise<GdeltArticle[]> {
  const out: GdeltArticle[] = [];
  const queue: Array<[number, number]> = [];
  for (let t = from; t < to; t += windowMs) queue.push([t, Math.min(to, t + windowMs)]);
  let done = 0;
  let failedInRow = 0;
  while (queue.length) {
    const [a, b] = queue.shift()!;
    const articles = await fetchWindow(a, b, deps);
    if (!articles) {
      if (++failedInRow >= MAX_FAILED_WINDOWS) throw new Error(`GDELT не отвечает ${MAX_FAILED_WINDOWS} окон подряд`);
      continue;
    }
    failedInRow = 0;
    if (articles.length >= MAX_RECORDS && b - a > MIN_WINDOW_MS) {
      const mid = a + Math.floor((b - a) / 2);
      queue.unshift([a, mid], [mid, b]);
      continue;
    }
    out.push(...articles);
    if (++done % 40 === 0) deps.log?.(`  GDELT: ${new Date(b).toISOString().slice(0, 10)}, заголовков ${out.length}`);
  }
  // The same headline syndicated to many sites: keep its first appearance.
  const seen = new Map<string, GdeltArticle>();
  for (const a of out.sort((x, y) => x.seen - y.seen)) {
    const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!seen.has(key)) seen.set(key, a);
  }
  return [...seen.values()];
}

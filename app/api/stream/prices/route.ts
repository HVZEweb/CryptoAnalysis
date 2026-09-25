import { binanceFuturesClient } from "@/lib/axios";

const SYMBOLS = ["BTC", "ETH", "SOL"] as const;
const REFRESH_MS = 5_000;
const HEARTBEAT_MS = 25_000;

interface Quote {
  symbol: string;
  price: number;
  change24h: number;
}

interface Ticker24h {
  lastPrice: string;
  priceChangePercent: string;
}

/**
 * One Binance ticker call per symbol, shared by every open tab: all streams read the same
 * snapshot, refreshed at most once per REFRESH_MS.
 */
let snapshot: { quotes: Quote[]; ts: number } | null = null;
let inflight: Promise<{ quotes: Quote[]; ts: number }> | null = null;

async function loadQuotes(): Promise<{ quotes: Quote[]; ts: number }> {
  if (snapshot && Date.now() - snapshot.ts < REFRESH_MS) return snapshot;
  inflight ??= Promise.all(
    SYMBOLS.map(async (symbol) => {
      const { data } = await binanceFuturesClient.get<Ticker24h>("/ticker/24hr", {
        params: { symbol: `${symbol}USDT` },
        timeout: 8_000,
      });
      return {
        symbol,
        price: parseFloat(data.lastPrice),
        change24h: parseFloat(data.priceChangePercent),
      };
    })
  )
    .then((quotes) => (snapshot = { quotes, ts: Date.now() }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let closed = false;
  const timers: ReturnType<typeof setInterval>[] = [];

  const stream = new ReadableStream({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        timers.forEach(clearInterval);
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const send = async () => {
        try {
          const { quotes, ts } = await loadQuotes();
          write(`data: ${JSON.stringify({ type: "quotes", quotes, ts })}\n\n`);
        } catch {
          write(`data: ${JSON.stringify({ type: "error", message: "price fetch failed" })}\n\n`);
        }
      };

      request.signal.addEventListener("abort", close);
      void send();
      timers.push(setInterval(send, REFRESH_MS));
      timers.push(setInterval(() => write(`: ping\n\n`), HEARTBEAT_MS));
    },
    cancel() {
      closed = true;
      timers.forEach(clearInterval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

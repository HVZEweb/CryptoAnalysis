import { fetchMarketData } from "@/services/binance";

const SYMBOLS = ["BTC", "ETH", "SOL"] as const;

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = async () => {
        try {
          const quotes = await Promise.all(
            SYMBOLS.map(async (symbol) => {
              const data = await fetchMarketData(symbol, "Futures");
              return {
                symbol,
                price: data.price,
                change24h: data.priceChangePercent24h,
              };
            })
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "quotes", quotes, ts: Date.now() })}\n\n`)
          );
        } catch {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", message: "price fetch failed" })}\n\n`)
          );
        }
      };

      await send();
      const interval = setInterval(send, 12_000);
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 25_000);

      const cleanup = () => {
        clearInterval(interval);
        clearInterval(heartbeat);
      };

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

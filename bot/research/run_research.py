"""CLI entry point for research validation."""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from research.config import ResearchConfig
from research.framework import print_summary, run_research


def main() -> None:
    parser = argparse.ArgumentParser(description="Trading strategy research validation")
    parser.add_argument("--symbols", default="BTC/USDT:USDT,ETH/USDT:USDT,SOL/USDT:USDT", help="Comma-separated symbols")
    parser.add_argument("--bars", type=int, default=0, help="OHLCV bars (0 = all local data)")
    parser.add_argument("--timeframe", default="5m", help="Primary timeframe from local data")
    parser.add_argument("--no-html", action="store_true", help="Skip HTML export")
    parser.add_argument("--offline", action="store_true", help="Use cache/synthetic data (no OKX)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    config = ResearchConfig(
        symbols=[s.strip() for s in args.symbols.split(",") if s.strip()],
        timeframe=args.timeframe,
        total_bars=args.bars,
        hft_timeframe=args.timeframe,
        hft_bars=args.bars,
        export_html=not args.no_html,
        offline=args.offline,
    )

    report = asyncio.run(run_research(config))
    print_summary(report)


if __name__ == "__main__":
    main()

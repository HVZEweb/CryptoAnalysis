"""CLI — Alpha Research Platform."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from alpha.config import AlphaConfig
from alpha.platform import print_alpha_summary, run_alpha
from alpha.registry import CATEGORIES


def main() -> None:
    parser = argparse.ArgumentParser(description="Alpha Research Platform — find new sources of edge")
    parser.add_argument("--symbols", default="BTC/USDT:USDT,ETH/USDT:USDT,SOL/USDT:USDT")
    parser.add_argument("--bars", type=int, default=0, help="0 = all local OHLCV")
    parser.add_argument("--timeframe", default="5m")
    parser.add_argument("--category", action="append", help=f"Filter: {', '.join(CATEGORIES)}")
    parser.add_argument("--module", action="append", help="Run specific module id(s)")
    parser.add_argument("--no-html", action="store_true")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    config = AlphaConfig(
        symbols=[s.strip() for s in args.symbols.split(",") if s.strip()],
        timeframe=args.timeframe,
        total_bars=args.bars,
        offline=True,
        export_html=not args.no_html,
        categories=args.category,
        module_ids=args.module,
    )

    report = run_alpha(config)
    print_alpha_summary(report)


if __name__ == "__main__":
    main()

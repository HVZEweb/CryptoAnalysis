"""CLI — forensic quant research (stages 1-6)."""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from research.forensic import ForensicConfig, print_forensic_summary, run_forensic


def main() -> None:
    parser = argparse.ArgumentParser(description="Forensic quant research — ablation, diagnostics, lab hypotheses")
    parser.add_argument("--symbols", default="BTC/USDT:USDT,ETH/USDT:USDT,SOL/USDT:USDT")
    parser.add_argument("--bars", type=int, default=0, help="0 = all local OHLCV")
    parser.add_argument("--timeframe", default="5m")
    parser.add_argument("--offline", action="store_true", default=True)
    parser.add_argument("--no-hypotheses", action="store_true", help="Skip Research Lab (faster)")
    parser.add_argument("--hypothesis-symbol", default="ETH/USDT:USDT", help="Symbol for lab hypotheses")
    parser.add_argument("--no-html", action="store_true")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    config = ForensicConfig(
        symbols=[s.strip() for s in args.symbols.split(",") if s.strip()],
        timeframe=args.timeframe,
        total_bars=args.bars,
        offline=args.offline,
        export_html=not args.no_html,
        run_hypotheses=not args.no_hypotheses,
        hypothesis_symbols=[args.hypothesis_symbol.strip()],
    )

    report = asyncio.run(run_forensic(config))
    print_forensic_summary(report)


if __name__ == "__main__":
    main()

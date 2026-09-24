"""CLI — Quant data mining discovery cycle."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from alpha.config import AlphaConfig
from alpha.discovery.engine import print_discovery_summary, run_discovery


def main() -> None:
    parser = argparse.ArgumentParser(description="Quant discovery — data mining on collected datasets")
    parser.add_argument("--bars", type=int, default=0, help="0 = full OHLCV")
    parser.add_argument("--no-html", action="store_true")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    config = AlphaConfig(total_bars=args.bars, export_html=not args.no_html)
    report = run_discovery(config)
    print_discovery_summary(report)


if __name__ == "__main__":
    main()

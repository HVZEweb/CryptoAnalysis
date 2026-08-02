"""Phase X — Alpha Discovery 2.0 CLI."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from alpha.config import AlphaConfig
from alpha.phase_x import print_phase_x_summary, run_phase_x


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase X — Alpha Discovery 2.0 (coverage + quality + discovery)")
    parser.add_argument("--update", action="store_true", help="Run daily archive before discovery")
    parser.add_argument("--no-discovery", action="store_true", help="Coverage + quality only")
    parser.add_argument("--skip-l2", action="store_true", help="Skip L2 burst during archive update")
    parser.add_argument("--l2-duration", type=int, default=120)
    parser.add_argument("--bars", type=int, default=0, help="OHLCV bars limit (0=all)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(message)s")

    config = AlphaConfig(total_bars=args.bars)
    report = run_phase_x(
        update_data=args.update,
        run_discovery=not args.no_discovery,
        skip_l2=args.skip_l2,
        l2_duration=args.l2_duration,
        config=config,
    )
    print_phase_x_summary(report)


if __name__ == "__main__":
    main()

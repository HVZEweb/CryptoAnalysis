"""
Execution Intelligence Lab — research platform for large-order execution behavior.

NOT a trading bot. NOT a signal generator.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from collector.runner import run_collector
from collector.storage import ParquetStore
from config import get_config
from execution_patterns.registry import list_patterns
from research.pipeline import run_full_scan, run_pattern_study

log = logging.getLogger("eil.main")


def cmd_status(config) -> None:
    store = ParquetStore(config.data_dir)
    for kind in ("orderbook", "trades", "ticker", "funding", "open_interest"):
        for sym in config.symbols:
            files = store.list_files(kind, sym)
            rows = 0
            if files:
                import pandas as pd

                for f in files:
                    rows += len(pd.read_parquet(f))
            print(f"  {kind:14} {sym:18} {len(files):3} files  {rows:8} rows")


def main() -> None:
    parser = argparse.ArgumentParser(description="Execution Intelligence Lab")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_collect = sub.add_parser("collect", help="L2 + trades + ticker + funding + OI")
    p_collect.add_argument("--duration", type=int, default=0)
    p_collect.add_argument("-v", "--verbose", action="store_true")

    p_status = sub.add_parser("status", help="Data inventory")
    p_status.add_argument("-v", "--verbose", action="store_true")

    p_study = sub.add_parser("study", help="ONE execution pattern per cycle")
    p_study.add_argument("--pattern", default=None)
    p_study.add_argument("--list", action="store_true")
    p_study.add_argument("-v", "--verbose", action="store_true")

    p_scan = sub.add_parser("scan", help="All patterns — no tuning")
    p_scan.add_argument("-v", "--verbose", action="store_true")

    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if getattr(args, "verbose", False) else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )

    config = get_config()

    if args.cmd == "collect":
        dur = args.duration if args.duration > 0 else None
        asyncio.run(run_collector(config, duration_sec=dur))
    elif args.cmd == "status":
        cmd_status(config)
    elif args.cmd == "study":
        if args.list:
            for pid in list_patterns():
                print(f"  {pid}")
            return
        if not args.pattern:
            print("Укажите --pattern. Список: python main.py study --list")
            return
        report = run_pattern_study(args.pattern, config)
        status = "ACCEPTED" if report.get("accepted") else "REJECTED"
        log.info("Pattern '%s': %s — %s", args.pattern, status, report.get("report_path"))
    elif args.cmd == "scan":
        summary = run_full_scan(config)
        log.info("Full scan: %d accepted / %d", summary["accepted_count"], summary["patterns_tested"])


if __name__ == "__main__":
    main()

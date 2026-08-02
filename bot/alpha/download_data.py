"""Download alpha research datasets from OKX."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from alpha.data.okx_alpha import (
    fetch_funding_history,
    fetch_liquidation_orders,
    fetch_oi_history,
    save_dataset,
)
from exchange.okx_rest import to_swap_symbol

log = logging.getLogger("alpha.download")


def _safe(symbol: str) -> str:
    return to_swap_symbol(symbol).replace("/", "_").replace(":", "_")


def download_symbol(symbol: str, types: list[str], months: int) -> None:
    swap = to_swap_symbol(symbol)
    safe = _safe(symbol)

    if "funding" in types or "all" in types:
        log.info("Downloading funding %s...", swap)
        df = fetch_funding_history(symbol, months=months)
        path = save_dataset(df, f"{safe}_funding")
        log.info("  funding: %d rows -> %s", len(df), path)

    if "oi" in types or "all" in types:
        log.info("Downloading OI %s...", swap)
        df = fetch_oi_history(symbol, period="5m", months=months)
        path = save_dataset(df, f"{safe}_oi_5m")
        log.info("  OI: %d rows -> %s", len(df), path)

    if "liquidations" in types or "all" in types:
        log.info("Downloading liquidations %s...", swap)
        df = fetch_liquidation_orders(symbol)
        path = save_dataset(df, f"{safe}_liquidations")
        log.info("  liquidations: %d rows -> %s", len(df), path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Download alpha research data from OKX")
    parser.add_argument("--symbols", default="BTC/USDT:USDT,ETH/USDT:USDT,SOL/USDT:USDT")
    parser.add_argument("--type", default="all", help="funding|oi|liquidations|all")
    parser.add_argument("--months", type=int, default=12)
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(message)s")
    types = [args.type] if args.type != "all" else ["all"]
    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]

    for sym in symbols:
        download_symbol(sym, types, args.months)

    print("\nDone. Data saved to bot/data/alpha/")


if __name__ == "__main__":
    main()

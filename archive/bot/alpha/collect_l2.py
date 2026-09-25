"""Live L2 orderbook collector for microstructure research (public REST API)."""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from alpha.data.archive import DATA_ROOT, append_dataset
from alpha.data.okx_alpha import fetch_orderbook_snapshot, format_orderbook_archive_row
from exchange.okx_rest import to_swap_symbol

log = logging.getLogger("alpha.collect_l2")


def collect_snapshots(symbol: str, *, duration_sec: int = 300, interval_sec: float = 2.0) -> None:
    """
    Collect orderbook snapshots for microstructure modules.
    Uses public OKX REST — no ccxt connection. Appends to data/alpha/{symbol}_orderbook.csv.
    """
    swap = to_swap_symbol(symbol)
    safe = swap.replace("/", "_").replace(":", "_")
    rows: list[dict] = []
    errors = 0

    t0 = time.time()
    log.info("Collecting L2 for %s — %ds every %.1fs (public API)", swap, duration_sec, interval_sec)

    while time.time() - t0 < duration_sec:
        try:
            snap = fetch_orderbook_snapshot(symbol, depth=20)
            if snap:
                rows.append(format_orderbook_archive_row(snap))
                errors = 0
            else:
                errors += 1
        except Exception as e:
            errors += 1
            log.warning("Snapshot error: %s", e)
        if errors >= 5:
            log.warning("Too many errors, stopping collection")
            break
        time.sleep(interval_sec)

    if rows:
        import pandas as pd

        df = pd.DataFrame(rows)
        path = append_dataset(f"{safe}_orderbook", df)
        log.info("Appended %d snapshots -> %s", len(df), path)
    else:
        log.warning("No snapshots collected")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect live L2 data for microstructure alpha")
    parser.add_argument("--symbol", default="ETH/USDT:USDT")
    parser.add_argument("--duration", type=int, default=300, help="Collection duration seconds")
    parser.add_argument("--interval", type=float, default=2.0)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    collect_snapshots(args.symbol, duration_sec=args.duration, interval_sec=args.interval)


if __name__ == "__main__":
    main()

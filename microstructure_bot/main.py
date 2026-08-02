"""

Market Microstructure Alpha Bot — OKX USDT-M Futures.



Phase 2: Market Microstructure Research mode.

Architecture complete — no new modules, research only.

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



from collector.okx_ws import OKXWebSocket, build_subscriptions

from collector.orderbook_recorder import OrderBookRecorder

from collector.storage import ParquetStore

from collector.trades_recorder import TradesRecorder

from config import get_config

from research.hourly_stats import sync_hourly_statistics

from research.continuous import run_daily, run_weekly
from research.pipeline import list_hypotheses, run_hypothesis_study, run_phase2_research



log = logging.getLogger("msb.main")





async def run_collector(*, duration_sec: int | None = None) -> None:

    config = get_config()

    store = ParquetStore(config.data_dir)

    ob_rec = OrderBookRecorder(store, levels=config.book_depth)

    tr_rec = TradesRecorder(store)



    async def dispatch(msg: dict) -> None:

        await ob_rec.on_message(msg)

        await tr_rec.on_message(msg)



    subs = build_subscriptions(config.symbols, book_channel=config.book_channel)

    ws = OKXWebSocket(

        config.ws_public_url,

        subscriptions=subs,

        on_message=dispatch,

        reconnect_delay=config.reconnect_delay_sec,

    )



    flush_task = asyncio.create_task(_flush_loop(store, config))



    log.info("Collector started | symbols=%s | Phase 2 hourly stats on flush", config.symbols)

    if duration_sec:

        try:

            await asyncio.wait_for(ws.run(), timeout=duration_sec)

        except asyncio.TimeoutError:

            ws.stop()

    else:

        await ws.run()



    flush_task.cancel()
    try:
        await flush_task
    except asyncio.CancelledError:
        pass

    flushed = store.flush_all()

    _sync_all_hourly(store, config)

    log.info("Final flush: %d rows", flushed)





async def _flush_loop(store: ParquetStore, config) -> None:

    while True:

        await asyncio.sleep(config.flush_interval_sec)

        n = store.flush_all()

        if n:

            log.info("Periodic flush: %d rows", n)

            _sync_all_hourly(store, config)





def _sync_all_hourly(store: ParquetStore, config) -> None:

    total = 0

    for sym in config.symbols:

        try:

            total += sync_hourly_statistics(store, sym)

        except Exception as e:

            log.warning("Hourly stats %s: %s", sym, e)

    if total:

        log.info("Hourly statistics: +%d rows", total)





def run_research() -> None:

    config = get_config()

    out = _ROOT / "results"

    report = run_phase2_research(config, out)

    log.info("Phase 2 complete — accepted: %d / %d ranked", report.get("accepted_count", 0), len(report.get("ranking", [])))

    if report.get("alpha_candidate_path"):

        log.info(">>> %s", report["alpha_candidate_path"])

    elif report.get("no_edge_report_path"):

        log.info(">>> %s", report["no_edge_report_path"])





def run_study(hypothesis: str) -> None:
    config = get_config()
    out = _ROOT / "results"
    report = run_hypothesis_study(hypothesis, config, out)
    status = "ACCEPTED" if report.get("accepted") else "REJECTED"
    log.info("Hypothesis '%s': %s — %s", hypothesis, status, report.get("report_path"))


def main() -> None:

    parser = argparse.ArgumentParser(description="Market Microstructure Alpha Bot — Research Mode")

    sub = parser.add_subparsers(dest="cmd", required=True)



    p_collect = sub.add_parser("collect", help="WebSocket collection + hourly stats")

    p_collect.add_argument("--duration", type=int, default=0)

    p_collect.add_argument("-v", "--verbose", action="store_true")



    p_research = sub.add_parser("research", help="Phase 2 — scan all event types")

    p_research.add_argument("-v", "--verbose", action="store_true")



    p_study = sub.add_parser("study", help="Phase 3 — ONE hypothesis per cycle")

    p_study.add_argument("--hypothesis", default=None, help="Hypothesis id (see --list)")

    p_study.add_argument("--list", action="store_true", help="List available hypotheses")

    p_study.add_argument("-v", "--verbose", action="store_true")



    p_status = sub.add_parser("status", help="Data + statistics inventory")

    p_status.add_argument("-v", "--verbose", action="store_true")



    p_daily = sub.add_parser("daily", help="Continuous Research — daily health check")

    p_daily.add_argument("-v", "--verbose", action="store_true")



    p_weekly = sub.add_parser("weekly", help="Continuous Research — all hypotheses + week compare")

    p_weekly.add_argument("-v", "--verbose", action="store_true")



    args = parser.parse_args()

    logging.basicConfig(

        level=logging.DEBUG if getattr(args, "verbose", False) else logging.INFO,

        format="%(asctime)s %(levelname)s %(message)s",

        datefmt="%H:%M:%S",

    )



    if args.cmd == "collect":

        dur = args.duration if args.duration > 0 else None

        asyncio.run(run_collector(duration_sec=dur))

    elif args.cmd == "research":

        run_research()

    elif args.cmd == "study":

        if args.list:

            for hid in list_hypotheses():

                print(f"  {hid}")

            return

        if not args.hypothesis:

            print("Укажите --hypothesis. Список: python main.py study --list")

            return

        run_study(args.hypothesis)

    elif args.cmd == "status":

        config = get_config()

        store = ParquetStore(config.data_dir)

        for kind in ("orderbook", "trades", "ticker", "statistics"):

            for sym in config.symbols:

                files = store.list_files(kind, sym)

                rows = 0

                if files:

                    import pandas as pd



                    for f in files:

                        rows += len(pd.read_parquet(f))

                print(f"  {kind:12} {sym:18} {len(files):3} files  {rows:8} rows")



    elif args.cmd == "daily":

        config = get_config()

        out = _ROOT / "results"

        report = run_daily(config, out)

        log.info("Daily: healthy=%s → %s", report["healthy"], report["paths"]["markdown"])



    elif args.cmd == "weekly":

        config = get_config()

        out = _ROOT / "results"

        report = run_weekly(config, out)

        log.info(

            "Weekly: %d/%d accepted → %s",

            report["accepted_count"],

            report["hypotheses_tested"],

            report["paths"]["markdown"],

        )





if __name__ == "__main__":

    main()



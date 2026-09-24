"""Alpha Registry CLI."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from alpha_registry.ingest import ingest_all, ingest_lab
from alpha_registry.schema import AlphaStatus
from alpha_registry.store import RegistryStore

log = logging.getLogger("alpha_registry.cli")


def main() -> None:
    parser = argparse.ArgumentParser(description="Alpha Registry — общий слой исследований")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="List all entries")
    sub.add_parser("summary", help="Registry summary")

    p_ingest = sub.add_parser("ingest", help="Ingest latest studies from labs")
    p_ingest.add_argument("--lab", choices=["microstructure_bot", "execution_intelligence_lab", "all"], default="all")

    p_status = sub.add_parser("set-status", help="Manual status change")
    p_status.add_argument("registry_id")
    p_status.add_argument("status", choices=[s.value for s in AlphaStatus])
    p_status.add_argument("--note", default="Manual review")

    p_show = sub.add_parser("show", help="Show one entry")
    p_show.add_argument("registry_id")

    p_finalize = sub.add_parser("finalize", help="Check and generate final_research_conclusion if due")

    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    store = RegistryStore()

    if args.cmd == "list":
        for r in store.list_records():
            print(f"  [{r.status:10}] {r.registry_id} — {r.title[:60]}")
    elif args.cmd == "summary":
        print(json.dumps(store.summary(), indent=2, ensure_ascii=False))
    elif args.cmd == "ingest":
        if args.lab == "all":
            out = ingest_all(store)
            for lab, ids in out.items():
                print(f"{lab}: {len(ids)} entries")
        else:
            ids = ingest_lab(store, args.lab)
            print(f"Ingested {len(ids)} from {args.lab}")
    elif args.cmd == "set-status":
        rec = store.set_status(args.registry_id, AlphaStatus(args.status), note=args.note, actor="cli")
        print(f"OK -> {rec.registry_id} = {rec.status}")
    elif args.cmd == "show":
        rec = store.get(args.registry_id)
        if not rec:
            print("Not found")
            sys.exit(1)
        print(json.dumps(rec.to_dict(), indent=2, ensure_ascii=False))
    elif args.cmd == "finalize":
        path = store.maybe_generate_final_conclusion()
        if path:
            print(f"Generated: {path}")
        else:
            print("Not due yet (need ≥90 days, ≥8 records, zero validated)")


if __name__ == "__main__":
    main()

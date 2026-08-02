"""Structured logging for unified bot."""

from __future__ import annotations

import logging
import sys
from pathlib import Path


def setup_logging(name: str = "trading_bot", level: int = logging.INFO) -> logging.Logger:
    log = logging.getLogger(name)
    if log.handlers:
        return log

    log.setLevel(level)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s", datefmt="%H:%M:%S")
    )
    log.addHandler(handler)

    log_dir = Path(__file__).resolve().parents[1]
    file_handler = logging.FileHandler(log_dir / "trading.log", encoding="utf-8")
    file_handler.setFormatter(handler.formatter)
    log.addHandler(file_handler)

    return log

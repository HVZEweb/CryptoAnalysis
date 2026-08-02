#!/usr/bin/env python3
"""
Periodic ML retrain on backtest / outcome JSONL.
Input: JSON array of { "features": {...}, "label": 1|-1|0 } (1=LONG win, -1=SHORT win)
Output: updated weights JSON + optional model file path.

Usage:
  python scripts/ml-train.py --input .cache/backtest-training.jsonl --output .cache/ml-weights.json
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

FEATURE_ORDER = [
    "rsi_norm", "macd_hist_norm", "ema_trend", "bb_position", "adx_norm",
    "stoch_rsi_norm", "cci_norm", "vwap_dev", "obv_trend", "structure_trend",
    "volume_anomaly", "volatility_norm", "fear_greed_norm", "btc_dom_change",
    "market_cap_chg", "news_sentiment", "funding_norm", "oi_change_proxy",
    "long_short_bias", "momentum_5", "momentum_20", "higher_tf_rsi",
    "ichimoku_cloud", "regime_score", "oi_change_norm", "funding_trend_norm",
    "cvd_norm", "delta_imbalance", "liq_proximity",
]


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-20, min(20, x))))


def load_samples(path: str) -> list[tuple[list[float], float]]:
    with open(path, encoding="utf-8") as f:
        raw = f.read().strip()
    if not raw:
        return []

    if path.endswith(".jsonl") or (not raw.startswith("[") and "\n" in raw):
        rows = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    else:
        rows = json.loads(raw)

    samples = []
    for row in rows:
        feats = row.get("features") or {}
        label = float(row.get("label", 0))
        if label == 0:
            continue
        y = 1.0 if label > 0 else 0.0
        vec = [float(feats.get(k, 0.0)) for k in FEATURE_ORDER]
        samples.append((vec, y))
    return samples


def train_logistic(samples: list[tuple[list[float], float]], epochs: int = 400, lr: float = 0.08):
    n_feat = len(FEATURE_ORDER)
    w = [0.0] * n_feat
    b = 0.0
    if not samples:
        return w, b

    for _ in range(epochs):
        for vec, y in samples:
            z = b + sum(wi * xi for wi, xi in zip(w, vec))
            p = sigmoid(z)
            err = p - y
            for i in range(n_feat):
                w[i] -= lr * err * vec[i]
            b -= lr * err

    return w, b


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", default=".cache/ml-weights.json")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        json.dump({"error": "input_not_found", "weights": {}}, sys.stdout)
        return

    samples = load_samples(args.input)
    weights, bias = train_logistic(samples)

    out = {
        "model": "logistic_retrained",
        "bias": round(bias, 6),
        "weights": {k: round(w, 6) for k, w in zip(FEATURE_ORDER, weights)},
        "samples": len(samples),
    }

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)

    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
ML direction scorer for ensemble pipeline.
Uses pretrained LightGBM/XGBoost if PREDICTOR_ML_MODEL_PATH is set;
otherwise hand-tuned logistic fallback.
Reads JSON from stdin: { "features": {...}, "modelPath": "..." }
"""

from __future__ import annotations

import json
import math
import os
import sys

FEATURE_ORDER = [
    "rsi_norm",
    "macd_hist_norm",
    "ema_trend",
    "bb_position",
    "adx_norm",
    "stoch_rsi_norm",
    "cci_norm",
    "vwap_dev",
    "obv_trend",
    "structure_trend",
    "volume_anomaly",
    "volatility_norm",
    "fear_greed_norm",
    "btc_dom_change",
    "market_cap_chg",
    "news_sentiment",
    "funding_norm",
    "oi_change_proxy",
    "long_short_bias",
    "momentum_5",
    "momentum_20",
    "higher_tf_rsi",
    "ichimoku_cloud",
    "regime_score",
    "oi_change_norm",
    "funding_trend_norm",
    "cvd_norm",
    "delta_imbalance",
    "liq_proximity",
]

WEIGHTS: dict[str, float] = {
    "rsi_norm": -0.35,
    "macd_hist_norm": 0.55,
    "ema_trend": 0.85,
    "bb_position": 0.4,
    "adx_norm": 0.3,
    "stoch_rsi_norm": -0.25,
    "cci_norm": 0.2,
    "vwap_dev": 0.45,
    "obv_trend": 0.5,
    "structure_trend": 0.9,
    "volume_anomaly": 0.35,
    "volatility_norm": -0.15,
    "fear_greed_norm": 0.25,
    "btc_dom_change": -0.1,
    "market_cap_chg": 0.15,
    "news_sentiment": 0.3,
    "funding_norm": -0.4,
    "oi_change_proxy": 0.1,
    "long_short_bias": 0.35,
    "momentum_5": 0.7,
    "momentum_20": 0.55,
    "higher_tf_rsi": 0.4,
    "ichimoku_cloud": 0.65,
    "regime_score": 0.7,
    "oi_change_norm": 0.25,
    "funding_trend_norm": -0.3,
    "cvd_norm": 0.55,
    "delta_imbalance": 0.6,
    "liq_proximity": -0.2,
}

BIAS = 0.0


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-20, min(20, x))))


def direction_from_p_up(p_up: float) -> dict:
    p_down = 1.0 - p_up
    if abs(p_up - 0.5) < 0.08:
        return {
            "direction": "SIDEWAYS",
            "probability": 50.0,
            "probabilityUp": round(p_up * 100, 1),
            "probabilityDown": round(p_down * 100, 1),
        }
    if p_up >= 0.5:
        return {
            "direction": "LONG",
            "probability": round(p_up * 100, 1),
            "probabilityUp": round(p_up * 100, 1),
            "probabilityDown": round(p_down * 100, 1),
        }
    return {
        "direction": "SHORT",
        "probability": round(p_down * 100, 1),
        "probabilityUp": round(p_up * 100, 1),
        "probabilityDown": round(p_down * 100, 1),
    }


def score_logistic(features: dict[str, float]) -> dict:
    logit = BIAS
    for k, w in WEIGHTS.items():
        logit += float(features.get(k, 0.0)) * w
    p_up = sigmoid(logit)
    out = direction_from_p_up(p_up)
    out["model"] = "logistic_fallback"
    out["rawLogit"] = round(logit, 4)
    return out


def feature_vector(features: dict[str, float]) -> list[float]:
    return [float(features.get(k, 0.0)) for k in FEATURE_ORDER]


def score_pretrained(features: dict[str, float], model_path: str) -> dict | None:
    if not model_path or not os.path.isfile(model_path):
        return None

    vec = feature_vector(features)
    ext = os.path.splitext(model_path)[1].lower()

    try:
        if ext in (".txt", ".lgb", ".model"):
            import lightgbm as lgb  # type: ignore

            booster = lgb.Booster(model_file=model_path)
            raw = booster.predict([vec])[0]
            p_up = float(raw) if 0 <= float(raw) <= 1 else sigmoid(float(raw))
            out = direction_from_p_up(p_up)
            out["model"] = f"lightgbm:{os.path.basename(model_path)}"
            return out

        if ext in (".json", ".ubj"):
            import xgboost as xgb  # type: ignore
            import numpy as np  # type: ignore

            booster = xgb.Booster()
            booster.load_model(model_path)
            dmat = xgb.DMatrix(np.array([vec]))
            raw = float(booster.predict(dmat)[0])
            p_up = raw if 0 <= raw <= 1 else sigmoid(raw)
            out = direction_from_p_up(p_up)
            out["model"] = f"xgboost:{os.path.basename(model_path)}"
            return out

        if ext == ".onnx":
            import onnxruntime as ort  # type: ignore
            import numpy as np  # type: ignore

            sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
            inp = sess.get_inputs()[0].name
            raw = float(sess.run(None, {inp: np.array([vec], dtype=np.float32)})[0].flatten()[0])
            p_up = raw if 0 <= raw <= 1 else sigmoid(raw)
            out = direction_from_p_up(p_up)
            out["model"] = f"onnx:{os.path.basename(model_path)}"
            return out
    except Exception as e:
        return {"error": str(e)}

    return None


def main() -> None:
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else {}
    features = payload.get("features") or {}
    model_path = payload.get("modelPath") or os.environ.get("PREDICTOR_ML_MODEL_PATH") or ""

    if model_path:
        pretrained = score_pretrained(features, model_path)
        if pretrained and "error" not in pretrained:
            json.dump(pretrained, sys.stdout)
            return
        if pretrained and "error" in pretrained:
            json.dump(pretrained, sys.stdout)
            return

    json.dump(score_logistic(features), sys.stdout)


if __name__ == "__main__":
    main()

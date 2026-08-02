"""AI direction predictor — returns up/down probability."""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from ai.feature_builder import FeatureBuilder
from core.config import Settings, get_settings
from exchange.okx_rest import OKXRestClient

log = logging.getLogger("trading_bot.ai.predictor")


class AIPredictor:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.features = FeatureBuilder()

    async def predict_direction(self, symbol: str, rest: OKXRestClient) -> dict[str, Any] | None:
        feat = await self.features.build(symbol, rest)
        if self.settings.openrouter_api_key:
            ai = await self._call_llm(feat)
            if ai:
                return ai
        return self._heuristic(feat)

    def _heuristic(self, feat: dict[str, Any]) -> dict[str, Any]:
        score_up = 50.0
        score_down = 50.0

        if feat["ema_trend"] == "bull":
            score_up += 10
        else:
            score_down += 10
        if feat["rsi"] < 35:
            score_up += 15
        elif feat["rsi"] > 65:
            score_down += 15
        if feat["imbalance"] > 0.1:
            score_up += 8
        elif feat["imbalance"] < -0.1:
            score_down += 8
        if feat["momentum"] > 0.2:
            score_up += 10
        elif feat["momentum"] < -0.2:
            score_down += 10
        if feat["funding_rate"] > 0.05:
            score_down += 5
        elif feat["funding_rate"] < -0.05:
            score_up += 5

        if score_up > score_down + 10:
            direction = "LONG"
            confidence = min(95, score_up)
        elif score_down > score_up + 10:
            direction = "SHORT"
            confidence = min(95, score_down)
        else:
            direction = "SIDEWAYS"
            confidence = max(score_up, score_down)

        return {
            "direction": direction,
            "confidence": confidence,
            "probability_up": score_up,
            "probability_down": score_down,
            "expected_move_pct": feat["atr_pct"] * 0.5,
            "source": "heuristic",
            "features": feat,
        }

    async def _call_llm(self, feat: dict[str, Any]) -> dict[str, Any] | None:
        prompt = (
            "Return JSON only: {direction: LONG|SHORT|SIDEWAYS, confidence: 0-100, "
            "expected_move_pct: number, probability_up: number, probability_down: number}\n"
            f"Features: {json.dumps(feat, default=str)}"
        )
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                res = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.settings.openrouter_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.settings.openrouter_model,
                        "messages": [
                            {"role": "system", "content": "Quant futures analyst. JSON only."},
                            {"role": "user", "content": prompt},
                        ],
                        "temperature": 0.2,
                    },
                )
                res.raise_for_status()
                content = res.json()["choices"][0]["message"]["content"]
                start = content.find("{")
                end = content.rfind("}") + 1
                if start < 0 or end <= start:
                    return None
                data = json.loads(content[start:end])
                data["source"] = "openrouter"
                data["features"] = feat
                return data
        except Exception as e:
            log.warning("AI call failed: %s", e)
            return None

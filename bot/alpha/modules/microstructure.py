"""Market microstructure modules — L2/trade tape ONLY, never OHLCV."""

from __future__ import annotations

import pandas as pd

from alpha.base import AlphaContext, AlphaModule, AlphaModuleMeta


class _MicrostructureBase(AlphaModule):
    requires_l2 = True
    data_requirements = ("orderbook",)

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        return ctx.orderbook_snapshots.copy() if ctx.orderbook_snapshots is not None else pd.DataFrame()

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        return []


class OrderBookImbalanceAlpha(_MicrostructureBase):
    meta = AlphaModuleMeta("micro_ob_imbalance", "Order Book Imbalance", "microstructure", "Persistent bid/ask depth imbalance", data_requirements=("orderbook",), requires_l2=True)


class MicropriceAlpha(_MicrostructureBase):
    meta = AlphaModuleMeta("micro_microprice", "Microprice Signal", "microstructure", "Microprice vs mid divergence", data_requirements=("orderbook",), requires_l2=True)


class QueueImbalanceAlpha(_MicrostructureBase):
    meta = AlphaModuleMeta("micro_queue_imbalance", "Queue Imbalance", "microstructure", "Top-of-book queue size imbalance", data_requirements=("orderbook",), requires_l2=True)


class SpoofingDetectionAlpha(_MicrostructureBase):
    meta = AlphaModuleMeta("micro_spoofing", "Spoofing Detection", "microstructure", "Fleeting large orders — fade spoof direction", data_requirements=("orderbook",), requires_l2=True)


class AbsorptionAlpha(_MicrostructureBase):
    meta = AlphaModuleMeta("micro_absorption", "Absorption", "microstructure", "Large passive fill absorption at level", data_requirements=("orderbook", "trades_tape"), requires_l2=True)


class HiddenLiquidityAlpha(_MicrostructureBase):
    meta = AlphaModuleMeta("micro_hidden_liquidity", "Hidden Liquidity", "microstructure", "Iceberg replenishment detection", data_requirements=("orderbook",), requires_l2=True)


class OrderFlowImbalanceAlpha(_MicrostructureBase):
    meta = AlphaModuleMeta("micro_order_flow", "Order Flow Imbalance", "microstructure", "Aggressive buy/sell trade imbalance", data_requirements=("orderbook", "trades_tape"), requires_l2=True)


MICROSTRUCTURE_MODULES = [
    OrderBookImbalanceAlpha(),
    MicropriceAlpha(),
    QueueImbalanceAlpha(),
    SpoofingDetectionAlpha(),
    AbsorptionAlpha(),
    HiddenLiquidityAlpha(),
    OrderFlowImbalanceAlpha(),
]

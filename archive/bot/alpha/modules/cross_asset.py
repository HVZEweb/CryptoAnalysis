"""Cross-asset lead-lag research."""

from __future__ import annotations

import pandas as pd

from alpha.base import AlphaContext, AlphaModule, AlphaModuleMeta
from alpha.features import cross_asset_lead_signal


class _CrossLeadBase(AlphaModule):
    leader_key: str = ""
    data_requirements = ("ohlcv", "cross_asset")

    def build_features(self, ctx: AlphaContext) -> pd.DataFrame:
        f = ctx.ohlcv.copy()
        leader = ctx.cross_assets.get(self.leader_key)
        if leader is None or len(leader) < 50:
            f["signal"] = 0
            return f
        min_len = min(len(f), len(leader))
        f = f.iloc[-min_len:].reset_index(drop=True)
        leader = leader.iloc[-min_len:].reset_index(drop=True)
        f["signal"] = cross_asset_lead_signal(leader["close"], f["close"], lag_bars=3, threshold_pct=0.12)
        return f

    def generate_entries(self, features: pd.DataFrame, ctx: AlphaContext) -> list[tuple[int, str]]:
        entries = []
        for i in range(40, len(features) - 12):
            sig = int(features.iloc[i]["signal"])
            if sig == 1:
                entries.append((i, "long"))
            elif sig == -1:
                entries.append((i, "short"))
        return entries


class BTCLeadsETH(_CrossLeadBase):
    meta = AlphaModuleMeta("btc_leads_eth", "BTC Leads ETH", "cross_asset", "BTC move precedes ETH", data_requirements=("ohlcv", "cross_asset"))
    leader_key = "BTC/USDT:USDT"


class BTCLeadsSOL(_CrossLeadBase):
    meta = AlphaModuleMeta("btc_leads_sol", "BTC Leads SOL", "cross_asset", "BTC move precedes SOL", data_requirements=("ohlcv", "cross_asset"))
    leader_key = "BTC/USDT:USDT"


class ETHLeadsSOL(_CrossLeadBase):
    meta = AlphaModuleMeta("eth_leads_sol", "ETH Leads SOL", "cross_asset", "ETH move precedes SOL", data_requirements=("ohlcv", "cross_asset"))
    leader_key = "ETH/USDT:USDT"


CROSS_ASSET_MODULES = [BTCLeadsETH(), BTCLeadsSOL(), ETHLeadsSOL()]

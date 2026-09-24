"""Trade flow aggregation — aggression, delta, cumulative delta."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class TradeFlow:
    """Rolling trade flow state for one instrument."""

    inst_id: str
    window_ms: int = 60_000
    _trades: list[tuple[int, float, float, str]] = field(default_factory=list)

    def add(self, ts: int, price: float, size: float, side: str) -> None:
        """side: buy = taker buy (aggressive buy), sell = taker sell."""
        self._trades.append((ts, price, size, side))
        cutoff = ts - self.window_ms
        self._trades = [t for t in self._trades if t[0] >= cutoff]

    @property
    def buy_aggression(self) -> float:
        return sum(sz for _, _, sz, s in self._trades if s == "buy")

    @property
    def sell_aggression(self) -> float:
        return sum(sz for _, _, sz, s in self._trades if s == "sell")

    @property
    def delta_volume(self) -> float:
        return self.buy_aggression - self.sell_aggression

    @property
    def trade_count(self) -> int:
        return len(self._trades)

    @property
    def vwap(self) -> float:
        vol = sum(sz for _, _, sz, _ in self._trades)
        if vol <= 0:
            return 0.0
        return sum(p * sz for _, p, sz, _ in self._trades) / vol

    def cumulative_delta_series(self) -> list[tuple[int, float]]:
        cum = 0.0
        out: list[tuple[int, float]] = []
        for ts, _, sz, side in sorted(self._trades):
            cum += sz if side == "buy" else -sz
            out.append((ts, cum))
        return out

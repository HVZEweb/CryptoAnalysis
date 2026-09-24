"""Strategy placeholder — only activated after validated research edge."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class DiscoveredAlpha:
    """
    Template for a statistically validated microstructure hypothesis.
    Populate only after event_study validation passes on BTC + ETH.
    """

    name: str
    event_type: str  # imbalance_bid | absorption | sweep | vacuum
    horizon_sec: int
    direction: str  # long | short
    min_pf: float = 1.2
    validated_symbols: list[str] | None = None

    def is_ready(self) -> bool:
        if not self.validated_symbols or len(self.validated_symbols) < 2:
            return False
        return "BTC-USDT-SWAP" in self.validated_symbols and "ETH-USDT-SWAP" in self.validated_symbols

    def on_event(self, event: dict) -> str | None:
        """Return 'long' | 'short' | None — override when edge is discovered."""
        if event.get("event") != self.event_type:
            return None
        return self.direction if self.is_ready() else None

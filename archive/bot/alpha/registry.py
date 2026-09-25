"""Alpha module registry."""

from __future__ import annotations

from alpha.base import AlphaModule
from alpha.modules.cross_asset import CROSS_ASSET_MODULES
from alpha.modules.event import EVENT_MODULES
from alpha.modules.funding import FUNDING_MODULES
from alpha.modules.liquidation import LIQUIDATION_MODULES
from alpha.modules.microstructure import MICROSTRUCTURE_MODULES
from alpha.modules.oi import OI_MODULES
from alpha.modules.session import SESSION_MODULES
from alpha.modules.volatility import VOLATILITY_MODULES

ALL_ALPHA_MODULES: list[AlphaModule] = (
    FUNDING_MODULES
    + OI_MODULES
    + LIQUIDATION_MODULES
    + CROSS_ASSET_MODULES
    + VOLATILITY_MODULES
    + SESSION_MODULES
    + MICROSTRUCTURE_MODULES
    + EVENT_MODULES
)

CATEGORIES = sorted({m.meta.category for m in ALL_ALPHA_MODULES})


def get_module(module_id: str) -> AlphaModule | None:
    for m in ALL_ALPHA_MODULES:
        if m.meta.id == module_id:
            return m
    return None


def list_modules(*, category: str | None = None) -> list[AlphaModule]:
    if not category:
        return list(ALL_ALPHA_MODULES)
    return [m for m in ALL_ALPHA_MODULES if m.meta.category == category]

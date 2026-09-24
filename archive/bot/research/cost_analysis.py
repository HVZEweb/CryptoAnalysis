"""Execution cost attribution — logic losses vs market friction."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from research.trade_record import SimulatedTrade


@dataclass
class CostBreakdown:
    strategy: str
    symbol: str
    trades: int
    avg_pnl_no_costs_pct: float = 0.0
    avg_pnl_fees_only_pct: float = 0.0
    avg_pnl_fees_slip_pct: float = 0.0
    avg_pnl_full_pct: float = 0.0
    total_fees_pct: float = 0.0
    total_slippage_pct: float = 0.0
    total_spread_pct: float = 0.0
    total_safety_pct: float = 0.0
    logic_edge_pct: float = 0.0
    friction_drag_pct: float = 0.0
    friction_share_of_loss: float = 0.0

    def to_dict(self) -> dict:
        return {
            "strategy": self.strategy,
            "symbol": self.symbol,
            "trades": self.trades,
            "avg_pnl_no_costs_pct": round(self.avg_pnl_no_costs_pct, 4),
            "avg_pnl_fees_only_pct": round(self.avg_pnl_fees_only_pct, 4),
            "avg_pnl_fees_slip_pct": round(self.avg_pnl_fees_slip_pct, 4),
            "avg_pnl_full_pct": round(self.avg_pnl_full_pct, 4),
            "total_fees_pct": round(self.total_fees_pct, 4),
            "total_slippage_pct": round(self.total_slippage_pct, 4),
            "total_spread_pct": round(self.total_spread_pct, 4),
            "logic_edge_pct": round(self.logic_edge_pct, 4),
            "friction_drag_pct": round(self.friction_drag_pct, 4),
            "friction_share_of_loss": round(self.friction_share_of_loss, 2),
        }


@dataclass
class CostAnalysisReport:
    breakdowns: list[CostBreakdown] = field(default_factory=list)
    summary: str = ""

    def to_dict(self) -> dict:
        return {"breakdowns": [b.to_dict() for b in self.breakdowns], "summary": self.summary}


def analyze_costs(trades: list[SimulatedTrade], *, strategy: str, symbol: str, safety_pct: float = 0.10) -> CostBreakdown:
    if not trades:
        return CostBreakdown(strategy=strategy, symbol=symbol, trades=0)

    no_cost = [t.pnl_no_costs_pct for t in trades]
    fees_only = [t.pnl_fees_only_pct for t in trades]
    fees_slip = [t.pnl_fees_slip_pct for t in trades]
    full = [t.net_return_pct for t in trades]

    avg_no = float(np.mean(no_cost))
    avg_fees = float(np.mean(fees_only))
    avg_fslip = float(np.mean(fees_slip))
    avg_full = float(np.mean(full))

    total_fees = sum(t.fees_pct for t in trades)
    total_slip = sum(t.slippage_pct for t in trades)
    total_spread = sum(t.spread_cost_pct for t in trades)

    friction = avg_no - avg_full
    logic_edge = avg_no
    loss_total = abs(sum(x for x in full if x < 0))
    friction_loss = abs(sum((t.pnl_no_costs_pct - t.net_return_pct) for t in trades if t.net_return_pct < 0))
    friction_share = (friction_loss / loss_total * 100) if loss_total > 0 else 0.0

    return CostBreakdown(
        strategy=strategy,
        symbol=symbol,
        trades=len(trades),
        avg_pnl_no_costs_pct=avg_no,
        avg_pnl_fees_only_pct=avg_fees,
        avg_pnl_fees_slip_pct=avg_fslip,
        avg_pnl_full_pct=avg_full,
        total_fees_pct=total_fees,
        total_slippage_pct=total_slip,
        total_spread_pct=total_spread,
        total_safety_pct=safety_pct * len(trades),
        logic_edge_pct=logic_edge,
        friction_drag_pct=friction,
        friction_share_of_loss=friction_share,
    )


def build_cost_summary(breakdowns: list[CostBreakdown]) -> str:
    if not breakdowns:
        return "Нет сделок для анализа издержек."
    parts = []
    for b in breakdowns:
        if b.trades == 0:
            parts.append(f"{b.strategy}@{b.symbol}: нет сделок.")
            continue
        if b.logic_edge_pct > 0 and b.avg_pnl_full_pct <= 0:
            parts.append(
                f"{b.strategy}@{b.symbol}: логика даёт +{b.logic_edge_pct:.3f}% до издержек, "
                f"но после friction EV={b.avg_pnl_full_pct:.3f}% ({b.friction_share_of_loss:.0f}% убытков — издержки)."
            )
        elif b.logic_edge_pct <= 0:
            parts.append(
                f"{b.strategy}@{b.symbol}: отрицательный edge уже без издержек ({b.logic_edge_pct:.3f}%), "
                f"издержки усугубляют до {b.avg_pnl_full_pct:.3f}%."
            )
        else:
            parts.append(f"{b.strategy}@{b.symbol}: положительный edge после издержек ({b.avg_pnl_full_pct:.3f}%).")
    return " ".join(parts)


def build_cost_summary_from_dicts(breakdowns: list[dict]) -> str:
    objs = [
        CostBreakdown(
            strategy=b["strategy"],
            symbol=b["symbol"],
            trades=b["trades"],
            avg_pnl_no_costs_pct=b.get("avg_pnl_no_costs_pct", 0),
            avg_pnl_fees_only_pct=b.get("avg_pnl_fees_only_pct", 0),
            avg_pnl_fees_slip_pct=b.get("avg_pnl_fees_slip_pct", 0),
            avg_pnl_full_pct=b.get("avg_pnl_full_pct", 0),
            logic_edge_pct=b.get("logic_edge_pct", 0),
            friction_drag_pct=b.get("friction_drag_pct", 0),
            friction_share_of_loss=b.get("friction_share_of_loss", 0),
        )
        for b in breakdowns
    ]
    return build_cost_summary(objs)

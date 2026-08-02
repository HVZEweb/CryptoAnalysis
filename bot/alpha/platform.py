"""Alpha Research Platform orchestrator."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from alpha.base import AlphaContext, AlphaModuleResult, AlphaStatus
from alpha.config import AlphaConfig
from alpha.data.loader import build_context
from alpha.registry import ALL_ALPHA_MODULES, get_module, list_modules
from alpha.report import export_alpha_report
from alpha.validate import validate_module
from exchange.okx_rest import to_swap_symbol

log = logging.getLogger("alpha.platform")


@dataclass
class AlphaPlatformReport:
    generated_at: str
    elapsed_sec: float
    results: list[AlphaModuleResult] = field(default_factory=list)
    accepted: list[str] = field(default_factory=list)
    rejected: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    conclusions: dict[str, Any] = field(default_factory=dict)
    html_path: str | None = None
    json_path: str | None = None


class AlphaPlatform:
    def __init__(self, config: AlphaConfig | None = None) -> None:
        self.config = config or AlphaConfig()

    def _modules(self):
        if self.config.module_ids:
            mods = [get_module(mid) for mid in self.config.module_ids]
            return [m for m in mods if m]
        mods = list_modules(category=self.config.categories[0] if self.config.categories and len(self.config.categories) == 1 else None)
        if self.config.categories and len(self.config.categories) > 1:
            cats = set(self.config.categories)
            mods = [m for m in ALL_ALPHA_MODULES if m.meta.category in cats]
        return mods

    def run(self) -> AlphaPlatformReport:
        t0 = time.perf_counter()
        results: list[AlphaModuleResult] = []
        modules = self._modules()

        raw_cross = {to_swap_symbol(s): build_context(s, timeframe=self.config.timeframe, bars=self.config.total_bars)["ohlcv"]
                     for s in self.config.symbols}

        for symbol in self.config.symbols:
            swap = to_swap_symbol(symbol)
            raw = build_context(
                symbol,
                timeframe=self.config.timeframe,
                bars=self.config.total_bars,
                cross_symbols=[s for s in self.config.symbols if s != symbol],
            )
            if raw["ohlcv"] is None:
                log.warning("Skip %s — no OHLCV", swap)
                continue

            cross = {k: v for k, v in raw_cross.items() if k != swap and v is not None}

            ctx = AlphaContext(
                symbol=swap,
                timeframe=self.config.timeframe,
                ohlcv=raw["ohlcv"],
                funding=raw["funding"],
                open_interest=raw["open_interest"],
                liquidations=raw["liquidations"],
                orderbook_snapshots=raw["orderbook_snapshots"],
                trades_tape=raw["trades_tape"],
                cross_assets=cross,
            )

            for module in modules:
                if module.meta.category == "cross_asset":
                    leader = getattr(module, "leader_key", "")
                    if leader and swap == leader:
                        continue
                if module.meta.category == "cross_asset" and "cross_asset" in module.meta.data_requirements and not cross:
                    results.append(
                        AlphaModuleResult(
                            meta=module.meta,
                            symbol=swap,
                            status=AlphaStatus.REJECTED_DATA_UNAVAILABLE,
                            verdict="Cross-asset data unavailable",
                        )
                    )
                    continue

                log.info("Alpha %s @ %s", module.meta.id, swap)
                result = validate_module(module, ctx, self.config)
                results.append(result)

        accepted = [f"{r.meta.id}:{r.symbol}" for r in results if r.status == AlphaStatus.ACCEPTED]
        rejected = [f"{r.meta.id}:{r.symbol}" for r in results if r.status.value.startswith("rejected")]
        skipped = [f"{r.meta.id}:{r.symbol}" for r in results if r.status == AlphaStatus.SKIPPED_L2_REQUIRED]

        conclusions = _conclusions(results, accepted, rejected, skipped)
        elapsed = time.perf_counter() - t0

        report_dict = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "elapsed_sec": round(elapsed, 1),
            "config": {
                "symbols": self.config.symbols,
                "timeframe": self.config.timeframe,
                "modules_tested": len(results),
            },
            "results": [r.to_dict() for r in results],
            "accepted": accepted,
            "rejected": rejected,
            "skipped": skipped,
            "conclusions": conclusions,
        }

        html_path = None
        if self.config.export_html:
            out = Path(__file__).resolve().parent / "results"
            html_path = str(export_alpha_report(report_dict, out))

        return AlphaPlatformReport(
            generated_at=report_dict["generated_at"],
            elapsed_sec=elapsed,
            results=results,
            accepted=accepted,
            rejected=rejected,
            skipped=skipped,
            conclusions=conclusions,
            html_path=html_path,
            json_path=str(Path(html_path).with_suffix(".json")) if html_path else None,
        )


def _conclusions(results: list[AlphaModuleResult], accepted, rejected, skipped) -> dict[str, Any]:
    promising = []
    for r in results:
        oos = r.out_of_sample
        if r.status == AlphaStatus.ACCEPTED:
            continue
        if oos and oos.trades >= 3 and oos.expectancy_pct > -0.05 and r.overfitting_score < 1.0:
            promising.append(f"{r.meta.id}:{r.symbol} (weak OOS EV={oos.expectancy_pct:.3f}%)")

    if accepted:
        ml_note = f"Найдено {len(accepted)} alpha-кандидатов, прошедших все критерии. Можно предложить интеграцию в бота."
    else:
        ml_note = (
            "Ни один модуль не прошёл полную статистическую валидацию. "
            "Продолжайте сбор данных (funding/OI/liquidations/L2) и тестирование новых гипотез. "
            "Не интегрировать в бота до появления ACCEPTED модуля."
        )

    return {
        "accepted_count": len(accepted),
        "rejected_count": len(rejected),
        "skipped_l2_count": len(skipped),
        "promising_weak": promising[:10],
        "ml_note": ml_note,
        "next_steps": [
            "Скачать alpha-данные: npm run trading:alpha-download",
            "Для microstructure: python -m alpha.collect_l2 (live collection)",
            "Не оптимизировать legacy quant/hft стратегии",
        ],
    }


def run_alpha(config: AlphaConfig | None = None) -> AlphaPlatformReport:
    return AlphaPlatform(config).run()


def print_alpha_summary(report: AlphaPlatformReport) -> None:
    print("\n" + "=" * 60)
    print("ALPHA RESEARCH PLATFORM")
    print("=" * 60)
    print(f"\n{report.conclusions.get('ml_note', '')}\n")
    print(f"Accepted: {len(report.accepted)}")
    for a in report.accepted[:5]:
        print(f"  ✓ {a}")
    print(f"Rejected: {len(report.rejected)} | Skipped (L2): {len(report.skipped)}")
    weak = report.conclusions.get("promising_weak", [])
    if weak:
        print("Weak signals (not accepted):")
        for w in weak[:5]:
            print(f"  ~ {w}")
    if report.html_path:
        print(f"\nReport: {report.html_path}")
    print(f"Elapsed: {report.elapsed_sec:.1f}s")

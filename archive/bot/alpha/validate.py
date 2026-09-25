"""Validate alpha modules — OOS, walk-forward, significance."""

from __future__ import annotations

import pandas as pd

from alpha.base import AlphaContext, AlphaModule, AlphaModuleResult, AlphaStatus, SignificanceResult
from alpha.config import AlphaConfig
from alpha.significance import bootstrap_significance
from research.metrics import ResearchMetrics, aggregate_fold_metrics, build_research_metrics, overfitting_score
from research.oos import split_holdout
from research.trade_record import SimulatedTrade


def _walk_forward(
    module: AlphaModule,
    ctx: AlphaContext,
    config: AlphaConfig,
) -> tuple[ResearchMetrics, float]:
    df = ctx.ohlcv
    folds: list[ResearchMetrics] = []
    start = 0
    while start + config.train_bars + config.test_bars <= len(df):
        sub = AlphaContext(
            symbol=ctx.symbol,
            timeframe=ctx.timeframe,
            ohlcv=df.iloc[start + config.train_bars : start + config.train_bars + config.test_bars].reset_index(drop=True),
            funding=ctx.funding,
            open_interest=ctx.open_interest,
            liquidations=ctx.liquidations,
            orderbook_snapshots=ctx.orderbook_snapshots,
            trades_tape=ctx.trades_tape,
            cross_assets=ctx.cross_assets,
        )
        trades = module.run(sub)
        folds.append(build_research_metrics(trades))
        start += config.walk_forward_step
    agg = aggregate_fold_metrics(folds)
    return agg, agg.stability_score


def _rolling(
    module: AlphaModule,
    ctx: AlphaContext,
    config: AlphaConfig,
) -> ResearchMetrics:
    df = ctx.ohlcv
    windows: list[ResearchMetrics] = []
    start = 0
    while start + config.rolling_window_bars <= len(df):
        sub = AlphaContext(
            symbol=ctx.symbol,
            timeframe=ctx.timeframe,
            ohlcv=df.iloc[start : start + config.rolling_window_bars].reset_index(drop=True),
            funding=ctx.funding,
            open_interest=ctx.open_interest,
            liquidations=ctx.liquidations,
            orderbook_snapshots=ctx.orderbook_snapshots,
            trades_tape=ctx.trades_tape,
            cross_assets=ctx.cross_assets,
        )
        trades = module.run(sub)
        windows.append(build_research_metrics(trades))
        start += config.rolling_step_bars
    return aggregate_fold_metrics(windows)


def validate_module(
    module: AlphaModule,
    ctx: AlphaContext,
    config: AlphaConfig,
) -> AlphaModuleResult:
    err = module.check_data(ctx)
    if err:
        if module.meta.requires_l2:
            return AlphaModuleResult(
                meta=module.meta,
                symbol=ctx.symbol,
                status=AlphaStatus.SKIPPED_L2_REQUIRED,
                verdict=err,
            )
        return AlphaModuleResult(
            meta=module.meta,
            symbol=ctx.symbol,
            status=AlphaStatus.REJECTED_DATA_UNAVAILABLE,
            verdict=err,
        )

    is_df, oos_df = split_holdout(ctx.ohlcv, config.oos_holdout_pct)
    is_ctx = AlphaContext(
        symbol=ctx.symbol,
        timeframe=ctx.timeframe,
        ohlcv=is_df,
        funding=ctx.funding,
        open_interest=ctx.open_interest,
        liquidations=ctx.liquidations,
        orderbook_snapshots=ctx.orderbook_snapshots,
        trades_tape=ctx.trades_tape,
        cross_assets=ctx.cross_assets,
    )
    oos_ctx = AlphaContext(
        symbol=ctx.symbol,
        timeframe=ctx.timeframe,
        ohlcv=oos_df,
        funding=ctx.funding,
        open_interest=ctx.open_interest,
        liquidations=ctx.liquidations,
        orderbook_snapshots=ctx.orderbook_snapshots,
        trades_tape=ctx.trades_tape,
        cross_assets=ctx.cross_assets,
    )

    full_trades = module.run(ctx)
    is_trades = module.run(is_ctx)
    oos_trades = module.run(oos_ctx)

    full_m = build_research_metrics(full_trades)
    is_m = build_research_metrics(is_trades)
    oos_m = build_research_metrics(oos_trades)
    wf_m, stability = _walk_forward(module, ctx, config)
    roll_m = _rolling(module, ctx, config)
    overfit = overfitting_score(is_m, oos_m)

    oos_returns = [t.net_return_pct for t in oos_trades]
    sig = bootstrap_significance(oos_returns, n_bootstrap=config.bootstrap_samples)

    status, verdict = _verdict(oos_m, wf_m, overfit, sig, config)

    features = module.build_features(ctx)
    feat_summary = {}
    if features is not None and not features.empty:
        for col in features.columns[:8]:
            if features[col].dtype in ("float64", "int64"):
                feat_summary[col] = {
                    "mean": round(float(features[col].mean()), 4),
                    "std": round(float(features[col].std()), 4),
                }

    return AlphaModuleResult(
        meta=module.meta,
        symbol=ctx.symbol,
        status=status,
        verdict=verdict,
        full_sample=full_m,
        in_sample=is_m,
        out_of_sample=oos_m,
        walk_forward=wf_m,
        rolling=roll_m,
        significance=sig,
        overfitting_score=overfit,
        stability_score=stability,
        trades_count=full_m.trades,
        feature_summary=feat_summary,
    )


def _verdict(
    oos: ResearchMetrics,
    wf: ResearchMetrics,
    overfit: float,
    sig: SignificanceResult,
    config: AlphaConfig,
) -> tuple[AlphaStatus, str]:
    if oos.trades < config.min_trades_oos:
        return AlphaStatus.REJECTED_INSUFFICIENT_TRADES, f"OOS trades {oos.trades} < {config.min_trades_oos}"
    if oos.expectancy_pct <= 0:
        return AlphaStatus.REJECTED_NEGATIVE_OOS, f"Negative OOS expectancy ({oos.expectancy_pct:.4f}%)"
    if oos.profit_factor <= 1.0:
        return AlphaStatus.REJECTED_NEGATIVE_OOS, f"OOS profit factor {oos.profit_factor:.3f} <= 1"
    if oos.sharpe_ratio <= 0:
        return AlphaStatus.REJECTED_NEGATIVE_OOS, "Non-positive OOS Sharpe"
    if overfit >= config.max_overfitting_score:
        return AlphaStatus.REJECTED_OVERFIT, f"Overfitting score {overfit:.2f} >= {config.max_overfitting_score}"
    if wf.stability_score < config.min_walk_forward_stability:
        return AlphaStatus.REJECTED_UNSTABLE, f"Walk-forward stability {wf.stability_score:.1f}% < {config.min_walk_forward_stability}%"
    if not sig.significant:
        return AlphaStatus.REJECTED_NEGATIVE_OOS, f"OOS returns not statistically significant (p={sig.p_value:.3f})"
    return AlphaStatus.ACCEPTED, "All acceptance criteria met — candidate for strategy integration"

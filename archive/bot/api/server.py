"""HTTP API for unified trading bot."""

from __future__ import annotations

import json
from typing import Any

from aiohttp import web

from core.config import StrategyName, TradingMode


def create_app(bot: Any) -> web.Application:
    app = web.Application()

    async def health(_: web.Request) -> web.Response:
        return web.json_response({"ok": True, "running": bot.running})

    async def status(_: web.Request) -> web.Response:
        return web.json_response(bot.get_status())

    async def trades(request: web.Request) -> web.Response:
        limit = int(request.query.get("limit", "50"))
        strategy = request.query.get("strategy")
        return web.json_response({"trades": bot.repo.list_trades(limit, strategy=strategy)})

    async def analytics(request: web.Request) -> web.Response:
        strategy = request.query.get("strategy")
        limit = int(request.query.get("limit", "500"))
        return web.json_response(bot.get_analytics(strategy=strategy, limit=limit))

    async def trade_detail(request: web.Request) -> web.Response:
        trade_id = request.match_info.get("trade_id", "")
        trade = bot.repo.get_trade(trade_id)
        if not trade:
            return web.json_response({"error": "not found"}, status=404)
        return web.json_response({"trade": trade})

    async def positions(_: web.Request) -> web.Response:
        return web.json_response({"positions": bot.get_positions()})

    async def start(_: web.Request) -> web.Response:
        await bot.start()
        return web.json_response({"ok": True, "message": "started"})

    async def stop(_: web.Request) -> web.Response:
        await bot.stop()
        return web.json_response({"ok": True, "message": "stopped"})

    async def mode(request: web.Request) -> web.Response:
        body = await request.json() if request.can_read_body else {}
        mode = body.get("mode")
        strategy = body.get("strategy")
        if mode:
            bot.settings.trading_mode = TradingMode(mode)
        if strategy:
            bot.set_active_strategy(StrategyName(strategy))
        return web.json_response({"ok": True, "mode": bot.settings.trading_mode.value, "strategy": bot.active_strategy_name})

    async def config_update(request: web.Request) -> web.Response:
        body = await request.json()
        bot.update_config(body)
        return web.json_response({"ok": True, "config": bot.get_config_snapshot()})

    app.router.add_get("/health", health)
    app.router.add_get("/status", status)
    app.router.add_get("/trades", trades)
    app.router.add_get("/analytics", analytics)
    app.router.add_get("/trades/{trade_id}", trade_detail)
    app.router.add_get("/positions", positions)
    app.router.add_post("/start", start)
    app.router.add_post("/stop", stop)
    app.router.add_post("/mode", mode)
    app.router.add_post("/config", config_update)
    return app


async def run_server(bot: Any, host: str, port: int) -> web.AppRunner:
    app = create_app(bot)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    return runner

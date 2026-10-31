#!/usr/bin/env python3
"""
Health watch for the site (installed as /usr/local/sbin/cryptoanalysis-health by deploy/install.sh,
timer cryptoanalysis-health.timer, every 5 minutes).

Checks that the site answers locally and at its public address, market data is fresh, the Telegram bot
reaches Telegram, the last self-update and backup worked, and disk and memory are not running out. A check
that fails twice in a row is reported to the owner's Telegram chat once; its recovery is reported too.
State lives in /var/lib/cryptoanalysis-health/state.json. Runs as root; standard library only.
"""

import json
import os
import shutil
import subprocess
import time
import urllib.parse
import urllib.request

APP_DIR = "/opt/cryptoanalysis"
ENV_FILE = f"{APP_DIR}/.env"
STATE_FILE = "/var/lib/cryptoanalysis-health/state.json"
BACKUPS = "/opt/cryptoanalysis-data/backups"
FAIL_AFTER = 2  # consecutive failed runs before an alert


def env() -> dict:
    out = {}
    try:
        for line in open(ENV_FILE, encoding="utf-8"):
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.rstrip("\n").split("=", 1)
                out[k.strip()] = v.strip()
    except OSError:
        pass
    return out


def http_status(url: str, timeout: int = 15) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": "cryptoanalysis-health"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def sh(cmd: list[str]) -> str:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=60).stdout.strip()


def checks(e: dict) -> dict:
    """name -> (ok, detail)"""
    now = time.time()
    port = e.get("APP_PORT", "3100")
    res = {}

    code = http_status(f"http://127.0.0.1:{port}/login")
    res["сайт на сервере"] = (code == 200, f"/login ответил {code or 'ничем'}")

    site = e.get("SITE_URL")
    if site:
        code = http_status(f"{site.rstrip('/')}/login")
        res["сайт снаружи"] = (code == 200, f"{site} ответил {code or 'ничем'}")

    last = sh(["mysql", "-N", "cryptoanalysis", "-e", "SELECT COALESCE(MAX(ts), 0) FROM market_metrics_5m"])
    age_min = (now - int(last or 0) / 1000) / 60 if last.isdigit() else 1e9
    res["сбор данных"] = (age_min < 25, f"последние данные {age_min:.0f} мин назад")

    try:
        h = json.load(open(f"{APP_DIR}/.cache/telegram-health.json"))
        failing = h.get("failures", 0) > 0 and (h.get("lastErrorAt") or 0) > (h.get("lastOkAt") or 0)
        quiet_min = (now - (h.get("lastOkAt") or 0) / 1000) / 60
        res["связь с Telegram"] = (not (failing and quiet_min > 15), f"нет связи {quiet_min:.0f} мин: {h.get('lastError') or ''}"[:200])
    except (OSError, ValueError):
        pass

    if os.path.exists("/etc/systemd/system/cryptoanalysis-autoupdate.service"):
        state = sh(["systemctl", "is-failed", "cryptoanalysis-autoupdate.service"])
        res["автообновление"] = (state != "failed", "последний запуск упал: journalctl -u cryptoanalysis-autoupdate")

    latest = os.path.join(BACKUPS, "latest.sql.gz")
    if os.path.exists(BACKUPS):
        age_h = (now - os.path.getmtime(latest)) / 3600 if os.path.exists(latest) else 1e9
        res["резервная копия"] = (age_h < 30, f"последняя {age_h:.0f} ч назад" if age_h < 1e8 else "копий нет")

    du = shutil.disk_usage("/")
    res["место на диске"] = (du.free / du.total > 0.08, f"свободно {du.free / 2**30:.1f} ГБ")

    mem = {}
    for line in open("/proc/meminfo"):
        k, v = line.split(":", 1)
        mem[k] = int(v.split()[0])
    avail_mb = mem.get("MemAvailable", 0) / 1024
    res["память"] = (avail_mb > 120, f"доступно {avail_mb:.0f} МБ")
    return res


def telegram(e: dict):
    token, chat = e.get("TELEGRAM_BOT_TOKEN"), e.get("TELEGRAM_CHAT_ID")
    if not (token and chat):
        try:
            c = json.load(open(f"{APP_DIR}/.cache/telegram.json"))
            token, chat = c.get("token"), c.get("chatId")
        except (OSError, ValueError):
            return None
    return (token, chat) if token and chat else None


def send(cfg, text: str) -> bool:
    token, chat = cfg
    data = urllib.parse.urlencode({"chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": "true"}).encode()
    try:
        with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", data=data, timeout=20) as r:
            return r.status == 200
    except Exception:
        return False


def main():
    e = env()
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    try:
        state = json.load(open(STATE_FILE))
    except (OSError, ValueError):
        state = {}
    cfg = telegram(e)
    messages = []
    newly_alerted = []
    for name, (ok, detail) in checks(e).items():
        s = state.get(name, {"fails": 0, "alerted": False})
        if ok:
            if s.get("alerted"):
                messages.append(f"✅ {name}: снова в порядке")
            s = {"fails": 0, "alerted": False}
        else:
            s["fails"] = s.get("fails", 0) + 1
            if s["fails"] >= FAIL_AFTER and not s.get("alerted"):
                messages.append(f"🚨 {name}: {detail}")
                s["alerted"] = True
                newly_alerted.append(name)
        state[name] = s
        print(f"{'ok ' if ok else 'BAD'} {name}: {detail}")
    if messages:
        text = "<b>CryptoPredict: сторож</b>\n" + "\n".join(messages)
        # An alert that could not be delivered is retried on the next run.
        if not (cfg and send(cfg, text)):
            for name in newly_alerted:
                state[name]["alerted"] = False
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, ensure_ascii=False)


if __name__ == "__main__":
    main()

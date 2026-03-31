"""
MA921 Telegram Notification Module
======================================
Sends real-time trading alerts to Telegram.
Free to use — no API costs, no rate limits for personal bots.
"""
import requests
import datetime
from typing import Optional

# ── Configuration ────────────────────────────────────────────────────────────
TELEGRAM_TOKEN   = "***REDACTED***"
TELEGRAM_CHAT_ID = ""   # ← will be set once user sends /start to the bot

BASE_URL = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"

def _send(text: str, parse_mode: str = "Markdown") -> bool:
    """Low-level send — returns True on success."""
    if not TELEGRAM_CHAT_ID:
        print("[TELEGRAM] ⚠️  CHAT_ID not set — skipping notification")
        return False
    try:
        resp = requests.post(
            f"{BASE_URL}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": parse_mode},
            timeout=5
        )
        if resp.status_code == 200:
            return True
        else:
            print(f"[TELEGRAM] ❌ Failed ({resp.status_code}): {resp.text}")
            return False
    except Exception as e:
        print(f"[TELEGRAM] ❌ Exception: {e}")
        return False


def notify_trade_open(direction: str, price: float, size: float, balance: float):
    """Fire when a position opens."""
    emoji = "🟢" if direction == "LONG" else "🔴"
    now   = datetime.datetime.now().strftime("%H:%M:%S IST")
    text  = (
        f"{emoji} *TRADE OPENED*\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"📊 Pair:      `XAUUSD`\n"
        f"📈 Direction: `{direction}`\n"
        f"💰 Entry:     `${price:,.2f}`\n"
        f"📦 Size:      `{size:.4f}`\n"
        f"💼 Balance:   `${balance:,.2f}`\n"
        f"🕐 Time:      `{now}`\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"_MA921 Engine_"
    )
    _send(text)


def notify_trade_close(direction: str, entry: float, exit_price: float, pnl: float, balance: float, reason: str = "SIGNAL"):
    """Fire when a position closes."""
    pnl_emoji = "✅" if pnl >= 0 else "❌"
    pnl_str   = f"+${pnl:,.2f}" if pnl >= 0 else f"-${abs(pnl):,.2f}"
    now       = datetime.datetime.now().strftime("%H:%M:%S IST")
    text      = (
        f"{pnl_emoji} *TRADE CLOSED*\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"📊 Pair:      `XAUUSD`\n"
        f"📈 Direction: `{direction}`\n"
        f"🔵 Entry:     `${entry:,.2f}`\n"
        f"🔴 Exit:      `${exit_price:,.2f}`\n"
        f"💵 PnL:       `{pnl_str}`\n"
        f"💼 Balance:   `${balance:,.2f}`\n"
        f"🔖 Reason:    `{reason}`\n"
        f"🕐 Time:      `{now}`\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"_MA921 Engine_"
    )
    _send(text)


def notify_ma_crossover(direction: str, price: float, ma9: float, ma21: float):
    """Fire on MA9/MA21 crossover."""
    if direction == "bullish":
        emoji, label = "🔼", "Bullish Crossover"
    else:
        emoji, label = "🔽", "Bearish Crossover"
    now = datetime.datetime.now().strftime("%H:%M:%S IST")
    text = (
        f"{emoji} *MA CROSSOVER — {label}*\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"📊 Pair:   `XAUUSD`\n"
        f"💰 Price:  `${price:,.2f}`\n"
        f"📉 MA9:    `${ma9:,.2f}`\n"
        f"📈 MA21:   `${ma21:,.2f}`\n"
        f"🕐 Time:   `{now}`\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"_MA921 Engine_"
    )
    _send(text)


def notify_engine_status(armed: bool):
    """Fire when engine is armed/disarmed."""
    emoji = "⚡" if armed else "🛑"
    status = "ARMED" if armed else "STOPPED"
    now = datetime.datetime.now().strftime("%H:%M:%S IST")
    text = (
        f"{emoji} *Engine {status}*\n"
        f"🕐 `{now}`\n"
        f"_MA921 — XAUUSD Strategy_"
    )
    _send(text)


def notify_daily_summary(balance: float, initial: float, total_trades: int, win_rate: float, net_pnl: float):
    """Daily P&L summary."""
    ret_pct = ((balance - initial) / initial) * 100 if initial > 0 else 0
    emoji = "📈" if net_pnl >= 0 else "📉"
    now = datetime.datetime.now().strftime("%d %b %Y")
    text = (
        f"{emoji} *Daily Summary — {now}*\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"💼 Balance:      `${balance:,.2f}`\n"
        f"💵 Net PnL:      `{'+'if net_pnl>=0 else ''}${net_pnl:,.2f}`\n"
        f"📊 Return:       `{ret_pct:+.2f}%`\n"
        f"🔢 Total Trades: `{total_trades}`\n"
        f"🎯 Win Rate:     `{win_rate:.1f}%`\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"_MA921 Engine_"
    )
    _send(text)


def send_test_message():
    """Send a test ping to verify the bot is working."""
    text = (
        "✅ *MA921 Bot Connected!*\n"
        "━━━━━━━━━━━━━━━━━\n"
        "Your trading alerts are now live.\n"
        "You will receive notifications for:\n"
        "• 🟢 Trade opens\n"
        "• 🔴 Trade closes with P&L\n"
        "• 🔔 MA9/MA21 crossovers\n"
        "• 📈 Daily summary\n"
        "━━━━━━━━━━━━━━━━━\n"
        "_MA921 — XAUUSD Strategy_"
    )
    return _send(text)


def get_chat_id() -> Optional[int]:
    """Auto-fetch the chat_id from the latest /getUpdates response."""
    try:
        resp = requests.get(f"{BASE_URL}/getUpdates", timeout=5)
        data = resp.json()
        results = data.get("result", [])
        if results:
            return results[-1]["message"]["chat"]["id"]
    except Exception as e:
        print(f"[TELEGRAM] getUpdates error: {e}")
    return None

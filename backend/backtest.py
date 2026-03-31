"""
backtest.py  —  AquaFlow Backtesting Engine (v4)
=================================================
ALL timeframes now use 1-minute candles for maximum MA precision.
yfinance provides up to 7 days of 1m GC=F data for free.

Period → how far back to look (capped at 7d since that's max 1m data):
  1H  =  last 1 hour of 1m candles
  5H  =  last 5 hours
  12H =  last 12 hours
  1D  =  last 1 day  (24h)
  2D  =  last 2 days
  3D  =  last 3 days
  5D  =  last 5 days
  7D  =  all available 1m data (~7 days)
"""

import pandas as pd
import yfinance as yf
import datetime
from strategy import GoldStrategy

SPREAD   = 0.30
SLIPPAGE = 0.05
RISK_PCT = 0.02
INIT_BAL = 10_000.0

# ── Period → lookback config ───────────────────────────────────────────────────
# All use 1m candles. hours=None means use everything yfinance gives (≈7d).
PERIOD_MAP = {
    "1H":  {"hours": 1,    "label": "1 Hour"},
    "5H":  {"hours": 5,    "label": "5 Hours"},
    "12H": {"hours": 12,   "label": "12 Hours"},
    "1D":  {"hours": 24,   "label": "1 Day"},
    "2D":  {"hours": 48,   "label": "2 Days"},
    "3D":  {"hours": 72,   "label": "3 Days"},
    "5D":  {"hours": 120,  "label": "5 Days"},
    "7D":  {"hours": None, "label": "7 Days (max 1m)"},
}


def run_backtest(period: str = "1D") -> dict:
    cfg = PERIOD_MAP.get(period, PERIOD_MAP["1D"])
    hours = cfg["hours"]

    # ── 1. Fetch up to 7 days of 1m data ──────────────────────────────────────
    ticker = yf.Ticker("GC=F")
    df = ticker.history(period="7d", interval="1m")

    if df is None or df.empty:
        return {"error": "No 1m data returned from yfinance for GC=F."}

    df.index = pd.to_datetime(df.index, utc=True)
    df = df.dropna(subset=["Close"])

    # ── 2. Slice to requested lookback ────────────────────────────────────────
    if hours is not None:
        cutoff = df.index[-1] - pd.Timedelta(hours=hours)
        df = df[df.index >= cutoff]

    if df.empty:
        return {"error": f"No data in the last {hours}h window. Try a wider period."}

    # ── 3. Replay strategy bar-by-bar on 1m candles ───────────────────────────
    strategy    = GoldStrategy()
    balance     = INIT_BAL
    position    = None
    entry_price = 0.0
    entry_time  = None
    entry_unix  = 0
    size        = 0.0
    unrealized  = 0.0

    trades        = []
    equity_curve  = []
    candle_data   = []
    ma9_data, ma21_data, ma50_data, ma200_data = [], [], [], []
    trade_markers = []

    for ts, row in df.iterrows():
        o  = round(float(row["Open"]),  2)
        h  = round(float(row["High"]),  2)
        l  = round(float(row["Low"]),   2)
        c  = round(float(row["Close"]), 2)
        unix_ts = int(ts.timestamp())

        candle_data.append({"time": unix_ts, "open": o, "high": h, "low": l, "close": c})

        result = strategy.update(c, high=h, low=l, emit_signal=True)

        if result is None:
            equity_curve.append({"time": unix_ts, "value": round(balance, 2)})
            continue

        signal = result["signal"]
        ma9    = round(result["ma9"],   2)
        ma21   = round(result["ma21"],  2)
        ma50   = round(result["ma50"],  2)
        ma200  = round(result["ma200"], 2)

        ma9_data.append(  {"time": unix_ts, "value": ma9})
        ma21_data.append( {"time": unix_ts, "value": ma21})
        ma50_data.append( {"time": unix_ts, "value": ma50})
        ma200_data.append({"time": unix_ts, "value": ma200})

        # ── Close ─────────────────────────────────────────────────────────────
        if position and signal in ("EXIT", "BUY", "SELL"):
            should_close = (
                signal == "EXIT"
                or (position == "LONG"  and signal == "SELL")
                or (position == "SHORT" and signal == "BUY")
            )
            if should_close:
                exit_p = (c - SPREAD/2 - SLIPPAGE) if position == "LONG" else (c + SPREAD/2 + SLIPPAGE)
                pnl    = ((exit_p - entry_price) * size) if position == "LONG" else ((entry_price - exit_p) * size)
                balance += pnl
                trades.append({
                    "entry_time":  entry_time.isoformat() if entry_time else "",
                    "exit_time":   ts.isoformat(),
                    "entry_unix":  entry_unix,
                    "exit_unix":   unix_ts,
                    "direction":   position,
                    "entry_price": round(entry_price, 2),
                    "exit_price":  round(exit_p, 2),
                    "pnl":         round(pnl, 4),
                    "balance":     round(balance, 4),
                    "size":        round(size, 6),
                })
                is_win = pnl >= 0
                trade_markers.append({
                    "time":     unix_ts,
                    "position": "aboveBar" if position == "LONG" else "belowBar",
                    "color":    "#10b981" if is_win else "#ef4444",
                    "shape":    "circle",
                    "text":     f"{'+'if is_win else ''}${abs(pnl):.2f}",
                    "size":     1,
                })
                position    = None
                entry_price = 0.0
                entry_time  = None
                entry_unix  = 0
                size        = 0.0
                unrealized  = 0.0

        # ── Open ──────────────────────────────────────────────────────────────
        if position is None and signal in ("BUY", "SELL"):
            exec_p      = (c + SPREAD/2 + SLIPPAGE) if signal == "BUY" else (c - SPREAD/2 - SLIPPAGE)
            risk_amount = balance * RISK_PCT
            size        = risk_amount / exec_p if exec_p > 0 else 0
            position    = "LONG" if signal == "BUY" else "SHORT"
            entry_price = exec_p
            entry_time  = ts
            entry_unix  = unix_ts
            trade_markers.append({
                "time":     unix_ts,
                "position": "belowBar" if position == "LONG" else "aboveBar",
                "color":    "#22d3ee" if position == "LONG" else "#f87171",
                "shape":    "arrowUp" if position == "LONG" else "arrowDown",
                "text":     f"{'▲ BUY' if position == 'LONG' else '▼ SELL'} ${exec_p:.2f}",
                "size":     2,
            })

        # unrealized
        if position == "LONG":
            unrealized = (c - entry_price) * size
        elif position == "SHORT":
            unrealized = (entry_price - c) * size
        else:
            unrealized = 0.0

        equity_curve.append({"time": unix_ts, "value": round(balance + unrealized, 2)})

    # ── Close lingering ───────────────────────────────────────────────────────
    if position and not df.empty:
        last_c    = round(float(df["Close"].iloc[-1]), 2)
        last_ts   = df.index[-1]
        last_unix = int(last_ts.timestamp())
        exit_p    = (last_c - SPREAD/2 - SLIPPAGE) if position == "LONG" else (last_c + SPREAD/2 + SLIPPAGE)
        pnl       = ((exit_p - entry_price) * size) if position == "LONG" else ((entry_price - exit_p) * size)
        balance  += pnl
        trades.append({
            "entry_time":  entry_time.isoformat() if entry_time else "",
            "exit_time":   last_ts.isoformat(),
            "entry_unix":  entry_unix,
            "exit_unix":   last_unix,
            "direction":   position,
            "entry_price": round(entry_price, 2),
            "exit_price":  round(exit_p, 2),
            "pnl":         round(pnl, 4),
            "balance":     round(balance, 4),
            "size":        round(size, 6),
            "open_at_end": True,
        })
        is_win = pnl >= 0
        trade_markers.append({
            "time":     last_unix,
            "position": "aboveBar" if position == "LONG" else "belowBar",
            "color":    "#10b981" if is_win else "#ef4444",
            "shape":    "circle",
            "text":     f"END {'+'if is_win else ''}${abs(pnl):.2f}",
            "size":     1,
        })

    # ── Metrics ───────────────────────────────────────────────────────────────
    pnls   = [t["pnl"] for t in trades]
    wins   = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    pf     = (sum(wins) / abs(sum(losses))) if losses and sum(losses) else None

    eq_vals = [e["value"] for e in equity_curve]
    max_dd, peak = 0.0, INIT_BAL
    for v in eq_vals:
        if v > peak: peak = v
        dd = (peak - v) / peak * 100
        if dd > max_dd: max_dd = dd

    rets   = pd.Series(eq_vals).pct_change().dropna()
    sharpe = float(rets.mean() / rets.std() * (252 ** 0.5)) if len(rets) > 1 and rets.std() > 0 else 0.0

    return {
        "candle_data":    candle_data,
        "ma9_data":       ma9_data,
        "ma21_data":      ma21_data,
        "ma50_data":      ma50_data,
        "ma200_data":     ma200_data,
        "trade_markers":  trade_markers,
        "equity_curve":   equity_curve,
        "trades":         trades,
        "metrics": {
            "initial_balance":   INIT_BAL,
            "final_balance":     round(balance, 2),
            "total_pnl":         round(sum(pnls), 2),
            "total_return_pct":  round(sum(pnls) / INIT_BAL * 100, 2),
            "total_trades":      len(trades),
            "win_rate":          round(len(wins) / len(pnls) * 100, 1) if pnls else 0,
            "avg_win":           round(sum(wins)   / len(wins),   2) if wins   else 0,
            "avg_loss":          round(sum(losses) / len(losses), 2) if losses else 0,
            "profit_factor":     round(pf, 2) if pf else None,
            "max_drawdown_pct":  round(max_dd, 2),
            "sharpe_ratio":      round(sharpe, 3),
            "data_bars":         len(df),
        },
        "period":       period,
        "interval":     "1m",
        "period_label": cfg["label"],
    }

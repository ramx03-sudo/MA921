import asyncio
import requests
import json
import os
import datetime
from fastapi import FastAPI, WebSocket, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from strategy import GoldStrategy
from data_feed import DataFeed
from portfolio import Portfolio
from execution import Execution
from analytics import Analytics
from warmup import load_historical, load_historical_interval
from backtest import run_backtest
import telegram_bot as tg
import time
from typing import Optional, Dict
import database

ALLOW_LOCAL_STRATEGY = True  # 🛡️ ARMED: Backend can now execute its own signals

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

portfolio = Portfolio(initial_balance=10000.0, trade_size_pct=0.1)
execution = Execution(portfolio)
strategy = GoldStrategy()
broadcast_queue = asyncio.Queue()
portfolio.add_observer(broadcast_queue)

WEBHOOK_SECRET = "AQUA_FLOW_SECURE_777"
last_webhook_time = 0.0
strategy_active = True   # 🟢 Armed by default on startup
last_indicator_state: Dict[str, object] = {"ma9": None, "ma21": None, "ma50": None, "ma200": None}
basis_offset: float = 0.0  # GC=F futures vs OANDA spot basis — applied to BOTH history and live ticks

# 🔔 MA crossover tracking for Telegram alerts (prevent duplicate alerts)
_prev_ma9_above_ma21: Optional[bool] = None

class SignalInput(BaseModel):
    id: str
    action: str
    ticker: str
    price: float
    secret: str
    timestamp: Optional[int] = None

class CandleBuilder:
    def __init__(self, interval=60):
        self.interval = interval
        self.current = None

    def add_tick(self, price: float, ts: int):
        """
        🎯 CORE FIX: Use the feed timestamp for deterministic bucketing.
        Ensures O/H/L/C matches external charts perfectly.
        Returns (current_candle, closed_candle)
        """
        bucket = ts - (ts % self.interval)
        closed_candle = None

        if self.current and self.current["time"] != bucket:
            closed_candle = self.current.copy()

        if not self.current or self.current["time"] != bucket:
            self.current = {
                "time": bucket,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "timestamp": float(bucket)
            }
        else:
            self.current["high"] = round(max(self.current["high"], price), 4)
            self.current["low"]  = round(min(self.current["low"],  price), 4)
            self.current["close"] = price

        return self.current, closed_candle


candle_builder = CandleBuilder(interval=60)
chart_snapshot_buffer: list = []
active_connections: list = []
basis_calibrated = False   # True after first live tick calibrates the snapshot price scale


async def process_tick(bid: float, ask: float, ts: int):
    global last_indicator_state, basis_offset, basis_calibrated, chart_snapshot_buffer, _prev_ma9_above_ma21

    # Finnhub delivers OANDA spot prices directly — no offset needed
    mid = round((bid + ask) / 2.0, 4)

    # 🎯 FIRST-TICK CALIBRATION: on the very first live tick, measure the gap between
    # the yfinance GC=F (futures) history and the actual OANDA spot price, then shift
    # all historical snapshot candles, MAs, and strategy price buffer by that amount.
    if not basis_calibrated and chart_snapshot_buffer:
        basis_calibrated = True
        hist_last = float(chart_snapshot_buffer[-1]["close"])
        computed_offset = round(mid - hist_last, 4)
        if abs(computed_offset) > 0.5:   # only apply if gap is meaningful (>0.5 pts)
            basis_offset = computed_offset
            print(f"[CALIBRATE] 📐 First-tick basis: {basis_offset:+.2f} (hist last={hist_last:.2f} → spot={mid:.2f})")
            def _shift(v, o):
                return round(v + o, 4) if isinstance(v, (int, float)) and v else v

            # 1️⃣ Shift all snapshot candles so chart history is at spot level
            for c in chart_snapshot_buffer:
                for key in ("open", "high", "low", "close", "price", "ma9", "ma21", "ma50", "ma200"):
                    if c.get(key) is not None:
                        c[key] = _shift(c[key], basis_offset)

            # 2️⃣ Shift last_indicator_state so MA legend shows correct values
            for key in ("ma9", "ma21", "ma50", "ma200"):
                if last_indicator_state.get(key) is not None:
                    last_indicator_state[key] = _shift(last_indicator_state[key], basis_offset)

            # 3️⃣ CRITICAL: Shift strategy's internal price buffer so future MA calculations
            #    use the spot-level baseline — prevents MA spike on first closed candle
            strategy.prices = [_shift(p, basis_offset) for p in strategy.prices]
            strategy.highs  = [_shift(h, basis_offset) for h in strategy.highs]
            strategy.lows   = [_shift(l, basis_offset) for l in strategy.lows]
            print(f"[CALIBRATE] ✅ Strategy buffer shifted ({len(strategy.prices)} bars) — MAs will be continuous")

            # 4️⃣ Re-broadcast corrected snapshot to all connected clients
            await broadcast_queue.put({"event": "SNAPSHOT", "data": chart_snapshot_buffer})

            # 5️⃣ ARM ENTRY: join any trend that was already running before server started
            if strategy_active:
                arm_signal = strategy.should_enter_now()
                if arm_signal:
                    print(f"  🚀 [ARM] Joining existing trend — executing {arm_signal} @ {mid:.2f}")
                    await execution.execute_trade(arm_signal, mid, "XAUUSD")
        else:
            print(f"[CALIBRATE] Gap is {computed_offset:+.2f} — no shift needed")
            # Even with no basis shift, check if we should enter based on current MA state
            if strategy_active:
                arm_signal = strategy.should_enter_now()
                if arm_signal:
                    print(f"  🚀 [ARM] Joining existing trend — executing {arm_signal} @ {mid:.2f}")
                    await execution.execute_trade(arm_signal, mid, "XAUUSD")


    pos_str = str(portfolio.position.value if hasattr(portfolio.position, 'value') else portfolio.position) if portfolio.position else None
    liq = bid if pos_str == "LONG" else ask if pos_str == "SHORT" else mid
    await portfolio.update_tick(liq)

    # 🎯 Update internal candle and extract closed one for strategy
    curr_c, closed_c = candle_builder.add_tick(mid, ts)
    
    # 🔥 CANDLE-CLOSE: Run strategy ONLY on full closed candles for accurate MA computation
    if closed_c:
        # 🎯 KEY FIX: only allow strategy to mutate self.position when the engine is armed.
        # When stopped, we still compute MAs (for display) but don't change internal state.
        result = strategy.update(
            closed_c["close"],
            closed_c["high"],
            closed_c["low"],
            emit_signal=strategy_active  # ✅ was ALLOW_LOCAL_STRATEGY (always True) — caused ghost positions
        )
        if result:
            sig = result.get("signal")
            last_indicator_state = {
                "ma9":   round(result["ma9"],   4) if result.get("ma9")   else None,
                "ma21":  round(result["ma21"],  4) if result.get("ma21")  else None,
                "ma50":  round(result["ma50"],  4) if result.get("ma50")  else None,
                "ma200": round(result["ma200"], 4) if result.get("ma200") else None,
                "signal": sig
            }

            # ── Verbose candle-close diagnostics ──────────────────────────────
            m9, m21, m50, m200 = result["ma9"], result["ma21"], result["ma50"], result["ma200"]
            trend = "BULL" if m50 > m200 else "BEAR"
            pos   = strategy.position or "FLAT"
            armed = "ARMED" if strategy_active else "STOPPED"
            print(
                f"[CLOSE] c={closed_c['close']:.2f} | "
                f"MA9={m9:.2f} MA21={m21:.2f} MA50={m50:.2f} MA200={m200:.2f} | "
                f"trend={trend} pos={pos} sig={sig or '-'} engine={armed}"
            )
            if not strategy_active:
                ma9_above = m9 > m21
                print(f"  ⏳ STOPPED | MA9>MA21={ma9_above} trend={trend} — waiting for Start")
            elif sig and strategy_active:
                print(f"  🤖 Executing {sig} @ {closed_c['close']:.2f}")
            elif pos == "FLAT" and strategy_active:
                ma9_above = m9 > m21
                print(f"  ⏳ Waiting | MA9>MA21={ma9_above} | trend={trend} | need crossover signal")
            # ──────────────────────────────────────────────────────────────────

            # 🔔 TELEGRAM: MA9/MA21 crossover alert (fires once per crossover)
            ma9_now_above = m9 > m21
            if _prev_ma9_above_ma21 is not None and ma9_now_above != _prev_ma9_above_ma21:
                direction = "bullish" if ma9_now_above else "bearish"
                asyncio.get_event_loop().run_in_executor(
                    None, tg.notify_ma_crossover, direction, closed_c["close"], m9, m21
                )
                print(f"  🔔 [TELEGRAM] MA crossover alert → {direction}")
            _prev_ma9_above_ma21 = ma9_now_above

            # 🤖 Execute trade on candle close
            if sig and strategy_active:
                await execution.execute_trade(sig, closed_c["close"], "XAUUSD")
        else:
            last_indicator_state["signal"] = None
            print(f"[CLOSE] c={closed_c['close']:.2f} | Priming MAs ({len(strategy.prices)}/201 bars)")



    current_ts = int(curr_c["timestamp"])
    payload = {
        "time": current_ts, "price": mid, "bid": round(bid, 4), "ask": round(ask, 4),
        "open": curr_c["open"], "high": curr_c["high"], "low": curr_c["low"], "close": curr_c["close"],
        **{k: v for k, v in last_indicator_state.items() if k != 'signal'}
    }

    if chart_snapshot_buffer and chart_snapshot_buffer[-1]["time"] == current_ts:
        chart_snapshot_buffer[-1] = payload
    else:
        chart_snapshot_buffer.append(payload)
        if len(chart_snapshot_buffer) > 5000:
            chart_snapshot_buffer.pop(0)

    await broadcast_queue.put({"event": "PRICE", "data": payload})


data_feed = DataFeed(process_tick)


async def broadcaster():
    while True:
        msg = await broadcast_queue.get()
        event = msg.get("event")

        if event == "TRADE":
            # After a trade: push TRADE + fresh PORTFOLIO + ANALYTICS to all clients
            portfolio_payload = portfolio.get_state()
            analytics_payload = Analytics.calculate_metrics(
                portfolio.trade_history, portfolio.initial_balance, portfolio.balance
            )
            for conn in list(active_connections):
                try:
                    await conn.send_json(msg)
                    await conn.send_json({"event": "PORTFOLIO", "data": portfolio_payload})
                    await conn.send_json({"event": "ANALYTICS", "data": analytics_payload})
                except Exception:
                    if conn in active_connections:
                        active_connections.remove(conn)

            # 🔔 TELEGRAM: Fire trade notification in background
            trade_data = msg.get("data", {})
            action = trade_data.get("action", "")
            loop = asyncio.get_event_loop()
            if action.startswith("OPEN"):
                direction = "LONG" if "LONG" in action else "SHORT"
                loop.run_in_executor(None, tg.notify_trade_open,
                    direction,
                    float(trade_data.get("price", 0)),
                    float(trade_data.get("size", 0)),
                    float(trade_data.get("balance", 0))
                )
            elif action.startswith("CLOSE"):
                direction = "LONG" if "LONG" in action else "SHORT"
                loop.run_in_executor(None, tg.notify_trade_close,
                    direction,
                    float(trade_data.get("entry", 0)),
                    float(trade_data.get("exit", 0)),
                    float(trade_data.get("pnl", 0)),
                    float(trade_data.get("balance", 0)),
                    trade_data.get("reason", "SIGNAL")
                )
        else:
            # All other events (PRICE, PORTFOLIO, SNAPSHOT, etc.) — broadcast as-is
            for conn in list(active_connections):
                try:
                    await conn.send_json(msg)
                except Exception:
                    if conn in active_connections:
                        active_connections.remove(conn)



@app.on_event("startup")
async def startup_event():
    global chart_snapshot_buffer, last_indicator_state, basis_offset, basis_calibrated
    basis_calibrated = False   # reset so first live tick re-calibrates the price scale

    try:
        history = await asyncio.get_event_loop().run_in_executor(None, load_historical, strategy, 5000)
    except Exception as e:
        print(f"🔥 WARMUP FAILED: {e}")
        history = []

    # ── 🎯 BASIS OFFSET: Align yfinance GC=F (futures) history down to Finnhub OANDA spot level ──
    # GC=F trades at a ~$25-35 premium over OANDA XAU/USD spot.
    # basis_offset = Finnhub_spot_now - yfinance_GCF_hist_last  (will be negative, ~-30)
    # Applied to ALL historical candles so they land on the same scale as live Finnhub ticks.
    # Live ticks: NO offset (Finnhub already delivers OANDA spot prices directly).
    if history:
        def _fetch_spot_price() -> float:
            api_key  = "d73p9fpr01qjjol3rhp0d73p9fpr01qjjol3rhpg"
            rest_url = f"https://finnhub.io/api/v1/quote?symbol=OANDA:XAU_USD&token={api_key}"
            try:
                resp = requests.get(rest_url, timeout=5)
                if resp.status_code == 200:
                    return float(resp.json().get("c", 0))
            except Exception:
                pass
            return 0.0

        try:
            spot_price = await asyncio.get_event_loop().run_in_executor(None, _fetch_spot_price)
            hist_last  = float(history[-1]["close"])
            if spot_price > 0 and hist_last > 0:
                basis_offset = round(spot_price - hist_last, 4)
                print(f"[STARTUP] 📐 Futures→Spot basis offset: {basis_offset:+.2f} (GC=F last={hist_last:.2f} → OANDA spot={spot_price:.2f})")
            else:
                print(f"[STARTUP] ⚠️  Finnhub spot returned 0 — basis offset stays 0")
        except Exception as e:
            print(f"[STARTUP] ⚠️  Could not fetch Finnhub spot for basis: {e}")

    pure_history = []
    for h in history:
        if "open" in h and "close" in h:
            # Apply offset to all price fields and MA values
            adj = lambda v: round(v + basis_offset, 4) if v is not None else None
            ind = {
                "ma9":   adj(h.get("ma9")),
                "ma21":  adj(h.get("ma21")),
                "ma50":  adj(h.get("ma50")),
                "ma200": adj(h.get("ma200")),
            }
            if ind.get("ma9"):
                last_indicator_state = ind
            pure_history.append({
                "time":  h.get("time") or h.get("timestamp"),
                "open":  adj(h["open"]),
                "high":  adj(h["high"]),
                "low":   adj(h["low"]),
                "close": adj(h["close"]),
                "price": adj(h["close"]),
                **ind
            })

    chart_snapshot_buffer = pure_history[-500:]
    
    # 🎯 VITAL STATE SYNC: Ensure strategy matches portfolio on start
    # If portfolio is flat, strategy must be flat too (prevents ghost positions from warmup)
    if portfolio.position is None:
        strategy.position = None
        strategy.entry_price = 0.0
    else:
        # If we have a real open position in DB, restore it to strategy
        strategy.position = "long" if portfolio.position == "LONG" else "short"
        strategy.entry_price = portfolio.entry_price

    asyncio.create_task(broadcaster())
    asyncio.create_task(data_feed.start())

    # 🔔 TELEGRAM: Auto-fetch chat_id and send startup ping
    def _init_telegram():
        chat_id = tg.get_chat_id()
        if chat_id:
            tg.TELEGRAM_CHAT_ID = str(chat_id)
            print(f"[TELEGRAM] ✅ Chat ID fetched: {chat_id}")
            tg.send_test_message()
        else:
            print("[TELEGRAM] ⚠️  No chat_id found — open @ma921trading_bot and send /start")
    asyncio.get_event_loop().run_in_executor(None, _init_telegram)


@app.post("/api/webhook/signal")
async def external_signal_webhook(signal: SignalInput):
    print(f"🔥 SIGNAL RECEIVED: {signal.dict()}")

    if signal.secret != WEBHOOK_SECRET:
        database.log_webhook(signal.action, signal.ticker, signal.price, "UNAUTHORIZED")
        raise HTTPException(status_code=401, detail="Unauthorized")

    # 🎯 PER-SIGNAL IDEMPOTENCY
    if database.is_order_processed(signal.id):
        print(f"⚠️  Order {signal.id} already processed — ignoring")
        return {"status": "duplicate ignored"}

    # 🎯 MONOTONICITY CHECK
    sig_ts = signal.timestamp or int(time.time())
    if sig_ts < portfolio.last_signal_ts:
        print(f"⚠️  Stale signal received (current: {portfolio.last_signal_ts}, got: {sig_ts}) — ignoring")
        database.log_webhook(signal.action, signal.ticker, signal.price, "STALE_IGNORED")
        return {"status": "stale ignored"}
    
    portfolio.last_signal_ts = sig_ts
    database.log_order(signal.id, signal.action, signal.price, sig_ts)

    action = signal.action.upper()
    if action == "LONG":  action = "BUY"
    if action == "SHORT": action = "SELL"

    if action not in ["BUY", "SELL", "EXIT"]:
        database.log_webhook(signal.action, signal.ticker, signal.price, "INVALID_ACTION")
        return {"status": "ignored", "reason": f"unknown action {action}"}

    database.log_webhook(action, signal.ticker, signal.price, "EXECUTED")
    await execution.execute_trade(action, signal.price, signal.ticker)

    # Push a chart marker so the signal shows on the candle chart
    await broadcast_queue.put({
        "event": "PRICE",
        "data": {"time": int(time.time()), "signal": action, "price": signal.price}
    })

    return {"status": "executed", "portfolio": portfolio.get_state()}


@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)

    # Send full candle history on connect (all bars, all with valid MAs)
    await websocket.send_json({"event": "SNAPSHOT", "data": chart_snapshot_buffer})
    await websocket.send_json({"event": "PORTFOLIO", "data": portfolio.get_state()})

    # Replay all historical trade events so execution log is populated
    for t in database.load_trade_history():
        await websocket.send_json({"event": "TRADE", "data": t})

    # Send current analytics
    await websocket.send_json({
        "event": "ANALYTICS",
        "data": Analytics.calculate_metrics(portfolio.trade_history, portfolio.initial_balance, portfolio.balance)
    })

    try:
        while True:
            await websocket.receive_text()
    except Exception:
        if websocket in active_connections:
            active_connections.remove(websocket)


# ── REST endpoints ──────────────────────────────────────────────────────────

@app.get("/api/portfolio")
async def get_portfolio():
    return portfolio.get_state()

@app.get("/api/trades")
async def get_trades():
    closed_trades = database.load_trade_history()
    
    # 🎯 Include the currently active position if one is open
    if portfolio.position:
        pos_str = str(portfolio.position.value if hasattr(portfolio.position, 'value') else portfolio.position)
        active_trade = {
            "time": "NOW",
            "action": f"OPEN {pos_str}",
            "price": float(portfolio.entry_price),
            "exit": "RUNNING",
            "pnl": float(portfolio.unrealized_pnl),
            "size": float(portfolio.position_size),
            "status": "ACTIVE"
        }
        return {"trades": [active_trade] + [dict(t) for t in closed_trades[::-1]]}
        
    return {"trades": closed_trades[::-1]}

@app.get("/api/analytics")
async def get_analytics():
    return Analytics.calculate_metrics(portfolio.trade_history, portfolio.initial_balance, portfolio.balance)

@app.get("/api/webhook-logs")
async def get_webhook_logs():
    import sqlite3 as _sql
    conn = _sql.connect(database.DB_FILE)
    conn.row_factory = _sql.Row
    rows = conn.execute("SELECT * FROM webhook_logs ORDER BY id DESC LIMIT 100").fetchall()
    conn.close()
    return {"logs": [dict(r) for r in rows]}

# ─── Timeframe History Endpoint ────────────────────────────────────────────────
VALID_INTERVALS = {"1min", "5min", "15min", "1h"}

@app.get("/api/history")
async def get_history(interval: str = Query("1min"), outputsize: int = Query(300)):
    """
    Return OHLC + MA candles for any supported interval.
    Uses 205 seed bars so ALL returned candles have valid MA values from bar 1.
    """
    if interval not in VALID_INTERVALS:
        raise HTTPException(status_code=400, detail=f"interval must be one of {VALID_INTERVALS}")

    outputsize = max(50, min(outputsize, 500))

    # load_historical_interval fetches seed+outputsize bars, discards seed,
    # returns only candles where every MA is valid.
    candles = load_historical_interval(GoldStrategy, interval, outputsize)

    if not candles:
        raise HTTPException(status_code=503, detail="No data available — API and cache both failed")

    print(f"[HISTORY] Serving {len(candles)} {interval} candles (all with MAs)")
    return {"interval": interval, "candles": candles}

@app.post("/api/reset")
async def reset_sim():
    """Portfolio + trade reset — price chart history is PRESERVED."""
    global strategy_active

    import sqlite3
    conn = sqlite3.connect(database.DB_FILE)
    conn.execute("DELETE FROM trade_history")
    conn.execute("DELETE FROM webhook_logs")
    conn.execute("UPDATE portfolio_state SET balance=10000, state='FLAT', position=NULL, entry_price=0, position_size=0, stop_loss=0, take_profit=0 WHERE id=1")
    conn.commit()
    conn.close()

    # Reset Portfolio in memory
    from portfolio import PositionState
    portfolio.balance        = 10000.0
    portfolio.equity         = 10000.0
    portfolio.state          = PositionState.FLAT   # 🎯 FIX: was missing — caused OPEN rejected after reset
    portfolio.position       = None
    portfolio.entry_price    = 0.0
    portfolio.position_size  = 0.0
    portfolio.stop_loss      = 0.0
    portfolio.take_profit    = 0.0
    portfolio.unrealized_pnl = 0.0
    portfolio.realized_pnl   = 0.0
    portfolio.trade_history  = []

    # Reset strategy POSITION state (keep price buffer so MAs stay valid)
    strategy.position    = None
    strategy.entry_price = 0.0
    strategy_active      = False

    # Reset the in-progress live candle so next tick opens cleanly
    candle_builder.current = None

    # 🎯 FIX: Do NOT clear chart_snapshot_buffer or last_indicator_state.
    # Re-broadcast the existing snapshot so the frontend redraws with empty trade markers.
    await broadcast_queue.put({"event": "SNAPSHOT",  "data": chart_snapshot_buffer})
    await broadcast_queue.put({"event": "PORTFOLIO", "data": portfolio.get_state()})
    await broadcast_queue.put({"event": "ANALYTICS", "data": Analytics.calculate_metrics([], 10000.0, 10000.0)})

    print("🔄 SIMULATION RESET — portfolio & trades cleared, chart history preserved")

    return {"status": "reset complete", "message": "All database and chart buffers wiped."}

@app.post("/api/start")
async def start_engine():
    """Arm the engine and immediately check for trend entry."""
    global strategy_active
    strategy_active = True
    print("✅ Engine ARMED")

    # 🎯 VITAL STATE SYNC: Before the one-shot entry check, sync strategy.position
    # from portfolio so the strategy's internal state matches reality.
    if portfolio.position is None:
        strategy.position    = None
        strategy.entry_price = 0.0
        # Also ensure portfolio.state agrees — DB state can drift from position
        from portfolio import PositionState
        if portfolio.state != PositionState.FLAT:
            print(f"[START] ⚠️  portfolio.state={portfolio.state} but position=None — correcting to FLAT")
            portfolio.state = PositionState.FLAT
    else:
        strategy.position    = "long" if str(portfolio.position) == "LONG" else "short"
        strategy.entry_price = portfolio.entry_price

    # 🎯 ONE-SHOT: If flat and already in an aligned trend, enter immediately on arm
    if portfolio.position is None and portfolio.state.value == "FLAT" and len(strategy.prices) >= 201:
        last_price = strategy.prices[-1]
        # Use the last HIGH and LOW from the buffer for a proper candle
        last_high = strategy.highs[-1] if strategy.highs else last_price
        last_low  = strategy.lows[-1]  if strategy.lows  else last_price
        result = strategy.update(last_price, last_high, last_low, emit_signal=True)
        if result and result.get("signal"):
            sig = result["signal"]
            print(f"🚀 [ARM ENTRY] Trend already aligned — entering {sig} @ {last_price:.2f}")
            await execution.execute_trade(sig, last_price, "XAUUSD")
            # ⚠️ Pop the duplicate bar we just pushed (strategy.update appends internally)
            # but DO NOT reset strategy.position — the trade is now real
            strategy.prices.pop()
            strategy.highs.pop()
            strategy.lows.pop()
        else:
            # No signal OR priming — reset the position we just set inside update()
            # to avoid ghost state (update() may have set self.position on continuity)
            if result and not result.get("signal"):
                # strategy.update() already set self.position if continuity triggered
                # but no execution happened — roll it back
                strategy.position    = None
                strategy.entry_price = 0.0

    return {"status": "armed", "message": "Engine armed and trend-checked"}

@app.post("/api/stop")
async def stop_engine():
    """Disarm the engine — incoming webhooks will be ignored."""
    global strategy_active
    strategy_active = False
    # 🎯 FIX: also reset strategy internal position to prevent ghost state on next start
    strategy.position    = None
    strategy.entry_price = 0.0
    print("🛑 Engine DISARMED — strategy state cleared")
    return {"status": "disarmed"}

@app.get("/api/status")
async def get_status():
    # Health logic: check if data feed was active in last 60s
    import time
    feed_healthy = (time.time() - data_feed.last_tick_time < 60)
    
    return {
        "engine_armed": strategy_active,
        "feed_healthy": feed_healthy,
        "connected_clients": len(active_connections),
        "portfolio": portfolio.get_state(),
    }

class SettingsInput(BaseModel):
    trade_size_pct: Optional[float] = None  # e.g. 0.10 for 10%

@app.get("/api/settings")
async def get_settings():
    """Return current engine settings."""
    return {
        "trade_size_pct": portfolio.trade_size_pct,
        "initial_balance": portfolio.initial_balance,
        "strategy_active": strategy_active,
    }

@app.post("/api/settings")
async def update_settings(settings: SettingsInput):
    """Hot-update trade sizing (takes effect on NEXT trade)."""
    if settings.trade_size_pct is not None:
        pct = max(0.01, min(1.0, settings.trade_size_pct))
        portfolio.trade_size_pct = pct
        print(f"[SETTINGS] trade_size_pct updated to {pct:.2%}")
    return {"status": "ok", "trade_size_pct": portfolio.trade_size_pct}

# ── Backtesting ───────────────────────────────────────────────────────────────
class BacktestRequest(BaseModel):
    period: str = "1D"   # 1H | 5H | 12H | 1D | 2D | 3D | 5D | 7D  (all 1m candles)

@app.post("/api/backtest")
async def api_backtest(req: BacktestRequest):
    """Run GoldStrategy on GC=F data for the given period and return trades + chart data."""
    from concurrent.futures import ThreadPoolExecutor
    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor() as pool:
        result = await loop.run_in_executor(pool, run_backtest, req.period)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

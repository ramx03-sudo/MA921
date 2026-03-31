import json
import os
import time
import datetime
import requests
import yfinance as yf

CACHE_FILE = "warmup_cache.json"

# MA200 needs 200 bars to prime — always fetch SEED + VISIBLE bars
SEED_BARS    = 205
VISIBLE_BARS = 4795

# 🛡️ Re-fetch if cache file is older than 15 minutes
CACHE_MAX_AGE_SECS = 900
# Re-fetch if last candle in cache is older than this (seconds) — closes the gap at startup
CANDLE_STALE_SECS = 600  # 10 minutes

FINNHUB_API_KEY = "d73p9fpr01qjjol3rhp0d73p9fpr01qjjol3rhpg"
FINNHUB_CANDLE_URL = "https://finnhub.io/api/v1/forex/candle"

# yfinance interval mapping
# yfinance intervals: 1m, 5m, 15m, 60m (1h not supported directly → use 60m)
YF_INTERVAL_MAP = {
    "1min":  "1m",
    "5min":  "5m",
    "15min": "15m",
    "1h":    "60m",
}

# yfinance max lookback periods (per interval)
# 1m data only available for last 7 days via yfinance
YF_PERIOD_MAP = {
    "1min":  "7d",
    "5min":  "60d",
    "15min": "60d",
    "1h":    "730d",
}


def _is_cache_fresh(cache_path: str) -> bool:
    """Return True if cache FILE is young enough AND last candle timestamp is recent."""
    if not os.path.exists(cache_path):
        return False
    file_age = time.time() - os.path.getmtime(cache_path)
    if file_age >= CACHE_MAX_AGE_SECS:
        return False
    # Also verify the last candle in the data is not stale — this catches the case
    # where the server was restarted after a long idle period with a recent cache file.
    try:
        with open(cache_path) as f:
            data = json.load(f)
        timestamps = data.get("t", [])
        if timestamps:
            last_ts = int(timestamps[-1])
            candle_age = time.time() - last_ts
            if candle_age > CANDLE_STALE_SECS:
                print(f"[WARMUP] Cache last candle is {int(candle_age/60)}m old — forcing re-fetch.")
                return False
    except Exception:
        pass
    return True


def _fetch_yfinance_candles(interval: str) -> dict | None:
    """
    Fetch OHLCV candles for XAU/USD via yfinance (completely free, no API key).
    Returns a normalized dict: {"c": [...], "h": [...], "l": [...], "o": [...], "t": [...]}
    Timestamps are UNIX seconds.
    """
    yf_interval = YF_INTERVAL_MAP.get(interval, "1m")
    yf_period   = YF_PERIOD_MAP.get(interval, "7d")

    print(f"[WARMUP] Fetching XAU/USD {interval} candles from Yahoo Finance (yfinance)...")
    try:
        ticker = yf.Ticker("GC=F")  # Gold Futures — basis offset applied at startup in main.py
        df = ticker.history(interval=yf_interval, period=yf_period)

        if df.empty or len(df) < 10:
            print(f"[WARMUP] ⚠️  yfinance returned empty data for {interval}.")
            return None

        # Drop rows with NaN OHLC
        df = df.dropna(subset=["Open", "High", "Low", "Close"])

        # Convert index to UNIX seconds
        if df.index.tzinfo is not None:
            timestamps = [int(ts.timestamp()) for ts in df.index]
        else:
            timestamps = [int(ts.timestamp()) for ts in df.index.tz_localize("UTC")]

        data = {
            "o": [round(float(v), 4) for v in df["Open"].tolist()],
            "h": [round(float(v), 4) for v in df["High"].tolist()],
            "l": [round(float(v), 4) for v in df["Low"].tolist()],
            "c": [round(float(v), 4) for v in df["Close"].tolist()],
            "t": timestamps,
            "s": "ok",
        }

        print(f"[WARMUP] ✅ yfinance success — {len(data['c'])} {interval} candles fetched.")
        return data

    except Exception as e:
        print(f"[WARMUP] ⚠️  yfinance fetch failed: {e}")
        return None

def _fill_gap_with_finnhub(data: dict) -> dict:
    """
    After loading yfinance data, fetch any missing 1-minute candles between
    the last yfinance candle and now from Finnhub REST API.
    This closes the visual gap on the chart caused by yfinance data delay.
    """
    if not data or "t" not in data or not data["t"]:
        return data

    last_ts = int(data["t"][-1])
    now_ts  = int(time.time())
    gap_minutes = (now_ts - last_ts) // 60

    if gap_minutes < 2:
        print(f"[GAP-FILL] No gap to fill ({gap_minutes}m) — data is current.")
        return data

    print(f"[GAP-FILL] Fetching {gap_minutes} missing candles from Finnhub (gap: {gap_minutes}m)...")

    try:
        # Finnhub stock/candle uses OANDA:XAU_USD symbol for spot gold
        resp = requests.get(
            FINNHUB_CANDLE_URL,
            params={
                "symbol":     "OANDA:XAU_USD",
                "resolution": "1",
                "from":       last_ts + 60,   # start 1 candle after last known
                "to":         now_ts,
                "token":      FINNHUB_API_KEY,
            },
            timeout=10
        )
        gap_data = resp.json()

        if gap_data.get("s") != "ok" or not gap_data.get("t"):
            print(f"[GAP-FILL] Finnhub returned no candles (status={gap_data.get('s')}) — gap remains.")
            return data

        n = len(gap_data["t"])
        print(f"[GAP-FILL] ✅ Filled {n} candles from Finnhub.")

        # Append gap candles to existing data
        data["t"] += [int(ts) for ts in gap_data["t"]]
        data["o"] += [round(float(v), 4) for v in gap_data["o"]]
        data["h"] += [round(float(v), 4) for v in gap_data["h"]]
        data["l"] += [round(float(v), 4) for v in gap_data["l"]]
        data["c"] += [round(float(v), 4) for v in gap_data["c"]]

    except Exception as e:
        print(f"[GAP-FILL] ⚠️  Finnhub gap-fill failed: {e} — gap remains.")

    return data


def _parse_candles(data: dict, strategy, visible: int) -> list:
    """
    Parse normalized candle arrays and run through strategy for MA values.
    Returns list of candle dicts with OHLC + MA indicators.
    """
    closes     = data["c"]
    highs      = data["h"]
    lows       = data["l"]
    opens      = data["o"]
    timestamps = data["t"]

    history_buffer = []

    for i in range(len(closes)):
        try:
            ts     = int(timestamps[i])
            close  = float(closes[i])
            high   = float(highs[i])
            low    = float(lows[i])
            open_p = float(opens[i])

            result = strategy.update(close, high, low, emit_signal=False)

            history_buffer.append({
                "time":   ts,
                "open":   round(open_p, 4),
                "high":   round(high,   4),
                "low":    round(low,    4),
                "close":  round(close,  4),
                "ma9":    round(float(result["ma9"]),   4) if result and result.get("ma9")   else None,
                "ma21":   round(float(result["ma21"]),  4) if result and result.get("ma21")  else None,
                "ma50":   round(float(result["ma50"]),  4) if result and result.get("ma50")  else None,
                "ma200":  round(float(result["ma200"]), 4) if result and result.get("ma200") else None,
                "signal": None,
            })
        except (KeyError, ValueError, IndexError):
            continue

    # Only return candles where all MAs are valid and the candle has a body
    active_bars = [c for c in history_buffer if c["ma9"] is not None and c["high"] != c["low"]]
    return active_bars[-visible:]


def load_historical(strategy, visible: int = VISIBLE_BARS) -> list:
    """
    Fetch historical 1-min candles and pre-fill strategy MA buffer.
    Priority:
      1) Fresh cache (< 2h old) → skip yfinance
      2) yfinance fetch          → update cache on success
      3) Stale cache             → last resort
    """
    data = None

    # ── 1. Fresh cache ────────────────────────────────────────────────────────
    if _is_cache_fresh(CACHE_FILE):
        try:
            with open(CACHE_FILE) as f:
                data = json.load(f)
            if "c" not in data:
                print("[WARMUP] Cache is old format — discarding.")
                data = None
            else:
                age_min = int((time.time() - os.path.getmtime(CACHE_FILE)) / 60)
                print(f"[WARMUP] ✅ Using fresh cache ({age_min}m old) — skipping yfinance.")
        except Exception as e:
            print(f"[WARMUP] Cache read failed: {e}")
            data = None

    # ── 2. yfinance fetch ─────────────────────────────────────────────────────
    if data is None:
        data = _fetch_yfinance_candles("1min")
        if data:
            # Fill the gap between last yfinance candle and now
            data = _fill_gap_with_finnhub(data)
            with open(CACHE_FILE, "w") as f:
                json.dump(data, f)
    else:
        # Even with fresh cache, top up with any new candles since cache was written
        data = _fill_gap_with_finnhub(data)

    # ── 3. Stale cache fallback ───────────────────────────────────────────────
    if data is None and os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE) as f:
                data = json.load(f)
            if "c" not in data:
                data = None
            else:
                age_min = int((time.time() - os.path.getmtime(CACHE_FILE)) / 60)
                print(f"[WARMUP] ⚠️  Using stale cache ({age_min}m old) — yfinance unavailable.")
        except Exception as e:
            print(f"[WARMUP] Stale cache read failed: {e}")

    if not data or "c" not in data or len(data["c"]) < 10:
        raise Exception("🔥 CRITICAL: Warmup failed — no yfinance data and no valid cache.")

    result = _parse_candles(data, strategy, visible)
    print(f"[WARMUP] Done — {len(result)} candles loaded (all with valid MAs). Engine armed.")
    return result


def load_historical_interval(strategy_cls, interval: str, outputsize: int = 300) -> list:
    """
    Fetch historical candles at any interval for the /api/history endpoint.
    """
    cache_file = CACHE_FILE if interval == "1min" else f"cache_{interval}.json"
    data = None

    # ── Fresh cache ───────────────────────────────────────────────────────────
    if _is_cache_fresh(cache_file):
        try:
            with open(cache_file) as f:
                data = json.load(f)
            if "c" not in data:
                data = None
            else:
                age_min = int((time.time() - os.path.getmtime(cache_file)) / 60)
                print(f"[HISTORY/{interval}] ✅ Using fresh cache ({age_min}m old).")
        except Exception:
            data = None

    # ── yfinance fetch ────────────────────────────────────────────────────────
    if data is None:
        data = _fetch_yfinance_candles(interval)
        if data:
            with open(cache_file, "w") as f:
                json.dump(data, f)

    # ── Stale cache fallback ──────────────────────────────────────────────────
    if data is None and os.path.exists(cache_file):
        try:
            with open(cache_file) as f:
                data = json.load(f)
            if "c" not in data:
                data = None
            else:
                print(f"[HISTORY/{interval}] ⚠️  Using stale cache.")
        except Exception:
            pass

    if not data or "c" not in data:
        return []

    s = strategy_cls()
    closes     = data["c"]
    highs      = data["h"]
    lows       = data["l"]
    opens      = data["o"]
    timestamps = data["t"]

    result_buf = []

    for i in range(len(closes)):
        try:
            ts     = int(timestamps[i])
            close  = float(closes[i])
            high   = float(highs[i])
            low    = float(lows[i])
            open_p = float(opens[i])

            r = s.update(close, high, low, emit_signal=False)
            result_buf.append({
                "time":  ts,
                "open":  round(open_p, 4),
                "high":  round(high,   4),
                "low":   round(low,    4),
                "close": round(close,  4),
                "ma9":   round(float(r["ma9"]),   4) if r and r.get("ma9")   else None,
                "ma21":  round(float(r["ma21"]),  4) if r and r.get("ma21")  else None,
                "ma50":  round(float(r["ma50"]),  4) if r and r.get("ma50")  else None,
                "ma200": round(float(r["ma200"]), 4) if r and r.get("ma200") else None,
            })
        except Exception:
            continue

    return [c for c in result_buf if c["ma9"] is not None][-outputsize:]

import pandas as pd
import numpy as np

class GoldStrategy:
    """
    Gold (XAUUSD) Moving Average Crossover Strategy
    ================================================
    ENTRY (pure crossover + trend confirmation):
      Long  -> MA9 crosses ABOVE MA21  AND  MA50 > MA200 (bullish trend)
      Short -> MA9 crosses BELOW MA21  AND  MA50 < MA200 (bearish trend)

    EXIT (whichever comes first):
      Exit Long  -> MA9 crosses BELOW MA21   OR  MA50 crosses BELOW MA200 (Death Cross)
      Exit Short -> MA9 crosses ABOVE MA21   OR  MA50 crosses ABOVE MA200 (Golden Cross)

    NOTE: Entry fires ONLY on the exact candle where MA9/MA21 crossover happens.
          No continuity entries — pure crossover signals only.
    """

    def __init__(self):
        self.prices = []
        self.highs  = []
        self.lows   = []
        self.position    = None   # "long" | "short" | None
        self.entry_price = 0.0

    def update(self, price, high=None, low=None, emit_signal=True):
        price = round(float(price), 2)
        high  = round(float(high) if high else price, 2)
        low   = round(float(low)  if low  else price, 2)

        assert high >= low, f"Candle integrity failed: H({high}) < L({low})"

        self.prices.append(price)
        self.highs.append(high)
        self.lows.append(low)

        # Rolling window — keep 300 bars max to prevent memory leak
        if len(self.prices) > 300:
            self.prices.pop(0)
            self.highs.pop(0)
            self.lows.pop(0)

        # Need at least 201 bars so iloc[-2] is valid for MA200
        if len(self.prices) < 201:
            return None

        close = pd.Series(self.prices)

        ma9   = close.rolling(9).mean()
        ma21  = close.rolling(21).mean()
        ma50  = close.rolling(50).mean()
        ma200 = close.rolling(200).mean()

        # Current & Previous bar values
        m9,   m21   = ma9.iloc[-1],   ma21.iloc[-1]
        m50,  m200  = ma50.iloc[-1],  ma200.iloc[-1]
        p9,   p21   = ma9.iloc[-2],   ma21.iloc[-2]
        p50,  p200  = ma50.iloc[-2],  ma200.iloc[-2]

        # ── Crossover detection ──────────────────────────────────────────
        ma9_cross_up    = (p9  < p21)  and (m9  > m21)   # MA9  crosses ABOVE MA21
        ma9_cross_down  = (p9  > p21)  and (m9  < m21)   # MA9  crosses BELOW MA21
        ma50_cross_up   = (p50 < p200) and (m50 > m200)  # MA50 crosses ABOVE MA200 (Golden Cross)
        ma50_cross_down = (p50 > p200) and (m50 < m200)  # MA50 crosses BELOW MA200 (Death Cross)

        # ── Trend bias (current bar) ─────────────────────────────────────
        bullish_trend = m50 > m200
        bearish_trend = m50 < m200

        signal = None

        if emit_signal:
            # ── EXIT open position first ─────────────────────────────────
            if self.position == "long":
                # Exit Long: MA9 crosses below MA21 OR death cross
                if ma9_cross_down or ma50_cross_down:
                    reason = "MA9<MA21" if ma9_cross_down else "Death Cross (MA50<MA200)"
                    print(f"  [STRATEGY] EXIT LONG  @ {price:.2f} | {reason}")
                    signal = "EXIT"
                    self.position    = None
                    self.entry_price = 0.0

            elif self.position == "short":
                # Exit Short: MA9 crosses above MA21 OR golden cross
                if ma9_cross_up or ma50_cross_up:
                    reason = "MA9>MA21" if ma9_cross_up else "Golden Cross (MA50>MA200)"
                    print(f"  [STRATEGY] EXIT SHORT @ {price:.2f} | {reason}")
                    signal = "EXIT"
                    self.position    = None
                    self.entry_price = 0.0

            # ── ENTRY — flat + fresh crossover + trend confirmation ───────
            if self.position is None and signal != "EXIT":
                # LONG: MA9 crosses above MA21 AND we are in a bullish trend
                if ma9_cross_up and bullish_trend:
                    self.position    = "long"
                    self.entry_price = price
                    signal = "BUY"
                    print(f"  [STRATEGY] ENTER LONG  @ {price:.2f} | MA9 crossed above MA21 | MA50={m50:.2f} > MA200={m200:.2f}")

                # SHORT: MA9 crosses below MA21 AND we are in a bearish trend
                elif ma9_cross_down and bearish_trend:
                    self.position    = "short"
                    self.entry_price = price
                    signal = "SELL"
                    print(f"  [STRATEGY] ENTER SHORT @ {price:.2f} | MA9 crossed below MA21 | MA50={m50:.2f} < MA200={m200:.2f}")

        return {
            "signal":        signal,
            "price":         price,
            "position":      self.position,
            "entry_price":   self.entry_price,
            "ma9":           float(m9),
            "ma21":          float(m21),
            "ma50":          float(m50),
            "ma200":         float(m200),
            "bullish_trend": bullish_trend,
            "bearish_trend": bearish_trend,
        }

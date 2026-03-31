import pandas as pd
import numpy as np

class GoldStrategy:
    """
    Gold (XAUUSD) Moving Average Crossover Strategy
    ================================================
    ENTRY:
      Long  → MA50 > MA200  AND  MA9 crosses ABOVE MA21
      Short → MA50 < MA200  AND  MA9 crosses BELOW MA21

    EXIT (whichever comes first):
      Exit Long  → MA9 crosses BELOW MA21   OR  MA50 crosses BELOW MA200
      Exit Short → MA9 crosses ABOVE MA21   OR  MA50 crosses ABOVE MA200

    Exactly mirrors the backtesting.py reference strategy.
    """

    def __init__(self):
        self.prices = []
        self.highs  = []
        self.lows   = []
        self.position   = None   # "long" | "short" | None
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

        # ── Current & Previous bar values ────────────────────────────────
        m9,   m21   = ma9.iloc[-1],   ma21.iloc[-1]
        m50,  m200  = ma50.iloc[-1],  ma200.iloc[-1]
        p9,   p21   = ma9.iloc[-2],   ma21.iloc[-2]
        p50,  p200  = ma50.iloc[-2],  ma200.iloc[-2]

        # ── Crossover Signals ────────────────────────────────────────────
        ma9_cross_up    = (p9  < p21)  and (m9  > m21)   # MA9 crosses ABOVE MA21
        ma9_cross_down  = (p9  > p21)  and (m9  < m21)   # MA9 crosses BELOW MA21
        ma50_cross_up   = (p50 < p200) and (m50 > m200)  # MA50 crosses ABOVE MA200 (Golden Cross)
        ma50_cross_down = (p50 > p200) and (m50 < m200)  # MA50 crosses BELOW MA200 (Death Cross)

        # ── Trend Bias ───────────────────────────────────────────────────
        bullish_trend = m50 > m200
        bearish_trend = m50 < m200

        signal = None

        # ══════════════════════════════════════════════════════════════════
        #  MANAGE OPEN POSITION — check exits BEFORE entries
        # ══════════════════════════════════════════════════════════════════

        if emit_signal and self.position == "long":
            # Exit Long: MA9 crosses below MA21  OR  MA50 crosses below MA200
            if ma9_cross_down or ma50_cross_down:
                reason = "MA9<MA21" if ma9_cross_down else "MA50<MA200 (Death Cross)"
                print(f"  [STRATEGY] EXIT LONG @ {price:.2f}  | reason: {reason}")
                signal = "EXIT"
                self.position = None
                self.entry_price = 0.0

        elif emit_signal and self.position == "short":
            # Exit Short: MA9 crosses above MA21  OR  MA50 crosses above MA200
            if ma9_cross_up or ma50_cross_up:
                reason = "MA9>MA21" if ma9_cross_up else "MA50>MA200 (Golden Cross)"
                print(f"  [STRATEGY] EXIT SHORT @ {price:.2f}  | reason: {reason}")
                signal = "EXIT"
                self.position = None
                self.entry_price = 0.0

        # ══════════════════════════════════════════════════════════════════
        #  ENTRY SIGNALS — only when flat and signal emission is allowed
        # ══════════════════════════════════════════════════════════════════

        if emit_signal and self.position is None and signal != "EXIT":
            # LONG: Bullish trend AND (MA9 crosses above MA21  OR  MA9 is clearly above MA21)
            # 🎯 Added continuity entry: allow joining an existing trend if no exit happened yet
            if bullish_trend:
                if ma9_cross_up or (m9 > m21 * 1.0001): # Crossover OR clearly above
                    self.position    = "long"
                    self.entry_price = price
                    signal = "BUY"
                    print(f"  [STRATEGY] ENTER LONG  @ {price:.2f} (Continuity) | MA50={m50:.2f} MA200={m200:.2f}")

            # SHORT: Bearish trend AND (MA9 crosses below MA21 OR MA9 is clearly below MA21)
            elif bearish_trend:
                if ma9_cross_down or (m9 < m21 * 0.9999): # Crossover OR clearly below
                    self.position    = "short"
                    self.entry_price = price
                    signal = "SELL"
                    print(f"  [STRATEGY] ENTER SHORT @ {price:.2f} (Continuity) | MA50={m50:.2f} MA200={m200:.2f}")

        return {
            "signal":       signal,
            "price":        price,
            "position":     self.position,
            "entry_price":  self.entry_price,
            "ma9":          float(m9),
            "ma21":         float(m21),
            "ma50":         float(m50),
            "ma200":        float(m200),
            # Trend context — useful for dashboard colour coding
            "bullish_trend": bullish_trend,
            "bearish_trend": bearish_trend,
        }

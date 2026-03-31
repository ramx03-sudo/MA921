import asyncio
import time
from portfolio import Portfolio

class Execution:
    def __init__(self, portfolio: Portfolio):
        self.portfolio = portfolio
        self.spread = 0.3
        self.slippage = 0.05
        self.risk_per_trade = 0.02  # 2% of balance per trade

    async def execute_trade(self, action: str, price: float, symbol: str = "XAUUSD"):
        # 🎯 CLOSE EXISTING POSITION FIRST IF SIGNAL REVERSES OR EXITS
        if self.portfolio.position is not None:
            if (action == "EXIT"
                    or (self.portfolio.position == "LONG"  and action == "SELL")
                    or (self.portfolio.position == "SHORT" and action == "BUY")):
                exit_price = (price - (self.spread / 2) - self.slippage
                              if self.portfolio.position == "LONG"
                              else price + (self.spread / 2) + self.slippage)
                await self.portfolio.close_position(exit_price, "MA_SIGNAL")

        if action == "EXIT":
            return

        # 🎯 OPEN NEW POSITION — no SL/TP, exits come from MA crossovers only
        if self.portfolio.position is None:
            if action == "BUY":
                execution_price = price + (self.spread / 2) + self.slippage
            elif action == "SELL":
                execution_price = price - (self.spread / 2) - self.slippage
            else:
                return

            # 🎯 POSITION SIZING: risk 2% of balance per unit of price
            risk_amount = self.portfolio.balance * self.risk_per_trade
            size = risk_amount / execution_price if execution_price > 0 else 0

            # Open with NO stop_loss / take_profit (0.0 means disabled)
            await self.portfolio.open_position(action, execution_price, size,
                                               stop_loss=0.0, take_profit=0.0)

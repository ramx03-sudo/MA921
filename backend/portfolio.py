import asyncio
import datetime
from typing import Dict, List, Optional
from enum import Enum
import database

class PositionState(str, Enum):
    FLAT = "FLAT"
    LONG = "LONG"
    SHORT = "SHORT"

class Portfolio:
    def __init__(self, initial_balance=10000.0, trade_size_pct=0.1):
        self.initial_balance = initial_balance
        self.trade_size_pct = trade_size_pct
        
        state = database.load_portfolio_state()
        self.balance = state["balance"] if state["balance"] else initial_balance
        self.equity = self.balance
        self.state = PositionState(state["state"]) if state.get("state") else PositionState.FLAT
        self.position: Optional[str] = state["position"]
        self.entry_price = state["entry_price"] or 0.0
        self.position_size = state["position_size"] or 0.0
        self.stop_loss = state["stop_loss"] or 0.0
        self.take_profit = state["take_profit"] or 0.0
        self.last_signal_ts = state.get("last_ts", 0)
        self.entry_time: Optional[str] = None   # ISO timestamp of when position was opened
        
        self.unrealized_pnl = 0.0
        self.realized_pnl = 0.0
        
        # Load persistent trade history
        self.trade_history: List[Dict] = database.load_trade_history()
        self.realized_pnl = sum(t.get("pnl", 0.0) for t in self.trade_history)
        
        self.observers = []

        # 🎯 STARTUP SAFETY: If position is NULL in DB but state is LONG/SHORT,
        # they have drifted (e.g. server crashed mid-trade). Force FLAT.
        if self.position is None and self.state != PositionState.FLAT:
            print(f"[PORTFOLIO INIT] ⚠️  State desync detected (state={self.state}, position=None) — forcing FLAT")
            self.state = PositionState.FLAT
            self._save_state()  # persist the correction immediately

        print(f"[PORTFOLIO INIT] Balance: ${self.balance:.2f} | Position: {self.position} | State: {self.state} | Realized PnL: ${self.realized_pnl:.2f} | Trades loaded: {len(self.trade_history)}")
        
    def add_observer(self, observer_queue: asyncio.Queue):
        self.observers.append(observer_queue)
        
    async def notify(self, event_type: str, data: dict):
        for q in self.observers:
            try:
                await q.put({"event": event_type, "data": data})
            except asyncio.QueueFull:
                pass

    def _save_state(self):
        # 🎯 VITAL: Cast Enums to strings for SQLite persistence
        database.save_portfolio_state(
            float(self.balance),
            str(self.state.value if hasattr(self.state, 'value') else self.state),
            str(self.position.value if hasattr(self.position, 'value') else self.position) if self.position else None,
            float(self.entry_price),
            float(self.position_size),
            float(self.stop_loss),
            float(self.take_profit),
            int(self.last_signal_ts)
        )
                
    async def open_position(self, signal: str, execution_price: float, size: float = None, stop_loss: float = 0.0, take_profit: float = 0.0):
        if self.state != PositionState.FLAT:
            print(f"[PORTFOLIO] OPEN rejected — state is {self.state}")
            return
            
        self.state = PositionState.LONG if signal in ["BUY", "LONG"] else PositionState.SHORT
        self.position = self.state # for backward compatibility in logs
        self.entry_price = execution_price
        self.entry_time = datetime.datetime.now().isoformat()   # 🕐 record open time
        self.stop_loss = stop_loss
        self.take_profit = take_profit
        
        if size is not None:
            self.position_size = size
        else:
            self.position_size = self.balance * self.trade_size_pct
            
        self.unrealized_pnl = 0.0
        self._save_state()
        
        print(f"[OPEN] {self.position} @ ${execution_price:.2f} | Size: {self.position_size:.6f} | Exit: MA signal only")
        
        trade_event = {
            "time": datetime.datetime.now().isoformat(),
            "action": f"OPEN {self.position}",
            "price": execution_price,
            "size": self.position_size,
            "balance": self.balance
        }
        await self.notify("TRADE", trade_event)
        await self.notify("PORTFOLIO", self.get_state())

    async def close_position(self, execution_price: float, reason: str = "SIGNAL"):
        if self.state == PositionState.FLAT:
            return
            
        closed_position = self.state
        
        if self.position == "LONG":
            profit = (execution_price - self.entry_price) * self.position_size
        else:  # SHORT
            profit = (self.entry_price - execution_price) * self.position_size
        
        self.balance += profit
        self.realized_pnl += profit
        
        print(f"[CLOSE] {closed_position} @ ${execution_price:.2f} | Reason: {reason} | PnL: ${profit:.2f} | Balance: ${self.balance:.2f}")
        
        trade = {
            "time": datetime.datetime.now().isoformat(),
            "entry_time": self.entry_time,          # 🕐 when position was opened
            "action": f"CLOSE {closed_position}",
            "reason": reason,
            "entry": self.entry_price,
            "exit": execution_price,
            "pnl": round(profit, 4),
            "size": self.position_size,
            "balance": round(self.balance, 4)
        }
        
        self.trade_history.append(trade)
        database.log_trade(trade)
        
        # Reset position state
        # 🎯 STATE MACHINE TRANSITION
        self.state = PositionState.FLAT
        self.position = None
        self.entry_price = 0.0
        self.entry_time = None
        self.position_size = 0.0
        self.stop_loss = 0.0
        self.take_profit = 0.0
        self.unrealized_pnl = 0.0
        
        self._save_state()
        
        # Broadcast: trade closed + updated portfolio + updated analytics (all 3 mandatory)
        await self.notify("TRADE", trade)
        await self.notify("PORTFOLIO", self.get_state())

    async def update_tick(self, current_price: float):
        # 🎯 Pure MA strategy — NO stop-loss or take-profit checks.
        # Positions only close when strategy.py emits an EXIT/reversal signal.
        if self.position == "LONG":
            self.unrealized_pnl = (current_price - self.entry_price) * self.position_size
        elif self.position == "SHORT":
            self.unrealized_pnl = (self.entry_price - current_price) * self.position_size
        else:
            self.unrealized_pnl = 0.0


        self.equity = self.balance + self.unrealized_pnl
        await self.notify("PORTFOLIO", self.get_state())

    def get_state(self):
        self.equity = self.balance + self.unrealized_pnl
        return {
            "balance": round(self.balance, 4),
            "equity": round(self.equity, 4),
            "state": self.state,
            "position": self.position,
            "entry_price": round(self.entry_price, 4),
            "entry_time": self.entry_time,          # 🕐 when position was opened
            "size": round(self.position_size, 6),
            "unrealized_pnl": round(self.unrealized_pnl, 4),
            "realized_pnl": round(self.realized_pnl, 4),
            "initial_balance": self.initial_balance,
            "total_trades": len(self.trade_history),
            "last_signal_ts": self.last_signal_ts
        }


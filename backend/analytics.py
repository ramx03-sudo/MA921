import pandas as pd
import numpy as np
from typing import List, Dict

class Analytics:
    @staticmethod
    def calculate_metrics(trade_history: List[Dict], initial_balance: float, current_balance: float):
        total_trades = 0
        winning_trades = 0
        losing_trades = 0
        pnls = []
        winning_pnls = []
        losing_pnls = []
        
        # We start equity curve at time 0 (or first trade time)
        equity_values = [initial_balance]
        equity_timeline = [{"time": "START", "equity": initial_balance}]
        
        for trade in trade_history:
            if trade.get("action", "").startswith("CLOSE") or trade.get("pnl") is not None:
                pnl = trade.get("pnl", 0)
                pnls.append(pnl)
                total_trades += 1
                
                # Update equity tracking
                current_equity = equity_values[-1] + pnl
                equity_values.append(current_equity)
                
                # We can use the trade time if available
                trade_time = trade.get("time", "UNKNOWN")
                equity_timeline.append({"time": trade_time, "equity": current_equity})

                if pnl > 0:
                    winning_trades += 1
                    winning_pnls.append(pnl)
                elif pnl < 0:
                    losing_trades += 1
                    losing_pnls.append(pnl)

        net_profit = current_balance - initial_balance
        total_return = (net_profit / initial_balance) * 100 if initial_balance > 0 else 0
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        
        avg_trade_return = np.mean(pnls) if pnls else 0
        avg_win = np.mean(winning_pnls) if winning_pnls else 0
        avg_loss = np.mean(losing_pnls) if losing_pnls else 0
        
        avg_rr = abs(avg_win / avg_loss) if (avg_loss != 0 and avg_win != 0) else 0
        
        # Max Drawdown
        max_drawdown = 0
        if len(equity_values) > 1:
            peak = equity_values[0]
            for equity in equity_values:
                if equity > peak:
                    peak = equity
                drawdown = (peak - equity) / peak * 100
                if drawdown > max_drawdown:
                    max_drawdown = drawdown

        # Sharpe ratio (basic, using per-trade returns, rf=0)
        sharpe = 0
        if len(pnls) > 1:
            mean = np.mean(pnls)
            std = np.std(pnls)
            if std > 0:
                sharpe = (mean / std) * np.sqrt(total_trades)

        return {
            "totalTrades": total_trades,
            "winRate": win_rate,
            "avgRR": avg_rr,
            "maxDrawdown": max_drawdown,
            "netProfit": net_profit,
            "totalReturn": total_return,
            "avgTrade": avg_trade_return,
            "avgWin": avg_win,
            "avgLoss": avg_loss,
            "sharpeRatio": sharpe,
            "equityCurve": equity_timeline
        }

"use client";

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { useNotify } from "@/components/NotificationProvider";

interface PortfolioState {
  balance: number;
  equity: number;
  position: string | null;
  entry_price: number;
  entry_time: string | null;
  size: number;
  unrealized_pnl: number;
  realized_pnl: number;
  initial_balance: number;
  total_trades: number;
}

interface AnalyticsState {
  totalTrades: number;
  winRate: number;
  avgRR: number;
  maxDrawdown: number;
  netProfit: number;
  totalReturn: number;
  avgTrade: number;
  avgWin: number;
  avgLoss: number;
  sharpeRatio: number;
  equityCurve: any[];
}

interface PriceState {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  price: number;
  bid?: number;
  ask?: number;
  signal?: string;
  ma9?: number;
  ma21?: number;
  ma50?: number;
  ma200?: number;
}

interface WSContextType {
  connected: boolean;
  priceData: PriceState | null;
  portfolio: PortfolioState | null;
  analytics: AnalyticsState | null;
  trades: any[];
  snapshot: any[] | null;
  strategyActive: boolean;
  toggleStrategy: () => Promise<void>;
  resetSimulation: () => Promise<void>;
}

const WSContext = createContext<WSContextType>({
  connected: false,
  priceData: null,
  portfolio: null,
  analytics: null,
  trades: [],
  snapshot: null,
  strategyActive: false,
  toggleStrategy: async () => {},
  resetSimulation: async () => {},
});

export const useWS = () => useContext(WSContext);

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const [connected, setConnected] = useState(false);
  const [priceData, setPriceData] = useState<PriceState | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioState | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsState | null>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [snapshot, setSnapshot] = useState<any[] | null>(null);
  const [strategyActive, setStrategyActive] = useState(true); // Armed by default — synced from /api/status on mount

  // Ref to track previous MAs for crossover detection
  const prevMaRef = useRef<{ ma9: number | null; ma21: number | null }>({ ma9: null, ma21: null });
  // Ref to track previous portfolio position for trade notifications
  const prevPositionRef = useRef<string | null>(null);

  // Safe notify — only use if provider is mounted (may not be during first render)
  let notify: ReturnType<typeof useNotify>["notify"] | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    notify = useNotify().notify;
  } catch (_) {}

  // Fetch strategy engine status on mount
  useEffect(() => {
    fetch("http://localhost:8000/api/status")
      .then(r => r.json())
      .then(d => setStrategyActive(!!d.engine_armed))
      .catch(() => {});
  }, []);

  const toggleStrategy = useCallback(async () => {
    const endpoint = strategyActive ? "/api/stop" : "/api/start";
    try {
      await fetch(`http://localhost:8000${endpoint}`, { method: "POST" });
      setStrategyActive(prev => !prev);
      notify?.(
        strategyActive ? "warning" : "success",
        strategyActive ? "⛔ Strategy Stopped" : "✅ Strategy Armed",
        strategyActive ? "Engine disarmed — no new trades." : "Engine armed — signals are live."
      );
    } catch {
      notify?.("error", "Connection Error", "Failed to reach backend.");
    }
  }, [strategyActive, notify]);

  const resetSimulation = useCallback(async () => {
    try {
      await fetch("http://localhost:8000/api/reset", { method: "POST" });
      notify?.("info", "Simulation Reset", "Portfolio and trade history cleared.");
    } catch {
      notify?.("error", "Connection Error", "Failed to reach backend.");
    }
  }, [notify]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;
      ws = new WebSocket("ws://localhost:8000/ws/live");

      ws.onopen = async () => {
        if (!isMounted) return;
        setConnected(true);
        try {
          const resp = await fetch("http://localhost:8000/api/trades");
          const data = await resp.json();
          if (isMounted && data.trades) setTrades(data.trades);
        } catch {}
      };

      ws.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const msg = JSON.parse(event.data);

          if (msg.event === "PRICE") {
            const d: PriceState = msg.data;
            setPriceData(d);

            // MA crossover detection
            const prev = prevMaRef.current;
            if (
              d.ma9 != null && d.ma21 != null &&
              prev.ma9 != null && prev.ma21 != null
            ) {
              const wasBullish = prev.ma9 > prev.ma21;
              const isBullish  = d.ma9 > d.ma21;
              if (!wasBullish && isBullish) {
                notify?.("crossover", "🔼 Bullish MA Crossover", `MA9 crossed above MA21 @ $${d.price?.toFixed(2)}`, 6000);
              } else if (wasBullish && !isBullish) {
                notify?.("crossover", "🔽 Bearish MA Crossover", `MA9 crossed below MA21 @ $${d.price?.toFixed(2)}`, 6000);
              }
            }
            if (d.ma9 != null) prevMaRef.current = { ma9: d.ma9, ma21: d.ma21 ?? null };
          }

          else if (msg.event === "PORTFOLIO") {
            const p: PortfolioState = msg.data;
            setPortfolio(p);

            // Trade open/close notifications
            const prev = prevPositionRef.current;
            const curr = p.position;
            if (!prev && curr) {
              notify?.(
                curr === "LONG" ? "trade_buy" : "trade_sell",
                `📈 ${curr} Opened`,
                `Entry @ $${p.entry_price?.toFixed(2)} · Size ${p.size?.toFixed(4)}`
              );
            } else if (prev && !curr) {
              // Position closed — pnl shown in TRADE event below
            }
            prevPositionRef.current = curr;
          }

          else if (msg.event === "ANALYTICS") setAnalytics(msg.data);
          else if (msg.event === "SNAPSHOT")  setSnapshot(msg.data);
          else if (msg.event === "TRADE") {
            const t = msg.data;
            if (t.action?.startsWith("CLOSE")) {
              const pnl = t.pnl ?? 0;
              notify?.(
                pnl >= 0 ? "success" : "error",
                pnl >= 0 ? `✅ Trade Closed +$${pnl.toFixed(2)}` : `❌ Trade Closed -$${Math.abs(pnl).toFixed(2)}`,
                `Exit @ $${(t.exit ?? t.price ?? 0).toFixed(2)}`
              );
            }
            setTrades(prev => {
              const exists = prev.some((x: any) => x.time === t.time && x.action === t.action);
              if (exists) return prev;
              return [t, ...prev].slice(0, 200);
            });
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!isMounted) return;
        setConnected(false);
        reconnectTimeout = setTimeout(connect, 3000);
      };
      ws.onerror = () => {};
    };

    connect();
    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <WSContext.Provider value={{
      connected, priceData, portfolio, analytics, trades, snapshot,
      strategyActive, toggleStrategy, resetSimulation
    }}>
      {children}
    </WSContext.Provider>
  );
};

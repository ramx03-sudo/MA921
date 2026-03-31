"use client";

import { useEffect, useState } from "react";
import { useWS } from "@/components/WebSocketProvider";

interface Trade {
  time: string;
  action: string;
  price?: number;
  entry?: number;
  exit?: number;
  pnl?: number;
  status?: string;
  size?: number;
}

export default function Trades() {
  const { portfolio, trades: wsTrades } = useWS();
  const [restTrades, setRestTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch authoritative trade list from REST API on every page visit
  const fetchTrades = async () => {
    try {
      const resp = await fetch("http://localhost:8000/api/trades");
      const data = await resp.json();
      if (data.trades) setRestTrades(data.trades);
    } catch (e) {
      console.error("[Trades] REST fetch failed:", e);
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch on mount (every time user visits this page)
  useEffect(() => {
    fetchTrades();
  }, []);

  // Merge: when new TRADE WebSocket events arrive, re-fetch REST to stay in sync
  useEffect(() => {
    if (wsTrades.length > 0) fetchTrades();
  }, [wsTrades.length]);

  // For active trade, override PnL with live portfolio stream
  const livePnl = portfolio?.unrealized_pnl ?? 0;

  const parseTime = (t: string) => {
    if (t === "NOW") return null;
    const d = new Date(t);
    return isNaN(d.getTime()) ? t : d.toLocaleTimeString();
  };

  const fmtPnl = (pnl: number) => `${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}`;

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Trade History</h1>
          <p className="text-gray-400 mt-1">Real-time log of executed orders</p>
        </div>
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
          {restTrades.length} order{restTrades.length !== 1 ? "s" : ""}
        </div>
      </header>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-400">
            <thead className="text-xs uppercase bg-gray-800/50 text-gray-400">
              <tr>
                <th className="px-6 py-4 rounded-tl-lg">Time</th>
                <th className="px-6 py-4">Action</th>
                <th className="px-6 py-4">Entry / Exit</th>
                <th className="px-6 py-4">PnL</th>
                <th className="px-6 py-4 rounded-tr-lg">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex items-center justify-center gap-2 text-gray-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                      <span className="text-xs uppercase tracking-widest">Loading…</span>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && restTrades.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-600">
                      <div className="w-8 h-[1px] bg-gray-700" />
                      <span className="text-xs uppercase tracking-widest">No trades yet</span>
                      <div className="w-8 h-[1px] bg-gray-700" />
                    </div>
                  </td>
                </tr>
              )}

              {restTrades.map((trade, idx) => {
                const isActive = trade.status === "ACTIVE" || trade.time === "NOW";
                const isClose  = trade.action.startsWith("CLOSE");
                const isBuy    = trade.action.includes("LONG") || trade.action.includes("BUY");
                const entryPrice = trade.price ?? trade.entry ?? 0;

                // Live PnL for active trade, static pnl for closed
                const displayPnl = isActive ? livePnl : (trade.pnl ?? null);

                return (
                  <tr
                    key={idx}
                    className={`border-b border-gray-800 transition-colors ${
                      isActive ? "bg-blue-500/5 hover:bg-blue-500/10" : "hover:bg-gray-800/30"
                    }`}
                  >
                    {/* Time */}
                    <td className="px-6 py-4 whitespace-nowrap font-mono text-xs">
                      {isActive ? (
                        <span className="flex items-center gap-1.5 text-blue-400 font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                          LIVE
                        </span>
                      ) : (
                        <span className="text-gray-300">{parseTime(trade.time)}</span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold border ${
                        isBuy
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-red-500/10 text-red-400 border-red-500/20"
                      }`}>
                        {trade.action}
                      </span>
                    </td>

                    {/* Entry / Exit price */}
                    <td className="px-6 py-4 font-mono text-gray-200 text-sm">
                      {isClose ? (
                        <span>
                          <span className="text-gray-600 text-xs mr-1">exit</span>
                          ${(trade.exit ?? 0).toFixed(2)}
                        </span>
                      ) : (
                        <span>
                          <span className="text-gray-600 text-xs mr-1">entry</span>
                          ${entryPrice.toFixed(2)}
                        </span>
                      )}
                    </td>

                    {/* PnL — live for active, static for closed */}
                    <td className="px-6 py-4 font-mono font-bold">
                      {displayPnl !== null ? (
                        <span className={displayPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {fmtPnl(displayPnl)}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-6 py-4">
                      {isActive ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          RUNNING
                        </span>
                      ) : isClose ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-700/50 text-gray-500">
                          CLOSED
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                          FILLED
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

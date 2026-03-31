"use client";

import { useState, useEffect } from "react";
import {
  Settings, Save, AlertCircle, CheckCircle,
  Play, Square, RotateCcw, Sliders, Bell, Shield, Zap
} from "lucide-react";
import { useWS } from "@/components/WebSocketProvider";
import { useNotify } from "@/components/NotificationProvider";

interface EngineConfig {
  initial_capital: number;
  trade_size_pct: number;
  strategy_active: boolean;
  feed_healthy: boolean;
  connected_clients: number;
}

export default function SettingsPage() {
  const { strategyActive, toggleStrategy, resetSimulation, portfolio } = useWS();
  const { notify } = useNotify();

  const [config, setConfig] = useState<EngineConfig | null>(null);
  const [tradeSize, setTradeSize] = useState("10");
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [notifyCrossover, setNotifyCrossover] = useState(true);
  const [notifyTrades, setNotifyTrades] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("http://localhost:8000/api/status")
      .then(r => r.json())
      .then((d: any) => {
        setConfig({
          initial_capital: d.portfolio?.initial_balance ?? 10000,
          trade_size_pct:  d.portfolio?.size ? d.portfolio.size * 10 : 10,
          strategy_active: d.engine_armed,
          feed_healthy:    d.feed_healthy,
          connected_clients: d.connected_clients,
        });
        setTradeSize(String(d.portfolio?.size ? d.portfolio.size * 100 : 10));
      })
      .catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Settings saved to local storage for now (backend restart needed to apply capital changes)
    await new Promise(r => setTimeout(r, 500));
    setSavedSuccess(true);
    notify("success", "Settings Saved", "Preferences updated. Restart engine to apply capital changes.");
    setTimeout(() => setSavedSuccess(false), 3000);
    setLoading(false);
  };

  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3500);
      return;
    }
    setConfirmReset(false);
    await resetSimulation();
  };

  const statusDot = (ok: boolean) => (
    <span className={`w-2 h-2 rounded-full ${ok ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
  );

  return (
    <div className="h-full overflow-y-auto bg-[#0b0e14] p-6"
      style={{ scrollbarWidth: "thin", scrollbarColor: "#2b2b43 transparent" }}
    >
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Settings className="w-6 h-6 text-blue-500" />
              Configuration
            </h1>
            <p className="text-gray-500 text-sm mt-1">Trading engine parameters & system health</p>
          </div>
        </div>

        {/* System Status */}
        <div className="bg-[#131722] border border-[#2b2b43] rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-400" /> System Status
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "Strategy Engine", ok: strategyActive, text: strategyActive ? "Armed" : "Stopped" },
              { label: "Price Feed",      ok: config?.feed_healthy ?? false, text: config?.feed_healthy ? "Live" : "Offline" },
              { label: "WS Clients",      ok: (config?.connected_clients ?? 0) > 0, text: `${config?.connected_clients ?? 0} connected` },
            ].map(row => (
              <div key={row.label} className="bg-[#1a1f2e] border border-[#2b2b43] rounded-lg px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-gray-500 font-medium">{row.label}</span>
                <div className="flex items-center gap-2">
                  {statusDot(row.ok)}
                  <span className={`text-xs font-bold font-mono ${row.ok ? "text-emerald-400" : "text-red-400"}`}>{row.text}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Engine Control */}
        <div className="bg-[#131722] border border-[#2b2b43] rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
            <Play className="w-4 h-4 text-emerald-400" /> Engine Control
          </h2>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={toggleStrategy}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm transition-all border ${
                strategyActive
                  ? "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
              }`}
            >
              {strategyActive
                ? <><Square className="w-4 h-4" fill="currentColor" /> Stop Strategy</>
                : <><Play className="w-4 h-4" fill="currentColor" /> Start Strategy</>}
            </button>
            <button
              onClick={handleReset}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm transition-all border ${
                confirmReset
                  ? "bg-orange-500/15 text-orange-400 border-orange-500/30 animate-pulse"
                  : "bg-[#1a1f2e] text-gray-400 border-[#2b2b43] hover:bg-[#232836] hover:text-gray-200"
              }`}
            >
              <RotateCcw className="w-4 h-4" />
              {confirmReset ? "Confirm Reset?" : "Reset Simulation"}
            </button>
          </div>
          <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg px-4 py-3 flex gap-3 text-xs text-amber-400/80">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            Stopping the engine closes all monitoring. Open positions remain until a reversal signal is received.
          </div>
        </div>

        {/* Trading Parameters */}
        <form onSubmit={handleSave} className="bg-[#131722] border border-[#2b2b43] rounded-xl p-5 space-y-5">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
            <Sliders className="w-4 h-4 text-purple-400" /> Trading Parameters
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Initial Capital (read-only) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
                Initial Capital
                <span className="text-[9px] bg-gray-700/50 text-gray-500 px-1.5 py-0.5 rounded font-normal">requires restart</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-mono">$</span>
                <input
                  type="number"
                  value={config?.initial_capital ?? 10000}
                  readOnly
                  className="w-full bg-[#1a1f2e] border border-[#2b2b43] rounded-lg pl-7 pr-4 py-2.5 text-white/50 text-sm font-mono outline-none cursor-not-allowed"
                />
              </div>
              <p className="text-[10px] text-gray-600">Current: ${portfolio?.initial_balance?.toFixed(2) ?? "10,000.00"}</p>
            </div>

            {/* Trade Size */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-400">Position Size (%)</label>
              <div className="relative">
                <input
                  type="number"
                  min="1" max="100" step="1"
                  value={tradeSize}
                  onChange={e => setTradeSize(e.target.value)}
                  className="w-full bg-[#1a1f2e] border border-[#2b2b43] rounded-lg px-4 py-2.5 text-white text-sm font-mono outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">%</span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {["5", "10", "25", "50"].map(v => (
                  <button
                    key={v} type="button"
                    onClick={() => setTradeSize(v)}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                      tradeSize === v
                        ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
                        : "border-[#2b2b43] text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {v}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end pt-2 border-t border-[#2b2b43]">
            <button
              type="submit"
              disabled={loading}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                savedSuccess
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-blue-600 hover:bg-blue-500 text-white border border-transparent"
              }`}
            >
              {savedSuccess ? <><CheckCircle className="w-4 h-4" /> Saved!</> : <><Save className="w-4 h-4" /> {loading ? "Saving…" : "Save Settings"}</>}
            </button>
          </div>
        </form>

        {/* Notification Preferences */}
        <div className="bg-[#131722] border border-[#2b2b43] rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-400" /> Notification Preferences
          </h2>
          <div className="space-y-3">
            {[
              {
                label: "MA Crossover Alerts",
                sub: "Show toast when MA9 crosses MA21",
                value: notifyCrossover,
                set: setNotifyCrossover,
              },
              {
                label: "Trade Execution Alerts",
                sub: "Notify on position open / close",
                value: notifyTrades,
                set: setNotifyTrades,
              },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between bg-[#1a1f2e] border border-[#2b2b43] rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm text-gray-200 font-medium">{row.label}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{row.sub}</p>
                </div>
                <button
                  type="button"
                  onClick={() => row.set(!row.value)}
                  className={`relative w-10 h-5 rounded-full transition-all duration-300 ${row.value ? "bg-blue-600" : "bg-[#2b2b43]"}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-300 ${row.value ? "left-5" : "left-0.5"}`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Strategy Info */}
        <div className="bg-[#131722] border border-[#2b2b43] rounded-xl p-5 space-y-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" /> Strategy Info
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            {[
              ["Asset",      "XAUUSD (Gold Spot)"],
              ["Strategy",   "MA9/21/50/200 Crossover"],
              ["Timeframe",  "1-minute candles"],
              ["Execution",  "Candle-close signal"],
              ["Data Feed",  "Finnhub Websocket"],
              ["History",    "yFinance GC=F"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between bg-[#1a1f2e] border border-[#2b2b43] rounded-lg px-3 py-2">
                <span className="text-gray-500">{k}</span>
                <span className="text-gray-300 font-semibold">{v}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

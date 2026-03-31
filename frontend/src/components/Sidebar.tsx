import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, LineChart, History, Settings, Activity,
  FlaskConical, Play, Square, RotateCcw, Wifi, WifiOff,
  ChevronRight, Zap
} from "lucide-react";
import { useWS } from "@/components/WebSocketProvider";
import { useState } from "react";

export default function Sidebar() {
  const location = useLocation();
  const { connected, portfolio, strategyActive, toggleStrategy, resetSimulation } = useWS();
  const [confirmReset, setConfirmReset] = useState(false);

  const navItems = [
    { name: "Dashboard",  href: "/",          icon: LayoutDashboard },
    { name: "Analytics",  href: "/analytics",  icon: LineChart },
    { name: "Trades",     href: "/trades",     icon: History },
    { name: "Backtest",   href: "/backtest",   icon: FlaskConical },
    { name: "Settings",   href: "/settings",   icon: Settings },
  ];

  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    setConfirmReset(false);
    await resetSimulation();
  };

  const balChange = portfolio
    ? portfolio.balance - portfolio.initial_balance
    : 0;
  const balChangePct = portfolio?.initial_balance
    ? (balChange / portfolio.initial_balance) * 100
    : 0;

  return (
    <aside className="w-[220px] bg-[#0d1117] border-r border-[#1e2433] flex flex-col justify-between py-5 px-3 shrink-0">
      {/* ── Logo ── */}
      <div>
        <div className="flex items-center gap-2.5 px-2 mb-7">
          <div className="relative">
            <Activity className="h-7 w-7 text-blue-500" />
            {strategyActive && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            )}
          </div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight text-white leading-none">MA921</h1>
            <span className="text-[9px] text-gray-600 font-medium uppercase tracking-widest">Trading Engine</span>
          </div>
        </div>

        {/* ── Nav ── */}
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all group relative ${
                  isActive
                    ? "bg-blue-600/15 text-blue-400 font-semibold"
                    : "text-gray-500 hover:text-gray-200 hover:bg-white/5"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-blue-500 rounded-r-full" />
                )}
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1">{item.name}</span>
                {isActive && <ChevronRight className="h-3 w-3 opacity-50" />}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ── Bottom panel ── */}
      <div className="flex flex-col gap-3">

        {/* Portfolio summary card */}
        <div className="bg-[#131722] border border-[#2b2b43] rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase text-gray-600 tracking-widest">Portfolio</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
              portfolio?.position === "LONG"  ? "bg-emerald-500/10 text-emerald-400" :
              portfolio?.position === "SHORT" ? "bg-red-500/10 text-red-400" :
                                               "bg-gray-700/40 text-gray-500"
            }`}>
              {portfolio?.position ?? "FLAT"}
            </span>
          </div>
          <div>
            <div className="text-white font-mono font-bold text-base leading-none">
              ${(portfolio?.balance ?? 10000).toFixed(2)}
            </div>
            <div className={`text-[10px] font-mono mt-0.5 ${balChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {balChange >= 0 ? "+" : ""}${balChange.toFixed(2)} ({balChangePct >= 0 ? "+" : ""}{balChangePct.toFixed(2)}%)
            </div>
          </div>
          {portfolio?.position && (
            <div className={`text-[10px] font-mono pt-1 border-t border-[#2b2b43] flex justify-between`}>
              <span className="text-gray-500">Unrealized</span>
              <span className={portfolio.unrealized_pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                {portfolio.unrealized_pnl >= 0 ? "+" : ""}${portfolio.unrealized_pnl.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Engine status label */}
        <div className="px-2 flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase text-gray-600 tracking-widest">Engine</span>
          <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase ${strategyActive ? "text-emerald-400" : "text-gray-600"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${strategyActive ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`} />
            {strategyActive ? "Armed" : "Stopped"}
          </div>
        </div>

        {/* Start / Stop button */}
        <button
          onClick={toggleStrategy}
          className={`w-full py-2 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 border ${
            strategyActive
              ? "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 hover:border-red-500/40"
              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/40"
          }`}
        >
          {strategyActive ? (
            <><Square className="w-3.5 h-3.5" fill="currentColor" /> Stop Strategy</>
          ) : (
            <><Play className="w-3.5 h-3.5" fill="currentColor" /> Start Strategy</>
          )}
        </button>

        {/* Reset button */}
        <button
          onClick={handleReset}
          className={`w-full py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 border ${
            confirmReset
              ? "border-orange-500/40 text-orange-400 bg-orange-500/10 animate-pulse"
              : "border-[#2b2b43] text-gray-500 hover:text-gray-300 hover:bg-white/5"
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {confirmReset ? "Click again to confirm" : "Reset Simulation"}
        </button>

        {/* Connection status */}
        <div className={`flex items-center gap-2 px-2 text-[9px] font-bold uppercase tracking-widest ${connected ? "text-emerald-500/70" : "text-red-500/70"}`}>
          {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {connected ? "Feed Live" : "Disconnected"}
          {connected && <Zap className="w-2.5 h-2.5 ml-auto opacity-50" />}
        </div>
      </div>
    </aside>
  );
}

"use client";

import { useEffect, useState, useMemo } from "react";
import { useWS } from "@/components/WebSocketProvider";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
  AreaChart, Area, Cell, ReferenceLine
} from "recharts";
import {
  Activity, Target,
  DollarSign, Zap, Award, Shield, AlertTriangle
} from "lucide-react";
import { API_URL } from "@/config";

export default function Analytics() {
  const { analytics: wsAnalytics, trades } = useWS();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (wsAnalytics) { setData(wsAnalytics); return; }
    fetch(`${API_URL}/api/analytics`)
      .then(r => r.json()).then(setData).catch(console.error);
  }, [wsAnalytics]);

  const fmt = (n: number, currency = false) => {
    if (typeof n !== "number") return currency ? "$0.00" : "0.00";
    if (currency) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
    return n.toFixed(2);
  };

  // Build equity curve
  const equityData = useMemo(() => {
    if (!data?.equityCurve) return [];
    return data.equityCurve.map((d: any, i: number) => ({
      index: i,
      equity: d.equity,
      label: d.time !== "START" ? new Date(d.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Start",
    }));
  }, [data]);

  // Build drawdown series from equity curve
  const drawdownData = useMemo(() => {
    const eq = equityData;
    if (eq.length === 0) return [];
    let peak = eq[0]?.equity ?? 0;
    return eq.map((d: any) => {
      if (d.equity > peak) peak = d.equity;
      const dd = peak > 0 ? ((peak - d.equity) / peak) * 100 : 0;
      return { index: d.index, drawdown: -dd, label: d.label };
    });
  }, [equityData]);

  // Build PnL distribution (histogram buckets)
  const pnlDist = useMemo(() => {
    const closed = (trades ?? []).filter((t: any) => t.pnl !== undefined && t.action?.startsWith("CLOSE"));
    if (closed.length === 0) return [];
    const pnls = closed.map((t: any) => t.pnl);
    const min = Math.min(...pnls), max = Math.max(...pnls);
    if (min === max) return [{ range: fmt(min, true), count: pnls.length, positive: pnls[0] >= 0 }];
    const bucketCount = Math.min(8, closed.length);
    const step = (max - min) / bucketCount;
    const buckets: { range: string; count: number; positive: boolean }[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const lo = min + i * step, hi = lo + step;
      const count = pnls.filter(p => p >= lo && (i === bucketCount - 1 ? p <= hi : p < hi)).length;
      buckets.push({ range: `$${lo.toFixed(0)}`, count, positive: (lo + hi) / 2 >= 0 });
    }
    return buckets;
  }, [trades]);

  // Monthly returns heatmap (by week of trade)
  const weeklyReturns = useMemo(() => {
    const closed = (trades ?? []).filter((t: any) => t.pnl !== undefined && t.action?.startsWith("CLOSE") && t.time !== "NOW");
    if (closed.length === 0) return [];
    const map = new Map<string, number>();
    closed.forEach((t: any) => {
      const d = new Date(t.time);
      const wk = `${d.toLocaleString("default", { month: "short" })} W${Math.ceil(d.getDate() / 7)}`;
      map.set(wk, (map.get(wk) ?? 0) + (t.pnl ?? 0));
    });
    return Array.from(map.entries())
      .slice(-12)
      .map(([week, pnl]) => ({ week, pnl, color: pnl >= 0 ? "#10b981" : "#ef4444" }));
  }, [trades]);

  const initialBalance = data?.netProfit !== undefined ? 10000 : 10000;
  const netProfit = data?.netProfit ?? 0;
  const profitFactor = data?.avgWin && data?.avgLoss
    ? Math.abs(((data.winRate / 100) * data.avgWin) / ((1 - data.winRate / 100) * Math.abs(data.avgLoss)))
    : 0;

  const kpis = [
    {
      label: "Net Profit",
      value: fmt(netProfit, true),
      sub: `${netProfit >= 0 ? "+" : ""}${fmt(data?.totalReturn ?? 0)}% return`,
      icon: DollarSign,
      color: netProfit >= 0 ? "text-emerald-400" : "text-red-400",
      border: netProfit >= 0 ? "border-emerald-500/20" : "border-red-500/20",
      glow:  netProfit >= 0 ? "shadow-emerald-500/10" : "shadow-red-500/10",
    },
    {
      label: "Win Rate",
      value: `${fmt(data?.winRate ?? 0)}%`,
      sub: `${data?.totalTrades ?? 0} total trades`,
      icon: Target,
      color: (data?.winRate ?? 0) >= 50 ? "text-emerald-400" : "text-amber-400",
      border: "border-blue-500/20",
      glow: "shadow-blue-500/10",
    },
    {
      label: "Sharpe Ratio",
      value: fmt(data?.sharpeRatio ?? 0),
      sub: (data?.sharpeRatio ?? 0) > 1 ? "Excellent risk-adj." : (data?.sharpeRatio ?? 0) > 0 ? "Positive edge" : "Needs improvement",
      icon: Award,
      color: (data?.sharpeRatio ?? 0) >= 1 ? "text-blue-400" : "text-amber-400",
      border: "border-blue-500/20",
      glow: "shadow-blue-500/10",
    },
    {
      label: "Max Drawdown",
      value: `-${fmt(data?.maxDrawdown ?? 0)}%`,
      sub: "Peak-to-trough",
      icon: Shield,
      color: "text-red-400",
      border: "border-red-500/20",
      glow: "shadow-red-500/10",
    },
    {
      label: "Avg R:R",
      value: `1 : ${fmt(data?.avgRR ?? 0)}`,
      sub: data?.avgRR >= 1.5 ? "Strong edge" : "Marginal",
      icon: Activity,
      color: (data?.avgRR ?? 0) >= 1 ? "text-emerald-400" : "text-amber-400",
      border: "border-purple-500/20",
      glow: "shadow-purple-500/10",
    },
    {
      label: "Profit Factor",
      value: fmt(profitFactor),
      sub: profitFactor >= 1.5 ? "Solid system" : profitFactor >= 1 ? "Breakeven+" : "Negative edge",
      icon: Zap,
      color: profitFactor >= 1 ? "text-purple-400" : "text-red-400",
      border: "border-purple-500/20",
      glow: "shadow-purple-500/10",
    },
  ];

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#0b0e14] text-gray-500 gap-3">
        <Activity className="w-8 h-8 animate-pulse text-blue-500/40" />
        <span className="text-sm">Loading analytics…</span>
      </div>
    );
  }

  return (
    <div className="h-full bg-[#0b0e14] overflow-y-auto p-5 space-y-6"
      style={{ scrollbarWidth: "thin", scrollbarColor: "#2b2b43 transparent" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-500" />
            Performance Analytics
          </h1>
          <p className="text-gray-500 text-xs mt-1">Live metrics · Auto-refreshes on every trade</p>
        </div>
        <div className="bg-[#131722] border border-[#2b2b43] rounded-lg px-4 py-2 text-right">
          <div className="text-[9px] text-gray-500 uppercase tracking-widest">Total Return</div>
          <div className={`text-xl font-bold font-mono ${netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {netProfit >= 0 ? "+" : ""}{fmt(data?.totalReturn ?? 0)}%
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label}
              className={`bg-[#131722] border ${k.border} rounded-xl p-4 flex flex-col gap-1.5 shadow-lg ${k.glow} hover:brightness-110 transition-all duration-200`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold">{k.label}</span>
                <Icon className={`w-3.5 h-3.5 ${k.color}`} />
              </div>
              <span className={`text-xl font-bold font-mono leading-none ${k.color}`}>{k.value}</span>
              <span className="text-[9px] text-gray-600 leading-tight">{k.sub}</span>
            </div>
          );
        })}
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Equity Curve — 2/3 width */}
        <div className="lg:col-span-2 bg-[#131722] border border-[#2b2b43] rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Equity Curve</h3>
            <span className={`text-xs font-mono font-bold ${netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              ${(initialBalance + netProfit).toFixed(2)}
            </span>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={netProfit >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={netProfit >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e222d" vertical={false} />
                <XAxis dataKey="index" tick={{ fill: "#4b5563", fontSize: 9 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fill: "#4b5563", fontSize: 9 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} tickFormatter={v => `$${v}`} />
                <RechartsTooltip
                  contentStyle={{ background: "#1e222d", border: "1px solid #2b2b43", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any) => [`$${parseFloat(v).toFixed(2)}`, "Equity"]}
                  labelFormatter={(l: any) => equityData[l]?.label ?? `Trade #${l}`}
                />
                <ReferenceLine y={initialBalance} stroke="#374151" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="equity"
                  stroke={netProfit >= 0 ? "#10b981" : "#ef4444"} strokeWidth={2}
                  fill="url(#eqGrad)" isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Trade averages */}
        <div className="bg-[#131722] border border-[#2b2b43] rounded-xl p-5 flex flex-col gap-4 shadow-lg">
          <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Trade Breakdown</h3>
          <div className="flex-1 space-y-3 font-mono text-xs">
            {[
              { label: "Avg Trade", val: data.avgTrade, positive: data.avgTrade >= 0 },
              { label: "Avg Win",   val: data.avgWin,   positive: true },
              { label: "Avg Loss",  val: data.avgLoss,  positive: false },
            ].map(row => (
              <div key={row.label} className="flex justify-between items-center bg-[#1a1f2e] px-3 py-2.5 rounded-lg border border-[#2b2b43]">
                <span className="text-gray-500">{row.label}</span>
                <span className={`font-bold ${row.positive ? "text-emerald-400" : "text-red-400"}`}>
                  {fmt(row.val, true)}
                </span>
              </div>
            ))}
          </div>
          {/* Sharpe gauge */}
          <div className="bg-[#1a1f2e] border border-[#2b2b43] rounded-lg p-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[9px] uppercase text-gray-500 tracking-widest">Sharpe</span>
              <span className="text-sm font-bold font-mono text-blue-400">{fmt(data.sharpeRatio)}</span>
            </div>
            <div className="h-1.5 bg-[#2b2b43] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-700"
                style={{ width: `${Math.min(100, Math.max(0, (data.sharpeRatio / 3) * 100))}%` }}
              />
            </div>
            <div className="flex justify-between text-[8px] text-gray-600 mt-1">
              <span>0</span><span>1</span><span>2</span><span>3+</span>
            </div>
          </div>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Drawdown chart */}
        <div className="lg:col-span-2 bg-[#131722] border border-[#2b2b43] rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest">Drawdown Profile</h3>
            <span className="text-[10px] text-red-400 font-mono font-bold">
              Max: -{fmt(data.maxDrawdown)}%
            </span>
          </div>
          <div className="h-40">
            {drawdownData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={drawdownData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.02} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.25} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1e222d" vertical={false} />
                  <XAxis dataKey="index" tick={{ fill: "#4b5563", fontSize: 9 }} tickLine={false} axisLine={false} minTickGap={40} />
                  <YAxis tick={{ fill: "#4b5563", fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `${v.toFixed(1)}%`} />
                  <ReferenceLine y={0} stroke="#374151" />
                  <RechartsTooltip
                    contentStyle={{ background: "#1e222d", border: "1px solid #2b2b43", borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any) => [`${parseFloat(v).toFixed(2)}%`, "Drawdown"]}
                  />
                  <Area type="monotone" dataKey="drawdown"
                    stroke="#ef4444" strokeWidth={1.5}
                    fill="url(#ddGrad)" isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-600 text-xs">No drawdown data yet</div>
            )}
          </div>
        </div>

        {/* PnL Distribution */}
        <div className="bg-[#131722] border border-[#2b2b43] rounded-xl p-5 shadow-lg">
          <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest mb-4">PnL Distribution</h3>
          <div className="h-40">
            {pnlDist.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pnlDist} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#1e222d" vertical={false} />
                  <XAxis dataKey="range" tick={{ fill: "#4b5563", fontSize: 8 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#4b5563", fontSize: 8 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{ background: "#1e222d", border: "1px solid #2b2b43", borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any) => [v, "Trades"]}
                  />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {pnlDist.map((entry, i) => (
                      <Cell key={i} fill={entry.positive ? "#10b981" : "#ef4444"} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-600 text-xs">No closed trades yet</div>
            )}
          </div>
        </div>
      </div>

      {/* Weekly returns heatmap */}
      {weeklyReturns.length > 0 && (
        <div className="bg-[#131722] border border-[#2b2b43] rounded-xl p-5 shadow-lg">
          <h3 className="text-xs font-bold text-gray-300 uppercase tracking-widest mb-4">Weekly Returns</h3>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyReturns} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#1e222d" vertical={false} />
                <XAxis dataKey="week" tick={{ fill: "#4b5563", fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#4b5563", fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <ReferenceLine y={0} stroke="#374151" />
                <RechartsTooltip
                  contentStyle={{ background: "#1e222d", border: "1px solid #2b2b43", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any) => [`$${parseFloat(v).toFixed(2)}`, "P&L"]}
                />
                <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                  {weeklyReturns.map((entry, i) => (
                    <Cell key={i} fill={entry.pnl >= 0 ? "#10b981" : "#ef4444"} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* No trades notice */}
      {(data.totalTrades ?? 0) === 0 && (
        <div className="flex items-center gap-3 bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-sm text-amber-400">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          No closed trades yet. Start the strategy engine to begin generating performance data.
        </div>
      )}
    </div>
  );
}

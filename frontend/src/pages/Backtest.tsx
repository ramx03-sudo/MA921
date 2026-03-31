import { useState, useEffect, useRef } from "react";
import {
  createChart, ColorType,
  CandlestickSeries, LineSeries, AreaSeries,
  createSeriesMarkers,
  type IChartApi,
} from "lightweight-charts";
import {
  Play, TrendingUp, TrendingDown, BarChart2, Activity,
  Target, AlertTriangle, Clock, DollarSign, Percent, Award,
} from "lucide-react";
import { API_URL } from "@/config";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Trade {
  entry_time: string; exit_time: string;
  entry_unix: number; exit_unix: number;
  direction: "LONG" | "SHORT";
  entry_price: number; exit_price: number;
  pnl: number; balance: number;
  open_at_end?: boolean;
}
interface Metrics {
  initial_balance: number; final_balance: number;
  total_pnl: number; total_return_pct: number;
  total_trades: number; win_rate: number;
  avg_win: number; avg_loss: number;
  profit_factor: number | null;
  max_drawdown_pct: number; sharpe_ratio: number; data_bars: number;
}
interface BtResult {
  candle_data:   { time: number; open: number; high: number; low: number; close: number }[];
  ma9_data:      { time: number; value: number }[];
  ma21_data:     { time: number; value: number }[];
  ma50_data:     { time: number; value: number }[];
  ma200_data:    { time: number; value: number }[];
  trade_markers: any[];
  equity_curve:  { time: number; value: number }[];
  trades: Trade[]; metrics: Metrics;
  period: string; interval: string; period_label: string;
}

// ─── Period chips (all use 1-minute candles) ─────────────────────────────────
const PERIODS = [
  { id: "1H",  label: "1H",  desc: "Last 1 hour · 1m candles"   },
  { id: "5H",  label: "5H",  desc: "Last 5 hours · 1m candles"  },
  { id: "12H", label: "12H", desc: "Last 12 hours · 1m candles" },
  { id: "1D",  label: "1D",  desc: "Last 24 hours · 1m candles" },
  { id: "2D",  label: "2D",  desc: "Last 2 days · 1m candles"   },
  { id: "3D",  label: "3D",  desc: "Last 3 days · 1m candles"   },
  { id: "5D",  label: "5D",  desc: "Last 5 days · 1m candles"   },
  { id: "7D",  label: "7D",  desc: "Max 7 days · 1m candles"    },
] as const;
type PeriodId = typeof PERIODS[number]["id"];

const fmt = (n: number, d = 2) =>
  Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

// ─── Metric card ──────────────────────────────────────────────────────────────
function MC({ label, value, sub, icon: I, color = "text-white" }: {
  label: string; value: string; sub?: string; icon: any; color?: string;
}) {
  return (
    <div className="bg-[#161b27] border border-[#252d3d] rounded-xl p-3 flex flex-col gap-1 hover:border-blue-500/30 transition-colors">
      <div className="flex justify-between">
        <span className="text-[8px] font-bold text-gray-600 uppercase tracking-widest">{label}</span>
        <I className="h-2.5 w-2.5 text-gray-700" />
      </div>
      <div className={`text-base font-mono font-bold leading-none ${color}`}>{value}</div>
      {sub && <div className="text-[8px] text-gray-700 font-mono">{sub}</div>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Backtest() {
  const [period,  setPeriod]  = useState<PeriodId>("1D");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [result,  setResult]  = useState<BtResult | null>(null);
  const [filter,  setFilter]  = useState<"all" | "win" | "loss">("all");
  const [hovered, setHovered] = useState<number | null>(null);

  // Chart DOM targets — always in DOM so refs are stable
  const priceRef  = useRef<HTMLDivElement>(null);
  const equityRef = useRef<HTMLDivElement>(null);

  // Chart instances (destroyed & recreated on each result)
  const priceChartRef  = useRef<IChartApi | null>(null);
  const equityChartRef = useRef<IChartApi | null>(null);

  // ── Build charts + populate data in one shot ────────────────────────────────
  useEffect(() => {
    if (!result) return;

    // Wait one animation frame so conditional render has committed to DOM  
    const raf = requestAnimationFrame(() => {
      if (!priceRef.current || !equityRef.current) return;

      // ── Destroy old instances ──────────────────────────────────────────
      try { priceChartRef.current?.remove();  } catch (_) {}
      try { equityChartRef.current?.remove(); } catch (_) {}
      priceChartRef.current  = null;
      equityChartRef.current = null;

      const BASE_OPTS = {
        layout: { background: { type: ColorType.Solid, color: "#0d1117" }, textColor: "#6b7280" },
        grid:   { vertLines: { color: "#161b27" }, horzLines: { color: "#161b27" } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: "#2b2b43", scaleMarginTop: 0.08, scaleMarginBottom: 0.08 },
        timeScale: { borderColor: "#2b2b43", timeVisible: true, secondsVisible: false },
        autoSize: true,  // ← fills container automatically
      };

      // ── Price chart ────────────────────────────────────────────────────
      const pc = createChart(priceRef.current, BASE_OPTS as any);
      priceChartRef.current = pc;

      // v5 API: addSeries(SeriesClass, opts)
      const candles = pc.addSeries(CandlestickSeries, {
        upColor: "#26a69a", downColor: "#ef5350",
        borderUpColor: "#26a69a", borderDownColor: "#ef5350",
        wickUpColor: "#26a69a", wickDownColor: "#ef5350",
      });

      const ln = (color: string, w: number) =>
        pc.addSeries(LineSeries, { color, lineWidth: w as any, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });

      const ma9S   = ln("#ffffff", 1);
      const ma21S  = ln("#3b82f6", 1);
      const ma50S  = ln("#22c55e", 1.5);
      const ma200S = ln("#ef4444", 1.5);

      candles.setData(result.candle_data as any);
      ma9S.setData(result.ma9_data   as any);
      ma21S.setData(result.ma21_data  as any);
      ma50S.setData(result.ma50_data  as any);
      ma200S.setData(result.ma200_data as any);
      createSeriesMarkers(candles, result.trade_markers as any);
      pc.timeScale().fitContent();

      // ── Equity chart ───────────────────────────────────────────────────
      const ec = createChart(equityRef.current, BASE_OPTS as any);
      equityChartRef.current = ec;

      const equity = ec.addSeries(AreaSeries, {
        lineColor: "#3b82f6",
        topColor:  "rgba(59,130,246,0.18)",
        bottomColor: "rgba(59,130,246,0.01)",
        lineWidth: 2,
      });

      equity.setData(result.equity_curve as any);

      // Trade markers on equity curve
      const eqMarkers = result.trades.map(t => ({
        time: t.exit_unix as any,
        position: t.pnl >= 0 ? "aboveBar" as const : "belowBar" as const,
        color: t.pnl >= 0 ? "#10b981" : "#ef4444",
        shape: "circle" as const,
        size: 1,
      }));
      createSeriesMarkers(equity, eqMarkers as any);
      ec.timeScale().fitContent();

      // Sync time scales
      pc.timeScale().subscribeVisibleLogicalRangeChange(r => {
        if (r) ec.timeScale().setVisibleLogicalRange(r);
      });
      ec.timeScale().subscribeVisibleLogicalRangeChange(r => {
        if (r) pc.timeScale().setVisibleLogicalRange(r);
      });
    });

    return () => cancelAnimationFrame(raf);
  }, [result]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      try { priceChartRef.current?.remove();  } catch (_) {}
      try { equityChartRef.current?.remove(); } catch (_) {}
    };
  }, []);

  // ── Run backtest ────────────────────────────────────────────────────────────
  const run = async (p: PeriodId) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch(`${API_URL}/api/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: p }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "Backtest failed");
      setResult(await r.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const selectPeriod = (p: PeriodId) => { setPeriod(p); run(p); };

  // Jump chart to trade
  const jumpTo = (t: Trade) => {
    if (!priceChartRef.current) return;
    const pad = Math.max((t.exit_unix - t.entry_unix) * 0.3, 3600);
    priceChartRef.current.timeScale().setVisibleRange({
      from: (t.entry_unix - pad) as any,
      to:   (t.exit_unix  + pad) as any,
    });
  };

  const m       = result?.metrics;
  const wins    = result?.trades.filter(t => t.pnl > 0).length  ?? 0;
  const losses  = result?.trades.filter(t => t.pnl <= 0).length ?? 0;
  const filtered = result?.trades.filter(t =>
    filter === "all" ? true : filter === "win" ? t.pnl > 0 : t.pnl <= 0) ?? [];

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">

      {/* ── Header + period chips ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          <BarChart2 className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-bold text-white">Backtesting Lab</span>
          <span className="text-[9px] text-gray-600 font-mono ml-1">MA9/21/50/200 · Gold GC=F</span>
        </div>
        <div className="flex items-center gap-1 bg-[#131722] border border-[#252d3d] rounded-xl p-1">
          {PERIODS.map(p => (
            <button key={p.id} id={`bt-${p.id}`} title={p.desc}
              onClick={() => selectPeriod(p.id)} disabled={loading}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all disabled:opacity-40 ${
                period === p.id
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-500/25"
                  : "text-gray-500 hover:text-gray-200 hover:bg-white/5"
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        <button id="bt-run" onClick={() => run(period)} disabled={loading}
          className="ml-auto flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[11px] font-bold rounded-xl transition-all shadow shadow-blue-500/20">
          {loading
            ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Running…</>
            : <><Play className="h-3.5 w-3.5" />Run</>}
        </button>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2 text-[11px] text-red-400 shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{error}
        </div>
      )}

      {/* ── Empty / loading overlay ───────────────────────────────────────── */}
      {!result && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-[#161b27] border border-[#252d3d] flex items-center justify-center">
            <BarChart2 className="h-7 w-7 text-blue-500/40" />
          </div>
          <p className="text-sm font-semibold text-gray-400">Select a period to start</p>
          <p className="text-[10px] text-gray-600 font-mono">All periods use real 1-minute GC=F candles · up to 7 days available</p>
          <div className="flex gap-4 text-[10px] font-mono bg-[#161b27] border border-[#252d3d] rounded-xl px-5 py-3 text-gray-600">
            <span><span className="text-cyan-400">▲</span> LONG entry</span>
            <span><span className="text-rose-400">▼</span> SHORT entry</span>
            <span><span className="text-emerald-400">●</span> exit profit</span>
            <span><span className="text-red-400">●</span> exit loss</span>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <span className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-[11px] text-gray-500 font-mono">
            Fetching GC=F 1m candles · {PERIODS.find(p => p.id === period)?.desc}…
          </p>
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────────────── */}
      {result && m && (
        <div className="flex-1 flex flex-col gap-2 overflow-hidden min-h-0">

          {/* Metrics */}
          <div className="grid grid-cols-8 gap-2 shrink-0">
            <MC label="Total Return" icon={m.total_return_pct >= 0 ? TrendingUp : TrendingDown}
              value={`${m.total_return_pct >= 0 ? "+" : ""}${fmt(m.total_return_pct)}%`}
              sub={`$${fmt(m.final_balance)} final`}
              color={m.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400"} />
            <MC label="Net PnL" icon={DollarSign}
              value={`${m.total_pnl >= 0 ? "+" : "-"}$${fmt(m.total_pnl)}`}
              color={m.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"} />
            <MC label="Win Rate" icon={Target}
              value={`${fmt(m.win_rate, 1)}%`} sub={`${wins}W · ${losses}L`}
              color={m.win_rate >= 50 ? "text-emerald-400" : "text-rose-400"} />
            <MC label="Avg Win" icon={Award} value={`+$${fmt(m.avg_win)}`} color="text-emerald-400" />
            <MC label="Avg Loss" icon={TrendingDown} value={`-$${fmt(Math.abs(m.avg_loss))}`} color="text-rose-400" />
            <MC label="Max DD" icon={AlertTriangle}
              value={`${fmt(m.max_drawdown_pct)}%`}
              color={m.max_drawdown_pct > 20 ? "text-red-400" : "text-amber-400"} />
            <MC label="Sharpe" icon={Activity} value={fmt(m.sharpe_ratio, 3)}
              color={m.sharpe_ratio >= 1 ? "text-blue-400" : "text-gray-300"} />
            <MC label="Profit Factor" icon={Percent}
              value={m.profit_factor != null ? fmt(m.profit_factor) : "—"}
              sub={`${m.data_bars.toLocaleString()} bars`}
              color={m.profit_factor != null && m.profit_factor >= 1.5 ? "text-emerald-400" : "text-gray-300"} />
          </div>

          {/* Charts + trade log */}
          <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">

            {/* Price chart + equity curve */}
            <div className="flex-1 flex flex-col gap-2 min-h-0 overflow-hidden">

              {/* MA legend */}
              <div className="flex items-center gap-3 bg-[#131722] border border-[#252d3d] px-3 py-1.5 rounded-lg text-[9px] font-mono shrink-0">
                <span className="flex items-center gap-1"><span className="w-4 h-px bg-white inline-block" />MA9</span>
                <span className="flex items-center gap-1"><span className="w-4 h-px bg-blue-500 inline-block" />MA21</span>
                <span className="flex items-center gap-1"><span className="w-4 h-px bg-green-500 inline-block" />MA50</span>
                <span className="flex items-center gap-1"><span className="w-4 h-px bg-red-500 inline-block" />MA200</span>
                <span className="mx-2 text-gray-700">|</span>
                <span className="text-cyan-400">▲ BUY</span>
                <span className="text-rose-400 ml-2">▼ SELL</span>
                <span className="text-emerald-400 ml-2">● exit+</span>
                <span className="text-red-400 ml-2">● exit−</span>
                <span className="ml-auto text-gray-700">
                  {result.period_label} · 1MIN · {m.data_bars.toLocaleString()} bars
                </span>
              </div>

              {/* Price chart — explicit flex-[3] so it gets a real height */}
              <div className="flex-[3] bg-[#0d1117] border border-[#252d3d] rounded-xl overflow-hidden min-h-0">
                <div ref={priceRef} style={{ width: "100%", height: "100%" }} />
              </div>

              {/* Equity curve */}
              <div className="flex-1 bg-[#0d1117] border border-[#252d3d] rounded-xl overflow-hidden min-h-0 flex flex-col">
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#1a2030] shrink-0">
                  <Activity className="h-3 w-3 text-blue-400" />
                  <span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">Equity Curve</span>
                  <span className="ml-auto text-[9px] font-mono">
                    <span className="text-gray-700">${fmt(m.initial_balance)} → </span>
                    <span className={m.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                      ${fmt(m.final_balance)}
                    </span>
                  </span>
                </div>
                <div ref={equityRef} style={{ width: "100%", flex: 1, minHeight: 0 }} />
              </div>
            </div>

            {/* Trade log */}
            <div className="w-[270px] shrink-0 bg-[#131722] border border-[#252d3d] rounded-xl flex flex-col overflow-hidden">
              <div className="px-3 py-2 border-b border-[#252d3d] flex items-center gap-2 shrink-0">
                <Clock className="h-3 w-3 text-blue-500" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Trades</span>
                <span className="ml-auto text-[9px] font-mono text-gray-600">{result.trades.length}</span>
              </div>
              <div className="flex border-b border-[#252d3d] shrink-0">
                {(["all","win","loss"] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`flex-1 py-1.5 text-[8px] font-bold uppercase tracking-wider transition-colors ${
                      filter === f ? "text-blue-400 border-b-2 border-blue-500" : "text-gray-700 hover:text-gray-500"
                    }`}>
                    {f==="all"?`All (${result.trades.length})`:f==="win"?`W(${wins})`:`L(${losses})`}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-1.5 space-y-1 custom-scrollbar">
                {filtered.map((t, i) => {
                  const isWin = t.pnl > 0;
                  const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"2-digit" });
                  return (
                    <button key={i} onClick={() => jumpTo(t)}
                      onMouseEnter={() => setHovered(i)}
                      onMouseLeave={() => setHovered(null)}
                      className={`w-full text-left p-2 rounded-lg border text-[9px] font-mono transition-all ${
                        hovered === i
                          ? "border-blue-500/40 bg-blue-500/5"
                          : isWin
                            ? "bg-emerald-950/20 border-emerald-900/30"
                            : "bg-red-950/20 border-red-900/30"
                      }`}>
                      <div className="flex justify-between mb-1">
                        <span className={`font-bold text-[10px] ${t.direction === "LONG" ? "text-cyan-400" : "text-rose-400"}`}>
                          {t.direction === "LONG" ? "▲" : "▼"} {t.direction}
                          {t.open_at_end && <span className="ml-1 text-[7px] text-amber-500">[END]</span>}
                        </span>
                        <span className={`font-bold ${isWin ? "text-emerald-400" : "text-red-400"}`}>
                          {isWin ? "+" : ""}${fmt(t.pnl)}
                        </span>
                      </div>
                      <div className="text-gray-700 space-y-0.5">
                        <div className="flex justify-between">
                          <span>In</span>
                          <span className="text-gray-500">${fmt(t.entry_price)} · {fmtDate(t.entry_time)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Out</span>
                          <span className="text-gray-500">${fmt(t.exit_price)} · {fmtDate(t.exit_time)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

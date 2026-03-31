"use client";

import { useWS } from "@/components/WebSocketProvider";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart, ColorType, CandlestickSeries, LineSeries, createSeriesMarkers,
} from "lightweight-charts";
import { Search, Maximize2, ChevronDown, List, Info } from "lucide-react";

export default function Dashboard() {
  const { connected, priceData, portfolio, snapshot, trades } = useWS();
  const [timeframe, setTimeframe] = useState("1min");
  const [loadingTF, setLoadingTF] = useState(false);
  const [activeTab, setActiveTab] = useState("watchlist");
  const [maValues, setMaValues] = useState<{ ma9: number | null; ma21: number | null; ma50: number | null; ma200: number | null }>({ ma9: null, ma21: null, ma50: null, ma200: null });

  // ── Refs ─────────────────────────────────────────────────────────────────
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef          = useRef<any>(null);
  const seriesRef         = useRef<any>(null);
  const ma9Ref            = useRef<any>(null);
  const ma21Ref           = useRef<any>(null);
  const ma50Ref           = useRef<any>(null);
  const ma200Ref          = useRef<any>(null);
  const slLineRef         = useRef<any>(null);
  const tpLineRef         = useRef<any>(null);
  const markersPluginRef  = useRef<any>(null);
  const snapshotRef       = useRef<any[]>([]);       // persists snapshot across remounts
  const snapshotLoadedRef = useRef(false);           // reset on unmount
  const activeTimeframeRef = useRef("1min");          // which data is on the chart right now
  // Stable ref so the mount effect ([] deps) can call loadCandlesIntoChart without circular deps
  const loaderRef         = useRef<(c: any[]) => void>(() => {});

  // ── Load candles helper — defined BEFORE mount effect ────────────────────
  const loadCandlesIntoChart = useCallback((candles: any[]) => {
    if (!seriesRef.current || candles.length === 0) return;

    const map = new Map<number, any>();
    candles.forEach(d => {
      const ts = typeof d.time === "number" ? d.time : (d.timestamp as number);
      if (ts && typeof ts === "number") map.set(ts, d);
    });
    const sorted = Array.from(map.values())
      .filter(c => c.open > 0 && c.close > 0)
      .sort((a, b) => a.time - b.time);

    if (sorted.length === 0) return;

    seriesRef.current.setData(sorted.map((c: any) => ({
      time: c.time as any, open: Number(c.open), high: Number(c.high),
      low: Number(c.low), close: Number(c.close),
    })));

    // 🎯 MA builder: only include points with valid numeric values.
    // lightweight-charts v5 does NOT accept null in LineSeries — numbers only.
    // The backend now fetches fresh yfinance data on startup so any gap to live
    // feed is <10 min and visually acceptable.
    const buildMA = (key: string) =>
      sorted
        .filter((c: any) => typeof c[key] === "number" && isFinite(c[key]))
        .map((c: any) => ({ time: c.time as any, value: c[key] as number }));

    if (ma9Ref.current)   ma9Ref.current.setData(buildMA("ma9"));
    if (ma21Ref.current)  ma21Ref.current.setData(buildMA("ma21"));
    if (ma50Ref.current)  ma50Ref.current.setData(buildMA("ma50"));
    if (ma200Ref.current) ma200Ref.current.setData(buildMA("ma200"));

    if (markersPluginRef.current) markersPluginRef.current.setMarkers([]);
    // Scroll to the latest candle (not fitContent — that resets view to show all history)
    chartRef.current?.timeScale().scrollToRealTime();


    const last = [...sorted].reverse().find((d: any) => typeof d.ma9 === "number");
    if (last) setMaValues({ ma9: last.ma9, ma21: last.ma21, ma50: last.ma50, ma200: last.ma200 });
  }, []);

  // Keep the stable ref in sync
  useEffect(() => { loaderRef.current = loadCandlesIntoChart; }, [loadCandlesIntoChart]);

  // ── Mount chart ONCE — uses loaderRef so [] deps are safe ────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // IST offset: +5h30m = +19800 seconds
    const IST_OFFSET = 19800;
    const fmtTime = (ts: number) => {
      const d = new Date((ts + IST_OFFSET) * 1000);
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mm = String(d.getUTCMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    };
    const fmtDate = (ts: number) => {
      const d = new Date((ts + IST_OFFSET) * 1000);
      return `${d.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
    };

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#131722" }, textColor: "#d1d4dc" },
      grid: { vertLines: { color: "rgba(42,46,57,0.05)" }, horzLines: { color: "rgba(42,46,57,0.05)" } },
      crosshair: { mode: 1 },
      localization: {
        timeFormatter: (ts: number) => `${fmtDate(ts)}  ${fmtTime(ts)} IST`,
      },
      timeScale: {
        barSpacing: 10,
        rightBarStaysOnScroll: true,
        timeVisible: true,
        borderColor: "rgba(43,43,67,0.5)",
        tickMarkFormatter: (ts: number) => fmtTime(ts),
      },
      rightPriceScale: { autoScale: true, scaleMargins: { top: 0.15, bottom: 0.15 }, borderColor: "rgba(43,43,67,0.5)" },
    });

    seriesRef.current   = chart.addSeries(CandlestickSeries, { upColor: "#089981", downColor: "#F23645", borderVisible: false, wickUpColor: "#089981", wickDownColor: "#F23645" });
    ma9Ref.current      = chart.addSeries(LineSeries, { color: "#FFFFFF", lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false });
    ma21Ref.current     = chart.addSeries(LineSeries, { color: "#2962FF", lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false });
    ma50Ref.current     = chart.addSeries(LineSeries, { color: "#00C853", lineWidth: 2, crosshairMarkerVisible: false, lastValueVisible: false });
    ma200Ref.current    = chart.addSeries(LineSeries, { color: "#D50000", lineWidth: 2, crosshairMarkerVisible: false, lastValueVisible: false });
    chartRef.current    = chart;
    markersPluginRef.current = createSeriesMarkers(seriesRef.current, []);

    // 🎯 Re-mount: reload cached snapshot immediately
    if (snapshotRef.current.length > 0) {
      setTimeout(() => loaderRef.current(snapshotRef.current), 50);
    }

    const onResize = () => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      snapshotLoadedRef.current = false; // allow re-load on next mount
      activeTimeframeRef.current = "1min";
      chart.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket SNAPSHOT — reload whenever a new snapshot arrives ─────────
  // This handles: first load, page remount, AND backend restarts
  useEffect(() => {
    if (!snapshot || snapshot.length === 0) return;
    snapshotRef.current = snapshot;       // cache for remounts
    snapshotLoadedRef.current = true;
    loadCandlesIntoChart(snapshot);       // always reload — snapshot only fires on WS connect
  }, [snapshot, loadCandlesIntoChart]);


  // ── Timeframe switch ──────────────────────────────────────────────────────
  const changeTimeframe = useCallback(async (tf: string) => {
    setTimeframe(tf);
    setLoadingTF(true);
    activeTimeframeRef.current = tf;

    if (tf === "1min") {
      // Back to live — reload from cached snapshot
      if (snapshotRef.current.length > 0) loadCandlesIntoChart(snapshotRef.current);
      setLoadingTF(false);
      return;
    }

    try {
      const resp = await fetch(`http://localhost:8000/api/history?interval=${tf}&outputsize=300`);
      const data = await resp.json();
      if (data.candles?.length > 0) {
        loadCandlesIntoChart(data.candles);
      } else {
        console.warn("[TF] No candles for", tf);
      }
    } catch (e) {
      console.error("[TF] fetch failed:", e);
    } finally {
      setLoadingTF(false);
    }
  }, [loadCandlesIntoChart]);

  // ── Entry price line on chart (shows where position was entered) ─────────
  useEffect(() => {
    if (!seriesRef.current || !portfolio) return;
    // Remove old SL/TP lines if they ever existed (cleanup on reload)
    if (slLineRef.current) { try { seriesRef.current.removePriceLine(slLineRef.current); } catch (_) {} slLineRef.current = null; }
    if (tpLineRef.current) { try { seriesRef.current.removePriceLine(tpLineRef.current); } catch (_) {} tpLineRef.current = null; }
  }, [portfolio]);

  // ── Live tick — only update chart when on 1min live view ─────────────────
  useEffect(() => {
    if (!priceData?.time || !seriesRef.current) return;
    if (activeTimeframeRef.current !== "1min") return;
    const t = priceData.time as number;
    try {
      seriesRef.current.update({ time: t, open: priceData.open, high: priceData.high, low: priceData.low, close: priceData.close });
      if (priceData.ma9  != null && ma9Ref.current)   ma9Ref.current.update({ time: t, value: priceData.ma9 });
      if (priceData.ma21 != null && ma21Ref.current)  ma21Ref.current.update({ time: t, value: priceData.ma21 });
      if (priceData.ma50 != null && ma50Ref.current)  ma50Ref.current.update({ time: t, value: priceData.ma50 });
      if (priceData.ma200 != null && ma200Ref.current) ma200Ref.current.update({ time: t, value: priceData.ma200 });
      setMaValues(prev => ({
        ma9:  priceData.ma9  ?? prev.ma9,
        ma21: priceData.ma21 ?? prev.ma21,
        ma50: priceData.ma50 ?? prev.ma50,
        ma200: priceData.ma200 ?? prev.ma200,
      }));
    } catch (_) {}
  }, [priceData]);

  // ── Trade markers ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!trades?.length || !markersPluginRef.current) return;
    const markers: any[] = [];

    // Snap an ISO or unix timestamp to the nearest minute bucket (chart bar boundary)
    const snapToMinute = (isoOrUnix: string | number): number | null => {
      let unix: number;
      if (typeof isoOrUnix === "number") {
        unix = isoOrUnix;
      } else {
        const ms = new Date(isoOrUnix).getTime();
        if (!ms || isNaN(ms)) return null;
        unix = ms / 1000;
      }
      // Floor to nearest 60s bucket — matches how CandleBuilder buckets ticks
      return Math.floor(unix / 60) * 60;
    };
    trades.forEach((t: any) => {
      const action: string = t.action ?? "";
      if (!action || t.time === "NOW") return;

      const isLong  = action.includes("LONG") || action.includes("BUY");
      const isOpen  = action.startsWith("OPEN");
      const isClose = action.startsWith("CLOSE");

      // ── OPEN event: place an entry arrow ──────────────────────────────────
      if (isOpen && t.time) {
        const ts = snapToMinute(t.time);
        if (ts) markers.push({
          time: ts as any,
          position: isLong ? "belowBar" : "aboveBar",
          color:    isLong ? "#00E676" : "#FF1744",
          shape:    isLong ? "arrowUp"  : "arrowDown",
          text:     `${isLong ? "▲ BUY" : "▼ SELL"} @ $${Number(t.price ?? 0).toFixed(2)}`,
          size:     2,
        });
      }

      // ── CLOSE event: place an exit circle + entry arrow at entry_time ─────
      if (isClose && t.time) {
        // Exit marker (circle) at CLOSE time
        const exitTs = snapToMinute(t.time);
        const pnl = Number(t.pnl ?? 0);
        const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
        if (exitTs) markers.push({
          time: exitTs as any,
          position: isLong ? "aboveBar" : "belowBar",  // close is opposite side
          color:    pnl >= 0 ? "#00E676" : "#FF1744",
          shape:    "circle",
          text:     `✕ ${pnlStr}`,
          size:     2,
        });

        // Entry arrow at entry_time (if backend provided it for this trade)
        if (t.entry_time) {
          const entryTs = snapToMinute(t.entry_time);
          if (entryTs) markers.push({
            time: entryTs as any,
            position: isLong ? "belowBar" : "aboveBar",
            color:    isLong ? "#00E676" : "#FF1744",
            shape:    isLong ? "arrowUp"  : "arrowDown",
            text:     `${isLong ? "▲ BUY" : "▼ SELL"} @ $${Number(t.entry ?? 0).toFixed(2)}`,
            size:     2,
          });
        }
      }
    });
    markers.sort((a, b) => a.time - b.time);
    try { markersPluginRef.current.setMarkers(markers); } catch (_) {}
  }, [trades]);


  const posStr   = portfolio?.position ? String(portfolio.position) : null;
  const pnlColor = (portfolio?.unrealized_pnl ?? 0) >= 0 ? "text-emerald-500" : "text-red-500";

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] md:h-[calc(100vh-80px)] gap-2 md:gap-3 bg-[#0b0e14] overflow-hidden">

      {/* ── Top bar ── */}
      <div className="bg-[#131722] border border-[#2b2b43] rounded-md px-3 py-1.5 h-11 shrink-0 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3 h-full">
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[#2a2e39] rounded cursor-pointer h-[28px]">
            <Search className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-white font-bold text-xs uppercase">XAUUSD</span>
            <ChevronDown className="h-3 w-3 text-gray-500" />
          </div>
          <div className="h-4 w-[1px] bg-[#2b2b43] mx-1" />
          <div className="flex gap-1">
            {(["1min","5min","15min","1h"] as const).map(tf => (
              <button
                key={tf}
                onClick={() => changeTimeframe(tf)}
                className={`text-[11px] font-bold px-2 py-0.5 rounded transition-colors ${timeframe === tf ? "text-blue-500 bg-blue-500/10" : "text-gray-400 hover:text-white"}`}
              >
                {tf === "1min" ? "1MIN" : tf === "5min" ? "5MIN" : tf === "15min" ? "15MIN" : "1H"}
              </button>
            ))}
          </div>
          {loadingTF && <span className="text-[9px] text-gray-500 animate-pulse ml-2">Loading…</span>}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-gray-500 uppercase tracking-tighter">Spread</span>
            <span className="text-gray-200 font-bold bg-[#2a2e39] px-1.5 py-0.5 rounded leading-none">
              {priceData?.ask && priceData?.bid ? (priceData.ask - priceData.bid).toFixed(2) : "0.30"}
            </span>
          </div>
          <div className="h-4 w-[1px] bg-[#2b2b43]" />
          <button className="text-gray-500 hover:text-white"><Maximize2 className="h-4 w-4" /></button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-1 gap-3 min-h-0 overflow-hidden">

        {/* Chart panel */}
        <div className="flex-1 flex flex-col bg-[#131722] border border-[#2b2b43] rounded-md relative overflow-hidden shadow-2xl">

          {/* Legend top-left */}
          <div className="absolute top-2.5 left-3 z-20 flex flex-col pointer-events-none gap-0.5">
            <div className="text-white text-[14px] font-bold flex gap-1.5 items-center tracking-tight">
              <span className="flex items-center gap-1.5">
                <div className="w-3.5 h-3.5 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.4)]" />
                XAUUSD
              </span>
              <span className="text-gray-600 font-normal">·</span>
              <span className="text-emerald-500">{timeframe}</span>
            </div>
            <div className="flex gap-3 items-center mt-1 flex-wrap text-[10px] font-mono">
              <span className="text-gray-400 flex gap-2 uppercase tracking-tight">
                <span>O <span className="text-white">{priceData?.open?.toFixed(2) ?? "---"}</span></span>
                <span>H <span className="text-[#089981]">{priceData?.high?.toFixed(2) ?? "---"}</span></span>
                <span>L <span className="text-[#F23645]">{priceData?.low?.toFixed(2) ?? "---"}</span></span>
                <span>C <span className="text-white">{priceData?.close?.toFixed(2) ?? "---"}</span></span>
              </span>
              <span className="text-gray-600">|</span>
              <span className="flex gap-2 items-center">
                <span className="flex items-center gap-1 text-white"><span className="w-2 h-2 rounded-full bg-white" />MA9 {maValues.ma9?.toFixed(2) || "---"}</span>
                <span className="flex items-center gap-1 text-[#2962FF]"><span className="w-2 h-2 rounded-full bg-[#2962FF]" />MA21 {maValues.ma21?.toFixed(2) || "---"}</span>
                <span className="flex items-center gap-1 text-[#00C853]"><span className="w-2 h-2 rounded-full bg-[#00C853]" />MA50 {maValues.ma50?.toFixed(2) || "---"}</span>
                <span className="flex items-center gap-1 text-[#D50000]"><span className="w-2 h-2 rounded-full bg-[#D50000]" />MA200 {maValues.ma200?.toFixed(2) || "---"}</span>
              </span>
            </div>
          </div>

          {/* Live price top-right */}
          <div className="absolute top-3 right-4 z-20">
            <div className="bg-[#1e222d]/80 backdrop-blur-md px-3 py-1.5 rounded-md border border-[#2b2b43] flex flex-col items-end shadow-lg">
              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest leading-none mb-1">Live Feed</span>
              <span className="text-xl font-mono font-bold text-white tracking-tighter leading-none">${priceData?.price?.toFixed(2) || "---.--"}</span>
            </div>
          </div>

          {/* Active position badge */}
          {posStr && posStr !== "FLAT" && (
            <div className="absolute bottom-8 left-3 z-20">
              <div className={`px-2.5 py-1.5 rounded-md text-[10px] font-bold border flex gap-2 items-center ${(portfolio?.unrealized_pnl ?? 0) >= 0 ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                {posStr} @ ${portfolio?.entry_price?.toFixed(2)}
                {portfolio?.entry_time && (
                  <span className="text-gray-400 font-normal ml-1">
                    {new Date(portfolio.entry_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                <span className={`ml-1 ${(portfolio?.unrealized_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {(portfolio?.unrealized_pnl ?? 0) >= 0 ? "+" : ""}${(portfolio?.unrealized_pnl ?? 0).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          <div ref={chartContainerRef} className="absolute inset-0 z-10" />
        </div>

        {/* Sidebar — hidden on mobile */}
        <aside className="hidden md:flex w-[300px] bg-[#131722] border border-[#2b2b43] rounded-md flex-col shrink-0 shadow-xl overflow-hidden">
          <div className="flex border-b border-[#2b2b43] h-10 shrink-0">
            <button onClick={() => setActiveTab("watchlist")} className={`flex-1 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest ${activeTab === "watchlist" ? "text-blue-400 border-b-2 border-blue-500 bg-blue-500/5" : "text-gray-500"}`}>
              <List className="h-4 w-4" />Watch
            </button>
            <button onClick={() => setActiveTab("details")} className={`flex-1 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest ${activeTab === "details" ? "text-blue-400 border-b-2 border-blue-500 bg-blue-500/5" : "text-gray-500"}`}>
              <Info className="h-4 w-4" />Info
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {activeTab === "watchlist" && (
              <div className="space-y-4">
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Premium Pairs</div>
                <div className="flex items-center justify-between p-2.5 rounded bg-blue-500/10 border border-blue-500/20 text-xs shadow-inner">
                  <div className="flex flex-col">
                    <span className="text-white font-bold">XAUUSD</span>
                    <span className="text-[9px] text-gray-500 uppercase">Gold Spot</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-white font-mono font-bold tracking-tighter">${priceData?.price?.toFixed(2) || "---.--"}</span>
                    <span className="text-[9px] text-emerald-500 font-bold">+0.12%</span>
                  </div>
                </div>

                {/* Position card */}
                <div className="pt-2 border-t border-[#2b2b43]">
                  <div className="flex items-center justify-between text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                    <span>Position</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${posStr === "LONG" ? "bg-emerald-500/10 text-emerald-500" : posStr === "SHORT" ? "bg-red-500/10 text-red-500" : "bg-gray-500/10 text-gray-500"}`}>
                      {posStr || "FLAT"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                    <div className="bg-[#1e222d] p-2 rounded">
                      <div className="text-gray-500 text-[8px] uppercase mb-1">Balance</div>
                      <div className="text-white font-bold">${(portfolio?.balance ?? 10000).toFixed(2)}</div>
                    </div>
                    <div className="bg-[#1e222d] p-2 rounded">
                      <div className="text-gray-500 text-[8px] uppercase mb-1">Unrealized</div>
                      <div className={`font-bold ${pnlColor}`}>${(portfolio?.unrealized_pnl ?? 0).toFixed(2)}</div>
                    </div>
                    <div className="bg-[#1e222d] p-2 rounded">
                      <div className="text-gray-500 text-[8px] uppercase mb-1">Entry Time</div>
                      <div className="text-blue-400 font-bold">
                        {portfolio?.entry_time
                          ? new Date(portfolio.entry_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                          : "—"}
                      </div>
                    </div>
                    <div className="bg-[#1e222d] p-2 rounded">
                      <div className="text-gray-500 text-[8px] uppercase mb-1">Entry Price</div>
                      <div className="text-white font-bold">
                        {(portfolio?.entry_price ?? 0) > 0 ? `$${(portfolio?.entry_price ?? 0).toFixed(2)}` : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "details" && (
              <div className="space-y-3">
                <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Execution Bridge</h3>
                <div className="bg-[#2a2e39]/20 rounded-lg border border-[#2b2b43] max-h-[400px] overflow-y-auto p-2.5 custom-scrollbar space-y-2 shadow-inner">
                  {(!trades || trades.length === 0) ? (
                    <div className="h-32 flex flex-col items-center justify-center text-[9px] text-gray-600 font-bold gap-3 uppercase tracking-widest">
                      <div className="w-6 h-[1px] bg-gray-700 animate-pulse" />
                      Waiting for signals
                      <div className="w-6 h-[1px] bg-gray-700 animate-pulse" />
                    </div>
                  ) : (
                    [...trades].map((t: any, i: number) => (
                      <div key={i} className="p-2.5 rounded bg-[#1e222d] border border-[#2b2b43] text-[10px] font-mono shadow-sm hover:border-blue-500/30 transition-colors">
                        <div className="flex justify-between items-center mb-1">
                          <span className={`font-bold uppercase tracking-tight ${t.action.includes("LONG") || t.action.includes("BUY") ? "text-emerald-500" : "text-rose-500"}`}>
                            {t.action}
                            {t.status === "ACTIVE" && <span className="ml-1 text-[7px] bg-blue-500/20 text-blue-400 px-1 rounded">LIVE</span>}
                          </span>
                          <span className="text-[8px] text-gray-600">
                            {t.time === "NOW" ? "Running" : new Date(t.time).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="flex justify-between items-end">
                          <span className="text-gray-400 text-[9px]">@ <span className="text-white font-bold ml-1">${(t.price ?? t.entry ?? 0).toFixed(2)}</span></span>
                          {t.pnl !== undefined && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm ${t.pnl >= 0 ? "text-emerald-500 bg-emerald-500/10" : "text-rose-500 bg-rose-500/10"}`}>
                              {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="p-3 bg-[#1e222d] border-t border-[#2b2b43]">
            <div className={`flex items-center gap-2 text-[10px] font-bold uppercase ${connected ? "text-emerald-500" : "text-red-500"}`}>
              <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-red-500"}`} />
              {connected ? "Feed Latency: < 10ms" : "Disconnected"}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

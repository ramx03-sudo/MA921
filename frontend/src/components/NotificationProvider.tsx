"use client";

import React, { createContext, useContext, useCallback, useState, useEffect, useRef } from "react";
import { CheckCircle, XCircle, AlertTriangle, Info, X, TrendingUp, TrendingDown, Bell } from "lucide-react";

export type ToastType = "success" | "error" | "warning" | "info" | "trade_buy" | "trade_sell" | "crossover";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface NotificationContextType {
  notify: (type: ToastType, title: string, message?: string, duration?: number) => void;
  toasts: Toast[];
}

const NotificationContext = createContext<NotificationContextType>({
  notify: () => {},
  toasts: [],
});

export const useNotify = () => useContext(NotificationContext);

const ICONS: Record<ToastType, React.ReactNode> = {
  success:   <CheckCircle className="w-4 h-4 text-emerald-400" />,
  error:     <XCircle className="w-4 h-4 text-red-400" />,
  warning:   <AlertTriangle className="w-4 h-4 text-amber-400" />,
  info:      <Info className="w-4 h-4 text-blue-400" />,
  trade_buy: <TrendingUp className="w-4 h-4 text-emerald-400" />,
  trade_sell:<TrendingDown className="w-4 h-4 text-red-400" />,
  crossover: <Bell className="w-4 h-4 text-purple-400" />,
};

const COLORS: Record<ToastType, string> = {
  success:   "border-emerald-500/30 bg-emerald-500/5",
  error:     "border-red-500/30 bg-red-500/5",
  warning:   "border-amber-500/30 bg-amber-500/5",
  info:      "border-blue-500/30 bg-blue-500/5",
  trade_buy: "border-emerald-500/40 bg-emerald-500/10",
  trade_sell:"border-red-500/40 bg-red-500/10",
  crossover: "border-purple-500/40 bg-purple-500/10",
};

const TITLE_COLORS: Record<ToastType, string> = {
  success:   "text-emerald-300",
  error:     "text-red-300",
  warning:   "text-amber-300",
  info:      "text-blue-300",
  trade_buy: "text-emerald-300",
  trade_sell:"text-red-300",
  crossover: "text-purple-300",
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setLeaving(true);
      setTimeout(() => onRemove(toast.id), 300);
    }, toast.duration ?? 4500);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  const handleClose = () => {
    setLeaving(true);
    setTimeout(() => onRemove(toast.id), 300);
  };

  return (
    <div
      className={`
        flex items-start gap-3 px-4 py-3 rounded-lg border shadow-2xl backdrop-blur-md
        transition-all duration-300 ease-out cursor-pointer w-[340px]
        ${COLORS[toast.type]}
        ${visible && !leaving ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"}
      `}
      onClick={handleClose}
    >
      <div className="mt-0.5 flex-shrink-0">{ICONS[toast.type]}</div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold leading-tight ${TITLE_COLORS[toast.type]}`}>{toast.title}</p>
        {toast.message && (
          <p className="text-xs text-gray-400 mt-0.5 leading-snug">{toast.message}</p>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); handleClose(); }}
        className="text-gray-600 hover:text-gray-400 flex-shrink-0 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((type: ToastType, title: string, message?: string, duration = 4500) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev.slice(-4), { id, type, title, message, duration }]);
  }, []);

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <NotificationContext.Provider value={{ notify, toasts }}>
      {children}
      {/* Toast container — fixed top-right */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onRemove={remove} />
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

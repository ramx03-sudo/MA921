import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, LineChart, History, Settings, FlaskConical } from "lucide-react";

const navItems = [
  { name: "Live",      href: "/",          icon: LayoutDashboard },
  { name: "Analytics", href: "/analytics",  icon: LineChart },
  { name: "Trades",    href: "/trades",     icon: History },
  { name: "Backtest",  href: "/backtest",   icon: FlaskConical },
  { name: "Settings",  href: "/settings",   icon: Settings },
];

export default function MobileNav() {
  const location = useLocation();

  return (
    <nav className="flex border-t border-[#1e2433] bg-[#0d1117] safe-area-pb">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = location.pathname === item.href;
        return (
          <Link
            key={item.name}
            to={item.href}
            className={`relative flex-1 flex flex-col items-center gap-1 py-2.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
              isActive ? "text-blue-400" : "text-gray-600 hover:text-gray-400"
            }`}
          >
            <Icon className={`w-5 h-5 transition-all ${isActive ? "scale-110" : "scale-100"}`} />
            {item.name}
            {isActive && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-blue-500 rounded-t-full" />}
          </Link>
        );
      })}
    </nav>
  );
}

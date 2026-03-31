import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { WebSocketProvider } from "@/components/WebSocketProvider";
import { NotificationProvider } from "@/components/NotificationProvider";
import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";

import Dashboard from "@/pages/Dashboard";
import Analytics from "@/pages/Analytics";
import Trades from "@/pages/Trades";
import Settings from "@/pages/Settings";
import Backtest from "@/pages/Backtest";

function App() {
  return (
    <Router>
      <NotificationProvider>
        <WebSocketProvider>
          <div className="flex h-screen w-full bg-[#0b0e14] text-[#e2e8f0] overflow-hidden">
            {/* Desktop sidebar — hidden on mobile */}
            <div className="hidden md:flex">
              <Sidebar />
            </div>

            {/* Main content */}
            <main className="flex-1 overflow-hidden flex flex-col min-w-0">
              {/* Page content */}
              <div className="flex-1 overflow-hidden p-2 md:p-3 min-h-0">
                <div className="flex-1 w-full h-full min-h-0 min-w-0">
                  <Routes>
                    <Route path="/"           element={<Dashboard />} />
                    <Route path="/analytics"  element={<Analytics />} />
                    <Route path="/trades"     element={<Trades />} />
                    <Route path="/backtest"   element={<Backtest />} />
                    <Route path="/settings"   element={<Settings />} />
                  </Routes>
                </div>
              </div>

              {/* Mobile bottom nav — visible only on small screens */}
              <div className="md:hidden">
                <MobileNav />
              </div>
            </main>
          </div>
        </WebSocketProvider>
      </NotificationProvider>
    </Router>
  );
}

export default App;

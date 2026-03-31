import asyncio
import time
import ssl
import certifi
import aiohttp
import json
from typing import Callable

API_KEY = "d73p9fpr01qjjol3rhp0d73p9fpr01qjjol3rhpg"
SYMBOL  = "OANDA:XAU_USD"
WS_URL  = f"wss://ws.finnhub.io?token={API_KEY}"
REST_URL = f"https://finnhub.io/api/v1/quote?symbol={SYMBOL}&token={API_KEY}"


class DataFeed:
    def __init__(self, callback: Callable):
        self.callback = callback
        self.running = False
        self.current_price = 3000.0
        self.spread = 0.30
        self.last_tick_time = 0.0

    async def start(self):
        self.running = True
        print("[FEED] 🚀 Starting Finnhub Real-time Feed (WS + REST Accelerator)...")
        asyncio.create_task(self._run_ws())
        asyncio.create_task(self._run_accelerator())

    def stop(self):
        self.running = False

    async def _run_ws(self):
        """
        Connect to Finnhub WebSocket and subscribe to OANDA:XAU_USD.
        Finnhub delivers real OANDA trade data — proper OHLC candles.
        """
        ssl_ctx = ssl.create_default_context(cafile=certifi.where())

        while self.running:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.ws_connect(WS_URL, ssl=ssl_ctx) as ws:
                        print("[FEED] ✅ Finnhub WebSocket connected! Subscribing to XAU/USD...")

                        await ws.send_json({"type": "subscribe", "symbol": SYMBOL})

                        async for msg in ws:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                data = json.loads(msg.data)

                                if data.get("type") == "trade":
                                    trades = data.get("data", [])
                                    for trade in trades:
                                        price = float(trade["p"])
                                        # ⚠️ Finnhub trade timestamps are in MILLISECONDS
                                        ts  = int(trade["t"] / 1000)
                                        bid = round(price - self.spread / 2, 4)
                                        ask = round(price + self.spread / 2, 4)
                                        self.current_price = price
                                        self.last_tick_time = time.time()
                                        await self.callback(bid, ask, ts)

                                elif data.get("type") == "ping":
                                    # Keep alive
                                    await ws.send_json({"type": "ping"})

                            elif msg.type == aiohttp.WSMsgType.CLOSED:
                                print("[FEED] WebSocket closed — reconnecting...")
                                break
                            elif msg.type == aiohttp.WSMsgType.ERROR:
                                print("[FEED] WebSocket error — reconnecting...")
                                break

            except Exception as e:
                print(f"[FEED] WebSocket error: {e}. Falling back to REST for 30s...")
                await asyncio.sleep(30)

            if self.running:
                print("[FEED] Reconnecting WebSocket in 5s...")
                await asyncio.sleep(5)

    async def _run_accelerator(self):
        """
        Poll Finnhub REST /quote every 3s if WS hasn't ticked recently.
        Guarantees chart updates even during low-liquidity periods.
        Finnhub /quote returns: {"c": current, "h": high, "l": low, "o": open, "t": unix_ts}
        """
        async with aiohttp.ClientSession() as session:
            while self.running:
                if time.time() - self.last_tick_time > 3.0:
                    try:
                        async with session.get(REST_URL, timeout=aiohttp.ClientTimeout(total=3)) as resp:
                            if resp.status == 200:
                                data = await resp.json()
                                price = float(data.get("c", 0))
                                ts    = int(data.get("t", time.time()))
                                if price > 0:
                                    bid = round(price - self.spread / 2, 4)
                                    ask = round(price + self.spread / 2, 4)
                                    self.current_price = price
                                    self.last_tick_time = time.time()
                                    await self.callback(bid, ask, ts)
                    except Exception:
                        pass

                await asyncio.sleep(3)

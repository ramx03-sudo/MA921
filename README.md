# MA921 Trading Engine

A full-stack web application simulating real-time trading of Gold (XAUUSD) using a Moving Average Crossover strategy.

## Core Features
1. **Real-time Engine**: Fast stream of live realistic price data over WebSockets using async Python.
2. **Strategy**: Implementation of custom MA9/MA21/MA50/MA200 crossover logic with state tracking, dynamic sizing and trailing stop losses.
3. **Realistic Execution**: Dynamically injected market slippage, bidirectional spread application depending on direction, and exact configurable latencies.
4. **App Interface**: Fast Dashboard, robust historical log table, and analytics visualizer. Fintech dark mode powered by Next.js and Tailwind CSS 4.

## Setup Requirements
Ensure you have Python 3 + Node.js installed.

### 1. Start the Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate
# See requirements in the backend folder or install specific deps:
pip install fastapi uvicorn pandas numpy websockets redis asyncpg sqlalchemy pydantic-settings "sqlalchemy[asyncio]" aiosqlite python-dotenv aiohttp
uvicorn main:app --reload --port 8000
```

### 2. Start the Frontend
```bash
cd frontend
npm install # if not already installed
npm run dev
```

### Usage
- Open **http://localhost:3000**
- Use the sidebar to go to Settings or Start the Engine.
- The Engine comes with a continuous random-walk tick generator that behaves exactly like XAUUSD on real tick feeds. Over time, it computes the live MA combinations and executes orders seamlessly.

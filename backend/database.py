import sqlite3
import json
import datetime
from typing import Dict, List, Optional

DB_FILE = "aquaflow.db"

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Global System State
    c.execute('''
        CREATE TABLE IF NOT EXISTS portfolio_state (
            id INTEGER PRIMARY KEY,
            balance REAL,
            state TEXT DEFAULT 'FLAT', 
            position TEXT,
            entry_price REAL,
            position_size REAL,
            stop_loss REAL,
            take_profit REAL,
            last_ts BIGINT DEFAULT 0
        )
    ''')
    
    # Idempotent Order Storage (Signal Deduplication)
    c.execute('''
        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            action TEXT NOT NULL,
            price REAL NOT NULL,
            ts BIGINT NOT NULL,
            status TEXT DEFAULT 'PENDING',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Trade History (Completed trades for analytics)
    c.execute('''
        CREATE TABLE IF NOT EXISTS trade_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time TEXT,
            action TEXT,
            reason TEXT,
            entry REAL,
            exit REAL,
            pnl REAL,
            size REAL,
            balance REAL
        )
    ''')
    
    # Raw Webhook Logs (Execution Audit Trail)
    c.execute('''
        CREATE TABLE IF NOT EXISTS webhook_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time TEXT,
            action TEXT,
            ticker TEXT,
            price REAL,
            status TEXT
        )
    ''')
    
    c.execute('SELECT COUNT(*) FROM portfolio_state')
    if c.fetchone()[0] == 0:
        c.execute('INSERT INTO portfolio_state (id, balance, state, position, entry_price, position_size, stop_loss, take_profit, last_ts) VALUES (1, 10000.0, "FLAT", NULL, 0, 0, 0, 0, 0)')
        
    conn.commit()
    conn.close()

def load_portfolio_state():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM portfolio_state WHERE id = 1')
    row = c.fetchone()
    conn.close()
    return dict(row)

def save_portfolio_state(balance, state, position, entry_price, position_size, stop_loss, take_profit, last_ts=0):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        UPDATE portfolio_state 
        SET balance=?, state=?, position=?, entry_price=?, position_size=?, stop_loss=?, take_profit=?, last_ts=? 
        WHERE id=1
    ''', (balance, state, position, entry_price, position_size, stop_loss, take_profit, last_ts))
    conn.commit()
    conn.close()

def log_order(order_id, action, price, ts):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    try:
        c.execute('''
            INSERT INTO orders (id, action, price, ts, status)
            VALUES (?, ?, ?, ?, 'DONE')
        ''', (order_id, action, price, ts))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False # Already exists
    finally:
        conn.close()

def is_order_processed(order_id):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT id FROM orders WHERE id=?', (order_id,))
    exists = c.fetchone() is not None
    conn.close()
    return exists

def log_trade(trade: dict):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        INSERT INTO trade_history (time, action, reason, entry, exit, pnl, size, balance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        trade.get("time"), trade.get("action"), trade.get("reason"),
        trade.get("entry", 0), trade.get("exit", 0), trade.get("pnl", 0),
        trade.get("size", 0), trade.get("balance", 0)
    ))
    conn.commit()
    conn.close()

def load_trade_history() -> List[Dict]:
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM trade_history ORDER BY id ASC')
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def log_webhook(action: str, ticker: str, price: float, status: str):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        INSERT INTO webhook_logs (time, action, ticker, price, status)
        VALUES (?, ?, ?, ?, ?)
    ''', (datetime.datetime.now().isoformat(), action, ticker, price, status))
    conn.commit()
    conn.close()

# Initialize DB on import
init_db()

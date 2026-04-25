"""
POLYMARKET BOT — FINAL
Categories: BTC 5m ONLY + Soccer/Sports ONLY
BTC5m: 7-indicator weighted TA (window delta dominant)
      Entry T-10s poll loop → fire at best signal → T-5s hard deadline
      Spike detection: score jump ≥1.5 → fire immediately
Soccer: Gamma API scanner, same-day matches
Compound: floor(equity/10) = max_bet, min $1
Gas: auto-stop when < 2 orders worth remaining (50% reserve)
Real: [RUN/STOP] button via API
Persist: SQLite + per-bot state.json
Circuit breakers: balance floor, daily loss limit (persistent), per-trade stop-loss 30%
Balance: auto-fetch USDC via CLOB API + POL via Polygon RPC, refresh every 5 min
"""
import asyncio, json, os, random, time, sqlite3, threading, math
from datetime import datetime, timezone, date, timedelta
from pathlib import Path
from typing import Optional
import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# Optional web3 / eth-account — graceful fallback if not installed
try:
    from eth_account import Account as _EthAccount
    WEB3_OK = True
except ImportError:
    _EthAccount = None
    WEB3_OK = False

_lock    = asyncio.Lock()
_db_lock = threading.Lock()

BOT_ID     = os.getenv("BOT_ID", "bot1")
MODE       = os.getenv("BOT_MODE", "sim")          # sim | real
DATA_DIR   = Path("/app/data")
STATE_FILE = DATA_DIR / f"state_{BOT_ID}.json"
DB_PATH    = DATA_DIR / "trades.db"
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title=f"PolyBot {BOT_ID}")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── CONFIG ──────────────────────────────────────────────────
class C:
    usdc_capital        = float(os.getenv("USDC_CAPITAL", "10"))
    pol_balance         = float(os.getenv("POL_BALANCE", "11"))
    min_bet             = 1.00
    max_open_pos        = int(os.getenv("MAX_OPEN_POS", "5"))
    min_ev              = float(os.getenv("MIN_EV", "0.03"))
    daily_loss_limit    = float(os.getenv("DAILY_LOSS_LIMIT", "5.0"))
    scan_sec            = int(os.getenv("SCAN_INTERVAL", "10"))
    # Gas
    gas_per_tx_usd      = 0.02
    pol_price_usd       = 0.40
    gas_reserve_pct     = 0.50     # 50% POL reserved
    gas_stop_orders     = 2        # auto-stop when < 2 orders left
    gas_alert_orders    = 5        # alert when < 5 orders left
    # Salary
    salary_threshold    = 100.0
    salary_keep_pct     = 0.30
    salary_withdraw_pct = 0.70
    # Real credentials
    poly_private_key    = os.getenv("POLY_PRIVATE_KEY", "")
    poly_api_key        = os.getenv("POLY_API_KEY", "")
    poly_secret         = os.getenv("POLY_SECRET", "")
    poly_passphrase     = os.getenv("POLY_PASSPHRASE", "")
    # Circuit breakers
    balance_floor       = float(os.getenv("BALANCE_FLOOR", "20"))
    balance_refresh_sec = int(os.getenv("BALANCE_REFRESH_SEC", "300"))
    polygon_rpc         = os.getenv("POLYGON_RPC", "https://polygon-rpc.com")

GAMMA    = "https://gamma-api.polymarket.com"
BINANCE  = "https://api.binance.com/api/v3"
CLOB     = "https://clob.polymarket.com"
BTC5M_WIN = 300

# ─── COMPOUND: floor(equity/10), min $1, max $50 ─────────────
def compound_bet(equity: float) -> float:
    tier = math.floor(equity / 10)
    return round(min(max(tier, 1), 50), 2)

def compound_next_at(equity: float) -> float:
    tier = math.floor(equity / 10)
    return round((tier + 1) * 10, 2)

def compound_progress(equity: float) -> float:
    tier = math.floor(equity / 10)
    base = tier * 10
    return round(min(100, (equity - base) / 10 * 100), 1)

# ─── STATE ───────────────────────────────────────────────────
class BotState:
    def __init__(self):
        self.capital              = C.usdc_capital
        self.locked               = 0.0
        self.initial              = C.usdc_capital
        self.positions            = []
        self.closed_trades        = []
        self.log                  = []
        self.scan_count           = 0
        self.signals_found        = 0
        self.daily_pnl            = 0.0
        self.daily_date           = date.today().isoformat()
        self.gas_used_usd         = 0.0
        self.pol_left             = C.pol_balance
        self.pos_counter          = 0
        self.running              = MODE == "sim"   # sim always runs, real needs manual start
        self.gas_paused           = False
        self.ws_clients           = set()
        self.errors               = []
        self.start_time           = datetime.now(timezone.utc).isoformat()
        self.compound_events      = []
        self.salary_events        = []
        self.total_withdrawn      = 0.0
        self.salary_target        = C.salary_threshold
        self.lifetime_pnl         = 0.0
        self.last_balance_refresh = ""
        # BTC5m state
        self.btc5m = {
            "slug": "", "win_ts": 0, "secs_left": 300,
            "btc_price": 0.0, "win_open": 0.0,
            "predicted_dir": "", "confidence": 0.0,
            "entry_fired": False, "in_entry_zone": False,
            "score": 0.0, "indicators": {},
            "ticks": [], "last_tick": 0.0,
            "market_data": {}, "klines": [],
            "last_kline_fetch": 0, "last_market_fetch": 0,
            "stats": {"wins": 0, "losses": 0, "total": 0},
            # Sprint 1 additions
            "prev_score": 0.0,
            "highest_confidence_seen": 0.0,
        }
        # Soccer scanner
        self.soccer_markets  = []
        # Market rows for scanner (all)
        self.market_rows     = []

S = BotState()

# ─── SQLITE ──────────────────────────────────────────────────
def db_init():
    with _db_lock:
        con = sqlite3.connect(DB_PATH)
        con.executescript("""
        CREATE TABLE IF NOT EXISTS trades (
            id TEXT, bot_id TEXT, market_id TEXT, question TEXT,
            category TEXT, strategy TEXT, outcome TEXT,
            price REAL, size REAL, ev REAL, true_prob REAL,
            status TEXT, pnl REAL, opened_at TEXT, closed_at TEXT,
            resolve_sec INTEGER
        );
        CREATE TABLE IF NOT EXISTS sessions (
            bot_id TEXT, mode TEXT, started_at TEXT, capital REAL, pol REAL
        );
        CREATE TABLE IF NOT EXISTS log_events (
            ts TEXT, bot_id TEXT, event TEXT, data TEXT
        );
        CREATE TABLE IF NOT EXISTS daily_loss (
            date TEXT,
            bot_id TEXT,
            pnl REAL,
            PRIMARY KEY (date, bot_id)
        );
        """)
        con.commit(); con.close()

def db_save_trade(pos: dict):
    try:
        with _db_lock:
            con = sqlite3.connect(DB_PATH)
            con.execute("INSERT OR REPLACE INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                pos.get("id"), BOT_ID, pos.get("market_id"), pos.get("question", "")[:120],
                pos.get("category"), pos.get("strategy"), pos.get("outcome"),
                pos.get("price"), pos.get("size"), pos.get("ev"), pos.get("true_prob"),
                pos.get("status"), pos.get("pnl"),
                pos.get("opened_at"), pos.get("closed_at"), pos.get("resolve_sec"),
            ))
            con.commit(); con.close()
    except: pass

def db_summary():
    try:
        with _db_lock:
            con = sqlite3.connect(DB_PATH); con.row_factory = sqlite3.Row
            rows = con.execute("""
                SELECT bot_id,
                  COUNT(*) total, SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) wins,
                  ROUND(SUM(pnl),4) total_pnl, ROUND(AVG(pnl),4) avg_pnl,
                  MAX(closed_at) last_trade
                FROM trades WHERE status IN ('won','lost') GROUP BY bot_id
            """).fetchall()
            con.close()
            return [dict(r) for r in rows]
    except: return []

def db_trades(bot_id="", limit=100):
    try:
        with _db_lock:
            con = sqlite3.connect(DB_PATH); con.row_factory = sqlite3.Row
            q = "SELECT * FROM trades"
            args = []
            if bot_id: q += " WHERE bot_id=?"; args.append(bot_id)
            q += f" ORDER BY opened_at DESC LIMIT {limit}"
            rows = [dict(r) for r in con.execute(q, args).fetchall()]
            con.close(); return rows
    except: return []

def db_save_daily_loss():
    """Persist daily P&L to SQLite — survives restart."""
    try:
        with _db_lock:
            con = sqlite3.connect(DB_PATH)
            con.execute(
                "INSERT OR REPLACE INTO daily_loss VALUES (?,?,?)",
                (S.daily_date, BOT_ID, S.daily_pnl)
            )
            con.commit(); con.close()
    except: pass

def db_load_daily_loss():
    """Load today's cumulative daily P&L from SQLite on startup."""
    try:
        today = date.today().isoformat()
        with _db_lock:
            con = sqlite3.connect(DB_PATH)
            row = con.execute(
                "SELECT pnl FROM daily_loss WHERE date=? AND bot_id=?",
                (today, BOT_ID)
            ).fetchone()
            con.close()
        if row:
            S.daily_pnl  = float(row[0])
            S.daily_date = today
            add_log("DAILY_LOAD", {"pnl": round(S.daily_pnl, 4), "date": today,
                                   "message": f"Daily P&L resumed: ${S.daily_pnl:.4f}"})
    except: pass

# ─── PERSIST STATE ───────────────────────────────────────────
def save_state():
    try:
        data = {
            "capital": S.capital, "locked": S.locked, "initial": S.initial,
            "total_withdrawn": S.total_withdrawn, "salary_target": S.salary_target,
            "salary_events": S.salary_events, "compound_events": S.compound_events,
            "lifetime_pnl": S.lifetime_pnl, "pos_counter": S.pos_counter,
            "closed_trades": S.closed_trades[-300:],
            "pol_left": S.pol_left, "gas_used_usd": S.gas_used_usd,
            "btc5m_stats": S.btc5m["stats"],
        }
        STATE_FILE.write_text(json.dumps(data, default=str))
    except: pass

def load_state():
    if not STATE_FILE.exists(): return False
    try:
        d = json.loads(STATE_FILE.read_text())
        S.capital         = float(d.get("capital", C.usdc_capital))
        S.locked          = 0.0
        S.initial         = float(d.get("initial", C.usdc_capital))
        S.total_withdrawn = float(d.get("total_withdrawn", 0))
        S.salary_target   = float(d.get("salary_target", C.salary_threshold))
        S.salary_events   = d.get("salary_events", [])
        S.compound_events = d.get("compound_events", [])
        S.lifetime_pnl    = float(d.get("lifetime_pnl", 0))
        S.pos_counter     = int(d.get("pos_counter", 0))
        S.closed_trades   = d.get("closed_trades", [])
        S.pol_left        = float(d.get("pol_left", C.pol_balance))
        S.gas_used_usd    = float(d.get("gas_used_usd", 0))
        S.btc5m["stats"]  = d.get("btc5m_stats", {"wins": 0, "losses": 0, "total": 0})
        add_log("RESUMED", {"capital": round(S.capital, 4), "message": f"Resumed ${S.capital:.2f} dari sesi sebelumnya"})
        return True
    except: return False

# ─── HELPERS ─────────────────────────────────────────────────
def now_str(): return datetime.now().strftime("%H:%M:%S")
def equity(): return round(S.capital + S.locked, 4)

def add_log(event: str, data: dict):
    e = {"time": now_str(), "event": event, **data}
    S.log.insert(0, e)
    if len(S.log) > 500: S.log.pop()
    return e

async def broadcast(msg: dict):
    dead = set()
    txt  = json.dumps(msg, default=str)
    for ws in S.ws_clients:
        try: await ws.send_text(txt)
        except: dead.add(ws)
    S.ws_clients -= dead

def daily_reset():
    today = date.today().isoformat()
    if S.daily_date != today:
        S.daily_date = today; S.daily_pnl = 0.0
        save_state()

# ─── GAS ENGINE ──────────────────────────────────────────────
def gas_usable_pol() -> float:
    return max(0, S.pol_left * (1 - C.gas_reserve_pct))

def gas_cost_per_order_pol() -> float:
    return C.gas_per_tx_usd / C.pol_price_usd

def gas_orders_left() -> int:
    cost = gas_cost_per_order_pol()
    return int(gas_usable_pol() / cost) if cost > 0 else 9999

def gas_status() -> str:
    n = gas_orders_left()
    if n <= C.gas_stop_orders:  return "critical"
    if n <= C.gas_alert_orders: return "low"
    return "ok"

def consume_gas():
    cost = gas_cost_per_order_pol()
    S.pol_left     = round(max(0, S.pol_left - cost), 4)
    S.gas_used_usd = round(S.gas_used_usd + C.gas_per_tx_usd, 4)
    n  = gas_orders_left()
    st = gas_status()
    if st == "critical" and not S.gas_paused:
        S.gas_paused = True
        e = add_log("GAS_STOP", {"orders_left": n, "pol_left": round(S.pol_left, 3),
            "message": f"Auto-stop: hanya {n} order tersisa (< {C.gas_stop_orders})"})
        asyncio.create_task(broadcast({"type": "gas_stop", "data": e}))
    elif st == "low":
        add_log("GAS_WARN", {"orders_left": n, "pol_left": round(S.pol_left, 3),
            "message": f"Gas menipis: {n} order tersisa"})

def get_gas_info():
    n = gas_orders_left()
    pol_used = round(C.pol_balance - S.pol_left, 4)
    pct = round(pol_used / C.pol_balance * 100, 1) if C.pol_balance else 0
    return {
        "pol_total":    C.pol_balance,
        "pol_left":     round(S.pol_left, 4),
        "pol_used":     pol_used,
        "pol_usable":   round(gas_usable_pol(), 4),
        "pol_reserved": round(S.pol_left * C.gas_reserve_pct, 4),
        "gas_usd":      round(S.gas_used_usd, 4),
        "orders_left":  n,
        "pct_used":     pct,
        "status":       gas_status(),
        "paused":       S.gas_paused,
        "stop_at":      C.gas_stop_orders,
        "alert_at":     C.gas_alert_orders,
    }

# ─── BALANCE FETCH (Sprint 1) ─────────────────────────────────
async def fetch_balance_usdc(sess: aiohttp.ClientSession) -> float:
    """Fetch live USDC balance from Polymarket CLOB API (real mode only)."""
    if not C.poly_api_key: return 0.0
    try:
        headers = {"POLY-API-KEY": C.poly_api_key}
        async with sess.get(
            f"{CLOB}/balance-allowance",
            params={"asset_type": "USDC"},
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=10)
        ) as r:
            if r.status == 200:
                data = await r.json()
                # USDC on Polygon is 6 decimals; CLOB may return raw or human-readable
                raw = float(data.get("balance", 0) or 0)
                # If value > 1000 it's likely in micro-USDC units
                if raw > 1000:
                    return round(raw / 1e6, 4)
                return round(raw, 4)
    except: pass
    return 0.0

async def fetch_balance_pol(sess: aiohttp.ClientSession) -> float:
    """Fetch live POL (MATIC) balance from Polygon public JSON-RPC."""
    if not WEB3_OK or not C.poly_private_key:
        return S.pol_left  # fallback to state
    try:
        acct    = _EthAccount.from_key(C.poly_private_key)
        address = acct.address
        payload = {
            "jsonrpc": "2.0", "method": "eth_getBalance",
            "params": [address, "latest"], "id": 1
        }
        async with sess.post(
            C.polygon_rpc, json=payload,
            timeout=aiohttp.ClientTimeout(total=10)
        ) as r:
            if r.status == 200:
                data = await r.json()
                wei = int(data.get("result", "0x0"), 16)
                return round(wei / 1e18, 6)
    except: pass
    return S.pol_left  # fallback to current state

async def balance_refresh_loop():
    """Refresh USDC + POL balance every 5 minutes. Broadcasts balance_update via WebSocket."""
    await asyncio.sleep(15)  # let startup complete first
    async with aiohttp.ClientSession() as sess:
        while True:
            try:
                pol = await fetch_balance_pol(sess)
                S.pol_left = pol

                if MODE == "real":
                    usdc = await fetch_balance_usdc(sess)
                    if usdc > 0:
                        S.capital = usdc

                S.last_balance_refresh = datetime.now(timezone.utc).isoformat()
                add_log("BALANCE_REFRESH", {
                    "usdc": round(S.capital, 4),
                    "pol":  round(pol, 4),
                    "mode": MODE,
                    "message": f"Balance refreshed — USDC ${S.capital:.2f} POL {pol:.4f}"
                })
                await broadcast({"type": "balance_update", "data": {
                    "usdc": round(S.capital, 4),
                    "pol":  round(S.pol_left, 4),
                    "ts":   S.last_balance_refresh,
                }})
            except Exception as e:
                S.errors.append(f"[balance_refresh] {str(e)[:60]}")
            await asyncio.sleep(C.balance_refresh_sec)

# ─── STOP-LOSS MONITOR (Sprint 1) ────────────────────────────
async def stoploss_monitor_loop():
    """Check per-trade 30% stop-loss every 30 seconds."""
    while True:
        try:
            for pos in list(S.positions):
                if pos["status"] != "open": continue
                entry_price = pos.get("price", 0)
                if entry_price <= 0: continue

                opened  = datetime.fromisoformat(pos["opened_at"])
                elapsed = (datetime.now(timezone.utc) - opened).total_seconds()
                if elapsed < 60: continue  # grace period — no stop in first 60s

                if MODE == "sim":
                    # Simulate: very low probability (0.5% per check) that market moves 30%+ against us
                    if random.random() < 0.005:
                        simulated_drop = 0.30 + random.random() * 0.10
                        current_price  = round(entry_price * (1 - simulated_drop), 4)
                        pnl_pct        = round(-simulated_drop * 100, 1)
                        entry = add_log("STOP_LOSS", {
                            "id":            pos["id"],
                            "entry_price":   round(entry_price, 4),
                            "current_price": current_price,
                            "pnl_pct":       pnl_pct,
                            "message":       f"Stop-loss triggered: {pnl_pct}% drop from entry",
                        })
                        await broadcast({"type": "stop_loss", "data": entry})
                        await close_position(pos, False)
                # Real mode: TODO — fetch actual implied price from CLOB orderbook
                # and compare to entry_price * 0.70 threshold
        except Exception as e:
            S.errors.append(f"[stoploss] {str(e)[:40]}")
        await asyncio.sleep(30)

# ─── ORDER RETRY: FOK → GTL fallback ─────────────────────────
async def place_order_with_retry(
    market_id: str, outcome: str, price: float, size: float, sess
) -> dict:
    """
    Place order with fallback chain:
    1. FOK (Fill-or-Kill) market order
    2. If FOK fails → GTL (Good-Till-Limit) limit order @ $0.95
    3. If GTL fails → MISSED_TRADE
    """
    if MODE == "sim":
        # Simulation: 90% FOK success, 9% GTL fallback, 1% missed
        r = random.random()
        if r < 0.90:
            return {"ok": True, "type": "FOK", "order_id": f"sim-fok-{int(time.time())}"}
        elif r < 0.99:
            add_log("ORDER_GTL_FALLBACK", {
                "market_id": market_id, "outcome": outcome,
                "message": "FOK failed — retrying with GTL @ $0.95"
            })
            return {"ok": True, "type": "GTL", "order_id": f"sim-gtl-{int(time.time())}"}
        else:
            add_log("MISSED_TRADE", {
                "market_id": market_id, "outcome": outcome,
                "message": "Both FOK and GTL failed — trade missed"
            })
            return {"ok": False, "type": "MISSED", "order_id": ""}
    # Real mode — placeholder until py-clob-client integration (Dex/Axel TODO)
    add_log("MISSED_TRADE", {
        "market_id": market_id, "outcome": outcome,
        "reason": "CLOB client integration pending",
        "message": "Real order execution not yet implemented"
    })
    return {"ok": False, "type": "MISSED", "order_id": ""}

# ─── COMPOUND / SALARY ────────────────────────────────────────
def check_compound_levelup():
    eq = equity()
    old_bet = compound_bet(eq - 0.01)
    new_bet = compound_bet(eq)
    if new_bet > old_bet:
        ev = {"time": now_str(), "equity": round(eq, 4), "new_bet": new_bet, "old_bet": old_bet}
        S.compound_events.append(ev)
        add_log("COMPOUND_UP", {"new_bet": new_bet, "old_bet": old_bet, "equity": round(eq, 4)})
        return True
    return False

def check_salary():
    eq = equity()
    if eq < S.salary_target: return False
    withdrawn = round(eq * C.salary_withdraw_pct, 4)
    keep      = round(eq * C.salary_keep_pct, 4)
    ev = {"time": now_str(), "equity": round(eq, 4), "withdrawn": withdrawn, "kept": keep,
          "next_target": S.salary_target + C.salary_threshold}
    S.salary_events.append(ev)
    S.total_withdrawn = round(S.total_withdrawn + withdrawn, 4)
    S.capital = keep; S.locked = 0.0
    S.salary_target += C.salary_threshold
    add_log("SALARY", {"equity": round(eq, 4), "withdrawn": withdrawn, "kept": keep,
                       "next_target": S.salary_target})
    save_state()
    return True

# ─── BTC 5M SIGNAL ENGINE (7 indicators, weighted) ───────────
def btc5m_window_ts(now_ts=0) -> int:
    ts = now_ts or int(datetime.now(timezone.utc).timestamp())
    return ts - (ts % BTC5M_WIN)

def btc5m_slug(ts: int) -> str:
    return f"btc-updown-5m-{ts}"

def btc5m_secs_left(now_ts=0) -> int:
    ts  = now_ts or int(datetime.now(timezone.utc).timestamp())
    end = btc5m_window_ts(ts) + BTC5M_WIN
    return max(0, end - ts)

async def btc5m_fetch_klines(sess, limit=30) -> list:
    try:
        async with sess.get(f"{BINANCE}/klines", params={
            "symbol": "BTCUSDT", "interval": "1m", "limit": limit
        }) as r:
            if r.status == 200:
                data = await r.json()
                return [{"ts": int(k[0])//1000, "open": float(k[1]), "high": float(k[2]),
                         "low": float(k[3]), "close": float(k[4]), "volume": float(k[5])} for k in data]
    except: pass
    return []

async def btc5m_fetch_price(sess) -> float:
    try:
        async with sess.get(f"{BINANCE}/ticker/price", params={"symbol": "BTCUSDT"}) as r:
            if r.status == 200:
                return float((await r.json()).get("price", 0))
    except: pass
    return 0.0

async def btc5m_fetch_market(slug: str, sess) -> Optional[dict]:
    try:
        async with sess.get(f"{GAMMA}/events", params={"slug": slug, "limit": 1}) as r:
            if r.status == 200:
                data = await r.json()
                evs = data if isinstance(data, list) else []
                if evs:
                    for m in evs[0].get("markets", []):
                        outs = m.get("outcomes", "[]")
                        if isinstance(outs, str):
                            try: outs = json.loads(outs)
                            except: outs = []
                        if any(str(o).lower() in ("up", "down") for o in outs):
                            return m
                    if evs[0].get("markets"):
                        return evs[0]["markets"][0]
    except: pass
    return None

def btc5m_analyze(klines: list, price: float, win_open: float, ticks: list) -> dict:
    """
    7-indicator weighted signal (from Archetapp guide, adapted):
    1. Window Delta      5-7  ← dominant
    2. Micro Momentum    2
    3. Acceleration      1.5
    4. EMA 9/21          1
    5. RSI 14            1-2
    6. Volume Surge      1
    7. Tick Trend        2
    """
    if len(klines) < 5 or price <= 0:
        return {"dir": "", "confidence": 0, "score": 0, "indicators": {}}

    closes  = [k["close"]  for k in klines]
    volumes = [k["volume"] for k in klines]

    score = 0.0
    ind   = {}

    # 1. Window Delta — most important
    if win_open > 0:
        delta_pct = (price - win_open) / win_open * 100
        if   abs(delta_pct) > 0.10: w = 7
        elif abs(delta_pct) > 0.02: w = 5
        elif abs(delta_pct) > 0.005: w = 3
        elif abs(delta_pct) > 0.001: w = 1
        else: w = 0
        s1 = w if delta_pct > 0 else -w
        score += s1
        ind["win_delta"] = {"pct": round(delta_pct, 4), "score": s1}

    # 2. Micro Momentum — last 2 candles
    if len(closes) >= 3:
        m1 = closes[-1] - closes[-2]
        m2 = closes[-2] - closes[-3]
        s2 = 2 if m1 > 0 and m2 > 0 else (-2 if m1 < 0 and m2 < 0 else 0)
        score += s2
        ind["micro_mom"] = {"score": s2}

    # 3. Acceleration
    if len(closes) >= 3:
        c1  = closes[-1] - closes[-2]
        c2  = closes[-2] - closes[-3]
        acc = c1 - c2
        s3  = 1.5 if acc > 0 else (-1.5 if acc < 0 else 0)
        score += s3
        ind["acceleration"] = {"score": round(s3, 1)}

    # 4. EMA 9/21
    def ema(data, n):
        k = 2/(n+1); r = [data[0]]
        for p in data[1:]: r.append(p*k + r[-1]*(1-k))
        return r
    if len(closes) >= 21:
        e9 = ema(closes, 9); e21 = ema(closes, 21)
        s4 = 1 if e9[-1] > e21[-1] else -1
        score += s4
        ind["ema_9_21"] = {"ema9": round(e9[-1], 2), "ema21": round(e21[-1], 2), "score": s4}

    # 5. RSI 14
    if len(closes) >= 15:
        gains, losses = [], []
        for i in range(1, 15):
            d = closes[-15+i] - closes[-15+i-1]
            gains.append(max(d, 0)); losses.append(max(-d, 0))
        ag = sum(gains)/14; al = sum(losses)/14 if sum(losses) else 1e-9
        rsi = 100 - (100/(1+ag/al))
        w5  = 2 if rsi > 75 or rsi < 25 else 1
        s5  = -w5 if rsi > 75 else (w5 if rsi < 25 else 0)
        score += s5
        ind["rsi14"] = {"rsi": round(rsi, 1), "score": s5}

    # 6. Volume Surge
    if len(volumes) >= 6:
        recent = sum(volumes[-3:]) / 3
        prior  = sum(volumes[-6:-3]) / 3
        surge  = recent > prior * 1.5
        if surge:
            last_dir = closes[-1] - closes[-4] if len(closes) >= 4 else 0
            s6 = 1 if last_dir > 0 else -1
        else: s6 = 0
        score += s6
        ind["volume"] = {"surge": surge, "score": s6}

    # 7. Tick Trend (real-time sub-1m)
    if len(ticks) >= 5:
        ups   = sum(1 for i in range(1, len(ticks)) if ticks[i] > ticks[i-1])
        downs = len(ticks) - 1 - ups
        total = ups + downs
        if total > 0:
            bias = ups/total
            move = abs(ticks[-1] - ticks[0]) / ticks[0] * 100
            if bias >= 0.6 and move > 0.005:
                s7 = 2
            elif bias <= 0.4 and move > 0.005:
                s7 = -2
            else:
                s7 = 0
        else: s7 = 0
        score += s7
        ind["tick_trend"] = {"ups": ups, "downs": downs, "score": s7}

    # Confidence = min(|score|/7, 1.0)
    confidence = min(abs(score) / 7.0, 1.0)
    direction  = "UP" if score > 0 else ("DOWN" if score < 0 else "")
    if confidence < 0.25:   # min 25% confidence to act
        direction = ""

    return {
        "dir":        direction,
        "confidence": round(confidence, 3),
        "score":      round(score, 2),
        "indicators": ind,
    }

async def btc5m_entry(sig: dict, secs_left: int, sess):
    """Try to build a position from BTC5m signal"""
    b5  = S.btc5m
    mkt = b5["market_data"]
    if not mkt: return

    outs   = mkt.get("outcomes", "[]"); prices = mkt.get("outcomePrices", "[]")
    if isinstance(outs, str):
        try: outs   = json.loads(outs)
        except: outs = []
    if isinstance(prices, str):
        try: prices = json.loads(prices)
        except: prices = []
    if not outs or not prices or len(outs) != len(prices): return

    tgt_price = None
    for i, o in enumerate(outs):
        ol = str(o).lower()
        if sig["dir"] == "UP"   and ol in ("up", "yes"):  tgt_price = float(prices[i])
        if sig["dir"] == "DOWN" and ol in ("down", "no"): tgt_price = float(prices[i])

    if tgt_price is None or not (0.02 < tgt_price < 0.98): return

    true_prob = min(0.92, sig["confidence"])
    ev_val    = (true_prob*(1-tgt_price)) - ((1-true_prob)*tgt_price)
    if ev_val < 0.01: return

    mkt_dict = {
        "id":          mkt.get("id", b5["slug"]),
        "question":    mkt.get("question", f"BTC 5m {b5['slug']}")[:80],
        "category":    "btc5m",
        "yes_price":   tgt_price,
        "no_price":    1-tgt_price,
        "volume":      float(mkt.get("volume", 0) or 0),
        "volume_24h":  float(mkt.get("volume24hr", 0) or 0),
        "end_date":    "",
        "resolve_sec": secs_left,
        "resolve_fmt": f"{secs_left}s",
        "spread":      0,
    }
    sig_dict = {
        "strategy":   "btc5m",
        "outcome":    sig["dir"],
        "ev":         round(ev_val, 4),
        "true_prob":  round(true_prob, 4),
        "price":      round(tgt_price, 4),
        "confidence": sig["confidence"],
    }
    await open_position(mkt_dict, sig_dict)
    b5["entry_fired"]  = True
    b5["stats"]["total"] = b5["stats"].get("total", 0) + 1

async def btc5m_loop():
    """
    Dedicated BTC5m loop — polls every 2s (Sprint 1 upgrade from 8s).
    Entry zone: T-10s to T-5s (Sprint 1 upgrade from T-30s).
    Spike detection: score jump ≥1.5 → fire immediately.
    Hard deadline: T-5s → force entry if not yet fired.
    """
    print(f"[BTC5m] loop started — poll 2s, entry T-10s→T-5s, spike detect ON")
    b5 = S.btc5m

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as sess:
        while True:
            try:
                now_ts    = int(datetime.now(timezone.utc).timestamp())
                win_ts    = btc5m_window_ts(now_ts)
                secs_left = btc5m_secs_left(now_ts)
                slug      = btc5m_slug(win_ts)

                # New window reset
                if win_ts != b5["win_ts"]:
                    b5["win_ts"]                  = win_ts
                    b5["slug"]                    = slug
                    b5["entry_fired"]             = False
                    b5["predicted_dir"]           = ""
                    b5["confidence"]              = 0.0
                    b5["score"]                   = 0.0
                    b5["market_data"]             = {}
                    b5["ticks"]                   = []
                    b5["win_open"]                = 0.0
                    b5["prev_score"]              = 0.0
                    b5["highest_confidence_seen"] = 0.0
                    print(f"[BTC5m] New window: {slug} | {secs_left}s left")

                # Always fetch live price
                price = await btc5m_fetch_price(sess)
                if price > 0:
                    b5["btc_price"] = round(price, 2)
                    b5["ticks"].append(price)
                    if len(b5["ticks"]) > 30: b5["ticks"] = b5["ticks"][-30:]
                    b5["last_tick"] = price

                # Fetch klines every 55s
                if now_ts - b5["last_kline_fetch"] >= 55 or not b5["klines"]:
                    kl = await btc5m_fetch_klines(sess, 30)
                    if kl:
                        b5["klines"] = kl
                        for k in reversed(kl):
                            if k["ts"] <= win_ts:
                                b5["win_open"] = k["close"]
                                break
                    b5["last_kline_fetch"] = now_ts

                # Fetch market data every 55s or new window
                if now_ts - b5["last_market_fetch"] >= 55 or not b5["market_data"]:
                    mkt = await btc5m_fetch_market(slug, sess)
                    if mkt: b5["market_data"] = mkt
                    b5["last_market_fetch"] = now_ts

                # Always compute signal
                sig = btc5m_analyze(b5["klines"], b5["btc_price"], b5["win_open"], b5["ticks"])
                b5["predicted_dir"] = sig["dir"]
                b5["confidence"]    = sig["confidence"]
                b5["score"]         = sig["score"]
                b5["indicators"]    = sig["indicators"]

                # Update sprint 1 tracking
                prev_score                    = b5.get("prev_score", 0.0)
                b5["highest_confidence_seen"] = max(
                    b5.get("highest_confidence_seen", 0.0), sig["confidence"]
                )

                # Entry zone: T-10s to T-5s (Sprint 1: was T-30s)
                b5["secs_left"]     = secs_left
                b5["in_entry_zone"] = 5 <= secs_left <= 10

                # Spike detection: score jumped ≥1.5 → fire immediately regardless zone
                spike_detected = (sig["score"] - prev_score) >= 1.5 and sig["dir"]

                # Hard deadline: T-5s or below → force entry regardless confidence
                hard_deadline = secs_left <= 5 and sig["dir"]

                should_fire = (
                    not b5["entry_fired"]
                    and sig["dir"]
                    and S.running
                    and not S.gas_paused
                    and sig["confidence"] >= 0.25
                    and (b5["in_entry_zone"] or spike_detected or hard_deadline)
                )

                if should_fire:
                    fire_reason = (
                        "spike" if spike_detected else
                        "deadline" if hard_deadline else
                        "zone"
                    )
                    print(f"[BTC5m] FIRE [{fire_reason}] {sig['dir']} conf={sig['confidence']:.2f} score={sig['score']:.1f} secs={secs_left}")
                    await btc5m_entry(sig, secs_left, sess)

                # Update prev_score after entry decision
                b5["prev_score"] = sig["score"]

                await broadcast({"type": "btc5m", "data": get_btc5m_info()})

            except Exception as e:
                S.errors.append(f"[BTC5m] {str(e)[:60]}")

            # Sprint 1: poll every 2s (was 8s) for tighter entry timing
            await asyncio.sleep(2)

def get_btc5m_info():
    b5 = S.btc5m
    return {
        "slug":                   b5["slug"],
        "win_ts":                 b5["win_ts"],
        "secs_left":              b5["secs_left"],
        "btc_price":              b5["btc_price"],
        "win_open":               b5["win_open"],
        "delta_pct":              round((b5["btc_price"]-b5["win_open"])/b5["win_open"]*100, 4) if b5["win_open"] > 0 else 0,
        "predicted_dir":          b5["predicted_dir"],
        "confidence":             b5["confidence"],
        "score":                  b5["score"],
        "prev_score":             b5.get("prev_score", 0.0),
        "highest_confidence_seen": b5.get("highest_confidence_seen", 0.0),
        "entry_fired":            b5["entry_fired"],
        "in_entry_zone":          b5["in_entry_zone"],
        "indicators":             b5["indicators"],
        "stats":                  b5["stats"],
        "klines":                 b5["klines"][-10:],   # last 10 for mini chart
        "market_found":           bool(b5["market_data"]),
        "poll_interval":          "2s",
        "entry_window":           "T-10s→T-5s",
    }

# ─── SOCCER SCANNER ──────────────────────────────────────────
SOCCER_KW = ["soccer","football","premier league","la liga","serie a","bundesliga",
             "champions league","epl","mls","match","vs","goal","winner","score"]
SLOW_KW   = ["2027","2028","ever","lifetime","rihanna","gta","album","movie","2026 year"]

async def fetch_soccer_markets(sess) -> list:
    """Fetch soccer/football markets from Gamma, same-day resolve"""
    try:
        results = []
        for params in [
            {"active": "true", "closed": "false", "limit": 100, "order": "volume24hr", "ascending": "false"},
            {"active": "true", "closed": "false", "limit": 100, "order": "endDate", "ascending": "true"},
        ]:
            try:
                async with sess.get(f"{GAMMA}/markets", params=params) as r:
                    if r.status == 200:
                        data = await r.json()
                        items = data if isinstance(data, list) else data.get("markets", [])
                        results.extend(items)
            except: pass

        seen = set(); unique = []
        for m in results:
            mid = m.get("id", "")
            if mid and mid not in seen:
                seen.add(mid); unique.append(m)

        soccer = []
        for m in unique:
            q  = m.get("question", "").lower()
            ed = m.get("endDate", "")
            if any(w in q for w in SLOW_KW): continue
            if not any(w in q for w in SOCCER_KW): continue
            rs = _resolve_sec(q, ed)
            if rs > 86400 * 3: continue
            m["_resolve_sec"] = rs
            soccer.append(m)

        soccer.sort(key=lambda m: m.get("_resolve_sec", 999999))
        return soccer[:50]
    except Exception as e:
        S.errors.append(f"soccer_scan: {str(e)[:60]}")
        return []

def _resolve_sec(q: str, ed: str) -> int:
    if ed:
        try:
            dt   = datetime.fromisoformat(ed.replace("Z", "+00:00"))
            diff = (dt - datetime.now(timezone.utc)).total_seconds()
            if diff > 0: return int(diff)
        except: pass
    return 86400

def _parse_market(m: dict) -> Optional[dict]:
    yes_p = no_p = None
    outs = m.get("outcomes", "[]"); prices = m.get("outcomePrices", "[]")
    if isinstance(outs, str):
        try: outs   = json.loads(outs)
        except: outs = []
    if isinstance(prices, str):
        try: prices = json.loads(prices)
        except: prices = []
    if outs and prices and len(outs) == len(prices):
        try:
            yi = list(outs).index("Yes"); ni = list(outs).index("No")
            yes_p = float(prices[yi]); no_p = float(prices[ni])
        except: pass
    if yes_p is None:
        tokens = m.get("tokens", [])
        yt = next((t for t in tokens if t.get("outcome") == "Yes"), None)
        nt = next((t for t in tokens if t.get("outcome") == "No"), None)
        if yt and nt:
            try: yes_p=float(yt.get("price",0)); no_p=float(nt.get("price",0))
            except: return None
    if not yes_p or not no_p or yes_p<=0 or no_p<=0: return None
    vol   = float(m.get("volume", 0) or 0)
    vol24 = float(m.get("volume24hr", 0) or 0)
    q     = m.get("question", "")[:90]
    ed    = m.get("endDate", "")
    rs    = m.get("_resolve_sec", _resolve_sec(q, ed))
    rsf   = (f"{int(rs//60)}m" if rs<3600 else f"{rs/3600:.1f}h" if rs<86400 else f"{rs/86400:.1f}d")
    return {
        "id": q and m.get("id",""), "question": q, "category": "soccer",
        "yes_price": round(yes_p, 4), "no_price": round(no_p, 4),
        "volume": round(vol, 2), "volume_24h": round(vol24, 2),
        "end_date": ed, "resolve_sec": rs, "resolve_fmt": rsf,
        "spread": round(abs(1-yes_p-no_p), 4),
    }

def _detect_soccer_signal(m: dict) -> Optional[dict]:
    yp  = m["yes_price"]; np_ = m["no_price"]
    vol = m.get("volume_24h", m["volume"])
    if vol < 500: return None
    # Arb
    if yp+np_ < 0.985:
        pf = round(1-yp-np_, 4)
        if pf >= 0.005:
            return {"strategy": "arb", "outcome": "YES+NO", "ev": pf, "true_prob": 0.99, "price": yp, "confidence": 0.95}
    # No-bias: YES overpriced
    if 0.72 <= yp <= 0.93:
        tp = min(np_+0.12, 0.87)
        ev = (tp*(1-np_)) - ((1-tp)*np_)
        if ev >= C.min_ev:
            return {"strategy": "no_bias", "outcome": "NO", "ev": round(ev,4), "true_prob": tp, "price": np_, "confidence": 0.65}
    # High-prob YES
    if 0.55 <= yp <= 0.88:
        tp = min(yp+0.06, 0.92)
        ev = (tp*(1-yp)) - ((1-tp)*yp)
        if ev >= C.min_ev:
            return {"strategy": "high_prob", "outcome": "YES", "ev": round(ev,4), "true_prob": tp, "price": yp, "confidence": 0.70}
    return None

def build_soccer_rows(parsed: list) -> list:
    rows = []
    for p in parsed:
        if not p: continue
        sig = _detect_soccer_signal(p)
        rows.append({**p,
            "signal":    sig["strategy"] if sig else "—",
            "ev":        round(sig["ev"], 4) if sig else 0,
            "true_prob": round(sig["true_prob"], 4) if sig else 0,
            "outcome":   sig["outcome"] if sig else "—",
            "confidence": round(sig["confidence"], 3) if sig else 0,
        })
    rows.sort(key=lambda r: (r["signal"]=="—", r.get("resolve_sec", 999999)))
    return rows

# ─── POSITION MANAGEMENT ─────────────────────────────────────
def calc_size(price: float) -> float:
    eq      = equity()
    max_bet = compound_bet(eq)
    avail   = S.capital
    return round(max(C.min_bet, min(max_bet, avail * 0.40)), 2)

def risk_ok(mid: str, sig: dict) -> tuple[bool, str]:
    if not S.running:
        return False, "Bot tidak berjalan"
    if S.gas_paused:
        return False, f"Gas stop: {gas_orders_left()} order tersisa"
    if S.daily_pnl <= -C.daily_loss_limit:
        return False, f"Daily loss limit ${C.daily_loss_limit}"
    ops = [p for p in S.positions if p["status"] == "open"]
    if len(ops) >= C.max_open_pos:
        return False, f"Max {C.max_open_pos} posisi"
    if any(p["market_id"] == mid for p in ops):
        return False, "Sudah ada posisi"
    if S.capital < C.min_bet:
        return False, f"Capital ${S.capital:.2f} < min ${C.min_bet}"
    # Sprint 1: balance floor circuit breaker (real mode only)
    if MODE == "real" and S.capital < C.balance_floor:
        return False, f"Balance floor: USDC ${S.capital:.2f} < ${C.balance_floor}"
    return True, "OK"

async def open_position(market: dict, sig: dict):
    async with _lock:
        ok, reason = risk_ok(market["id"], sig)
        if not ok:
            if S.log and S.log[0].get("reason") == reason: return
            add_log("REJECTED", {"reason": reason, "question": market["question"][:45],
                                 "strategy": sig.get("strategy", "")})
            return
        size = calc_size(sig["price"])
        size = min(size, S.capital)
        if size < C.min_bet: return
        S.capital    = round(S.capital - size, 4)
        S.locked     = round(S.locked + size, 4)
        S.pos_counter += 1
        pos = {
            "id":           f"{'S' if MODE=='sim' else 'R'}-{BOT_ID[-1]}-{S.pos_counter:04d}",
            "market_id":    market["id"],
            "question":     market["question"],
            "category":     market["category"],
            "outcome":      sig["outcome"],
            "price":        sig["price"],
            "true_prob":    sig["true_prob"],
            "size":         size,
            "shares":       round(size/sig["price"], 4) if sig["price"] > 0 else 0,
            "ev":           sig["ev"],
            "strategy":     sig["strategy"],
            "confidence":   sig.get("confidence", 0),
            "status":       "open",
            "opened_at":    datetime.now(timezone.utc).isoformat(),
            "resolve_sec":  market.get("resolve_sec", 86400),
            "resolve_fmt":  market.get("resolve_fmt", "?"),
            "compound_bet": compound_bet(equity()),
        }
        S.positions.append(pos)
        consume_gas()
        entry = add_log("OPEN", {
            "id": pos["id"], "question": pos["question"][:55],
            "outcome": pos["outcome"], "price": pos["price"],
            "size": pos["size"], "ev": pos["ev"],
            "strategy": pos["strategy"], "category": pos["category"],
            "resolve_fmt": pos["resolve_fmt"], "confidence": pos.get("confidence", 0),
        })
    await broadcast({"type": "log", "data": entry})
    await broadcast({"type": "positions", "data": open_pos()})
    await broadcast({"type": "stats", "data": get_stats()})

async def close_position(pos: dict, won: bool):
    async with _lock:
        if pos["status"] != "open": return
        size = pos["size"]; price = pos["price"]
        if won:
            payout = round(size/price, 4); pnl = round(payout-size, 4)
            S.capital = round(S.capital+payout, 4)
            S.locked  = round(S.locked-size, 4)
        else:
            payout = 0.0; pnl = round(-size, 4)
            S.locked = round(S.locked-size, 4)
        pos["status"]     = "won" if won else "lost"
        pos["pnl"]        = pnl
        pos["payout"]     = payout
        pos["exit_price"] = 1.0 if won else 0.0
        pos["closed_at"]  = datetime.now(timezone.utc).isoformat()
        S.daily_pnl    = round(S.daily_pnl+pnl, 4)
        S.lifetime_pnl = round(S.lifetime_pnl+pnl, 4)
        if pos.get("strategy") == "btc5m":
            if won: S.btc5m["stats"]["wins"]   = S.btc5m["stats"].get("wins", 0)+1
            else:   S.btc5m["stats"]["losses"] = S.btc5m["stats"].get("losses", 0)+1
        S.positions.remove(pos); S.closed_trades.append(pos)
        leveled  = check_compound_levelup()
        salaried = check_salary()
        entry = add_log("CLOSE", {
            "id": pos["id"], "result": pos["status"], "pnl": pnl,
            "question": pos["question"][:50], "capital": round(equity(), 4),
            "strategy": pos.get("strategy", ""),
        })
        db_save_trade(pos)
        db_save_daily_loss()   # Sprint 1: persist daily loss
        save_state()
    await broadcast({"type": "log", "data": entry})
    if leveled:  await broadcast({"type": "compound_up", "data": S.compound_events[-1]})
    if salaried: await broadcast({"type": "salary", "data": S.salary_events[-1]})
    await broadcast({"type": "positions", "data": open_pos()})
    await broadcast({"type": "stats", "data": get_stats()})

# ─── SCANNER LOOP ────────────────────────────────────────────
async def scanner_loop():
    last_fetch = 0
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12)) as sess:
        while True:
            try:
                daily_reset(); S.scan_count += 1
                now_ts = time.time()

                if now_ts - last_fetch >= 30 or not S.soccer_markets:
                    raw = await fetch_soccer_markets(sess)
                    if raw:
                        parsed = [_parse_market(m) for m in raw]
                        parsed = [m for m in parsed if m]
                        S.soccer_markets  = build_soccer_rows(parsed)
                        S.signals_found  += sum(1 for r in S.soccer_markets if r["signal"] != "—")
                    last_fetch = now_ts

                # Auto-bet soccer signals
                if S.running and not S.gas_paused:
                    for row in S.soccer_markets:
                        if row["signal"] == "—": continue
                        if random.random() < 0.20:
                            sig = {
                                "strategy":  row["signal"],
                                "outcome":   row["outcome"],
                                "ev":        row["ev"],
                                "true_prob": row["true_prob"],
                                "price":     row["yes_price"] if row["outcome"] in ("YES","YES+NO") else row["no_price"],
                                "confidence": row.get("confidence", 0.6),
                            }
                            await open_position(row, sig)

                await broadcast({"type": "stats",  "data": get_stats()})
                await broadcast({"type": "soccer", "data": S.soccer_markets[:30]})
                await broadcast({"type": "gas",    "data": get_gas_info()})

            except Exception as e:
                S.errors.append(f"scan: {str(e)[:60]}")

            await asyncio.sleep(C.scan_sec)

async def resolver_loop():
    """Sim: resolve positions based on estimated resolve time"""
    while True:
        now = datetime.now(timezone.utc)
        for pos in list(S.positions):
            if pos["status"] != "open": continue
            opened  = datetime.fromisoformat(pos["opened_at"])
            elapsed = (now-opened).total_seconds()
            if elapsed >= pos.get("resolve_sec", 86400):
                tp  = pos.get("true_prob", 0.65)
                won = random.random() < (tp * 0.93)
                await close_position(pos, won)
        await asyncio.sleep(5)

# ─── DATA HELPERS ────────────────────────────────────────────
def open_pos(): return [p for p in S.positions if p["status"] == "open"]

def get_stats():
    eq    = equity()
    total = len(S.closed_trades)
    wins  = sum(1 for t in S.closed_trades if t["status"] == "won")
    pnl   = round(eq - S.initial, 4)
    cbet  = compound_bet(eq)
    sal   = S.salary_events[-1] if S.salary_events else {}
    return {
        "bot_id":          BOT_ID,
        "mode":            MODE.upper(),
        "running":         S.running,
        "capital":         round(eq, 4),
        "available":       round(S.capital, 4),
        "locked":          round(S.locked, 4),
        "initial":         S.initial,
        "pnl":             pnl,
        "roi_pct":         round(pnl/S.initial*100, 2) if S.initial else 0,
        "lifetime_pnl":    round(S.lifetime_pnl, 4),
        "total_withdrawn": round(S.total_withdrawn, 4),
        "total_trades":    total,
        "wins":            wins,
        "losses":          total-wins,
        "win_rate":        round(wins/total*100, 1) if total else 0,
        "open_count":      len(open_pos()),
        "daily_pnl":       round(S.daily_pnl, 4),
        "daily_stopped":   S.daily_pnl <= -C.daily_loss_limit,
        "scan_count":      S.scan_count,
        "signals_found":   S.signals_found,
        "start_time":      S.start_time,
        "errors":          S.errors[-3:],
        "gas":             get_gas_info(),
        # compound
        "compound_bet":    cbet,
        "compound_next":   compound_next_at(eq),
        "compound_prog":   compound_progress(eq),
        "compound_events": S.compound_events[-3:],
        # salary
        "salary": {
            "next_target":     S.salary_target,
            "current_equity":  round(eq, 4),
            "to_next":         round(max(0, S.salary_target-eq), 4),
            "progress_pct":    round(min(100, eq/S.salary_target*100), 1) if S.salary_target else 0,
            "total_withdrawn": round(S.total_withdrawn, 4),
            "salary_count":    len(S.salary_events),
            "last_event":      sal,
        },
        # btc5m summary
        "btc5m_stats":     S.btc5m["stats"],
        # circuit breaker status
        "circuit_breakers": {
            "balance_floor_ok":  not (MODE == "real" and S.capital < C.balance_floor),
            "daily_loss_ok":     S.daily_pnl > -C.daily_loss_limit,
            "gas_ok":            gas_status() != "critical",
            "balance_floor":     C.balance_floor,
            "daily_loss_limit":  C.daily_loss_limit,
        },
    }

# ─── API ROUTES ──────────────────────────────────────────────
@app.get("/health")
def health(): return {"status": "ok", "bot_id": BOT_ID, "mode": MODE, "running": S.running}

@app.get("/api/stats")
def api_stats(): return get_stats()

@app.get("/api/positions")
def api_positions(): return open_pos()

@app.get("/api/history")
def api_history(limit: int = 200): return S.closed_trades[-limit:][::-1]

@app.get("/api/soccer")
def api_soccer(): return S.soccer_markets[:30]

@app.get("/api/log")
def api_log(limit: int = 200): return S.log[:limit]

@app.get("/api/gas")
def api_gas(): return get_gas_info()

@app.get("/api/btc5m")
def api_btc5m(): return get_btc5m_info()

@app.get("/api/balance")
async def api_balance():
    """Live balance endpoint — Sprint 1 addition."""
    return {
        "usdc":         round(S.capital, 4),
        "pol":          round(S.pol_left, 4),
        "last_refresh": S.last_balance_refresh,
        "source":       "live" if MODE == "real" else "simulated",
        "balance_floor": C.balance_floor,
        "floor_ok":     not (MODE == "real" and S.capital < C.balance_floor),
    }

@app.post("/api/gas/resume")
async def api_gas_resume():
    S.gas_paused = False
    add_log("GAS_RESUME", {"message": "Bot aktif kembali setelah top-up POL"})
    await broadcast({"type": "stats", "data": get_stats()})
    return {"ok": True}

@app.post("/api/bot/start")
async def api_bot_start():
    """Start real bot (only available in real mode)"""
    S.running = True
    add_log("BOT_START", {"message": f"Bot {BOT_ID} started", "mode": MODE})
    await broadcast({"type": "stats", "data": get_stats()})
    return {"ok": True, "running": True}

@app.post("/api/bot/stop")
async def api_bot_stop():
    """Stop bot (pause auto-betting)"""
    S.running = False
    add_log("BOT_STOP", {"message": f"Bot {BOT_ID} stopped by user"})
    await broadcast({"type": "stats", "data": get_stats()})
    return {"ok": True, "running": False}

@app.post("/api/reset")
async def api_reset():
    global S
    if STATE_FILE.exists(): STATE_FILE.unlink()
    S = BotState()
    await broadcast({"type": "stats", "data": get_stats()})
    return {"ok": True}

@app.get("/api/db/summary")
def api_db_summary(): return db_summary()

@app.get("/api/db/trades")
def api_db_trades(bot_id: str = "", limit: int = 200): return db_trades(bot_id, limit)

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept(); S.ws_clients.add(ws)
    try:
        await ws.send_text(json.dumps({"type": "init", "data": {
            "stats":     get_stats(),
            "positions": open_pos(),
            "log":       S.log[:60],
            "soccer":    S.soccer_markets[:20],
            "btc5m":     get_btc5m_info(),
            "history":   S.closed_trades[-40:][::-1],
            "gas":       get_gas_info(),
            "balance": {
                "usdc":         round(S.capital, 4),
                "pol":          round(S.pol_left, 4),
                "last_refresh": S.last_balance_refresh,
            },
        }}, default=str))
        while True: await ws.receive_text()
    except WebSocketDisconnect: pass
    finally: S.ws_clients.discard(ws)

@app.on_event("startup")
async def startup():
    db_init()
    with _db_lock:
        con = sqlite3.connect(DB_PATH)
        con.execute("INSERT INTO sessions VALUES (?,?,?,?,?)",
            (BOT_ID, MODE, datetime.now().isoformat(), C.usdc_capital, C.pol_balance))
        con.commit(); con.close()
    resumed = load_state()
    db_load_daily_loss()                           # Sprint 1: restore daily P&L from DB
    asyncio.create_task(btc5m_loop())
    asyncio.create_task(scanner_loop())
    asyncio.create_task(balance_refresh_loop())    # Sprint 1: auto-fetch balance
    asyncio.create_task(stoploss_monitor_loop())   # Sprint 1: per-trade stop-loss
    if MODE == "sim":
        asyncio.create_task(resolver_loop())
    print(f"[{BOT_ID}] mode={MODE} capital=${S.capital:.2f} pol={S.pol_left} resumed={resumed}")
    print(f"[{BOT_ID}] Sprint 1: balance_floor=${C.balance_floor} daily_loss=${C.daily_loss_limit}")
    print(f"[{BOT_ID}] Sprint 1: BTC5m poll=2s entry=T-10s spike_detect=ON")
    print(f"[{BOT_ID}] compound: floor(equity/10) = max_bet, min $1")
    print(f"[{BOT_ID}] gas auto-stop: < {C.gas_stop_orders} orders")
    print(f"[{BOT_ID}] web3_ok={WEB3_OK}")

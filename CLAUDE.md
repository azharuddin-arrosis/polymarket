# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Run Commands

```bash
# Start sim bots (sim1 + sim2)
docker compose --profile sim up -d --build

# Start only one sim bot
docker compose --profile sim1 up -d --build

# Start real bots
docker compose --profile real up -d --build
docker compose --profile real1 up -d --build

# Start everything
docker compose --profile all up -d --build

# Logs
docker compose logs -f sim1          # backend bot logs
docker compose logs -f dash-sim1     # frontend-bot logs

# Stop all
docker compose down
```

**Local dev (frontend-bot):** `cd frontend-bot && npm install && npm run dev` — proxies `/api` and `/ws` to `localhost:8000` (expects a backend running locally or port-forwarded).

**Local dev (frontend-main):** No vite.config proxy — relies on nginx at container level. Run with Docker only.

**Backend only:** `cd backend && pip install -r requirements.txt && BOT_ID=sim1 BOT_MODE=sim uvicorn main:app --reload`

## Architecture

### Overview

Multi-bot Polymarket trading system with two separate React frontends and one shared Python backend image.

```
docker-compose.yml
├── backend (×N containers, same image)   → FastAPI on :8000
├── frontend-bot (×N containers)          → per-bot dashboard on :31xx/:32xx
└── frontend-main (×1 container)          → fleet overview on :3000
```

Active bots (current config): **sim1, sim2** (simulation) + **real1, real2** (real money).

### Backend (`backend/main.py`)

Single-file FastAPI app. One process per bot container, configured entirely via env vars. Key env vars: `BOT_ID`, `BOT_MODE` (sim|real), `USDC_CAPITAL`, `POL_BALANCE`.

**Data persistence:**
- `shared_data` Docker volume mounted at `/app/data` — shared across ALL bot containers
- `trades.db` — SQLite, shared; each bot writes rows tagged with `bot_id`
- `state_{BOT_ID}.json` — per-bot state snapshot (capital, positions, gas, etc.)

**Two trading strategies run concurrently in asyncio tasks:**
1. `btc5m_loop()` — polls Binance for BTC price every 8s, computes 7-indicator signal, enters Polymarket BTC 5-min window markets at T-30s to T-5s
2. `scanner_loop()` — fetches soccer/football markets from Gamma API every 30s, scores signals, auto-bets at 20% probability

**Signal flow:** `btc5m_analyze()` → score → `btc5m_entry()` → `open_position()` → `consume_gas()` → broadcast via WebSocket

**Compound logic:** `compound_bet(equity) = min(max(floor(equity/10), 1), 50)` — bet size in dollars.

**Gas logic:** 50% of POL reserved at all times. Auto-pause when usable POL < 2 orders worth. Resume via `POST /api/gas/resume`.

**Sim mode:** `resolver_loop()` runs and auto-resolves positions after their `resolve_sec` elapses, using `true_prob * 0.93` as win probability.

**Real mode:** Bot starts paused (`running=False`); requires manual `POST /api/bot/start` or the RUN button in UI.

**WebSocket message types** (broadcast by backend, consumed by frontend):
`init`, `stats`, `positions`, `log`, `soccer`, `btc5m`, `gas`, `gas_stop`, `compound_up`, `salary`

### frontend-main (`frontend-main/`)

Fleet overview dashboard. Shows all bots as cards. Pulls data from each backend via nginx reverse proxy paths.

**Routing pattern:** nginx at `:3000` proxies `/sim1/*` → `sim1:8000`, `/sim2/*` → `sim2:8000`, `/r1/*` and `/real1/*` → `real1:8000`, etc.

**`useBot(prefix)`** (in `src/hooks/useBot.js`): connects WebSocket to `/{prefix}/ws` and polls `/{prefix}/api/stats`. Only tracks `stats` and `btc5m` — minimal data for the card view.

**`useDbSummary()`**: fetches cross-bot aggregate from `/sim1/api/db/summary` every 10s — hardcoded to sim1 as DB gateway since all bots share the same SQLite file.

**BOTS array** (in `src/App.jsx`): defines which bots appear. Currently: sim1 (Koceng), sim2 (Wedos), real1 (REAL 1), real2 (REAL 2).

### frontend-bot (`frontend-bot/`)

Per-bot detailed dashboard. Each container receives `BACKEND_HOST` env var; nginx proxies `/api/` and `/ws` to `${BACKEND_HOST}:8000`.

**`useBot()`** (no args, in `src/hooks/useBot.js`): connects to the container's own backend at `/ws`. Tracks full state: stats, positions, log, soccer markets, history, btc5m, gas.

The App.jsx here is the detailed trading view: live P&L sparkline, open positions table with countdown timers, BTC5m signal panel with kline mini-chart, soccer market scanner table, trade history, event log.

### Env Files (`envs/`)

One `.env` file per bot. `real1.env` / `real2.env` require Polymarket credentials: `POLY_PRIVATE_KEY`, `POLY_API_KEY`, `POLY_SECRET`, `POLY_PASSPHRASE`. Sim envs only need capital/config values.

### Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Healthcheck (used by Docker) |
| GET | `/api/stats` | Full bot stats snapshot |
| GET | `/api/btc5m` | BTC5m signal state |
| GET | `/api/gas` | Gas info |
| GET | `/api/soccer` | Current soccer market rows |
| GET | `/api/positions` | Open positions |
| GET | `/api/history` | Closed trades |
| GET | `/api/log` | Event log |
| GET | `/api/db/summary` | Cross-bot SQLite aggregate |
| POST | `/api/bot/start` | Start bot (real mode) |
| POST | `/api/bot/stop` | Stop bot |
| POST | `/api/gas/resume` | Resume after gas auto-pause |
| POST | `/api/reset` | Wipe state (deletes state.json) |
| WS | `/ws` | Real-time updates |

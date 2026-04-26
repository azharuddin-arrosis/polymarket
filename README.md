# POLYMARKET BOT FINAL
## BTC 5m + Soccer Only | Multi-Bot | Per-Bot Dashboard

## Quick Start
```bash
./deploy.sh          # deploy all bots (sim + real) + main dashboard
```

## Ports
| Service        | URL                    |
|----------------|------------------------|
| Main Dashboard | http://SERVER:3000     |
| SIM 1          | http://SERVER:3101     |
| SIM 2          | http://SERVER:3102     |
| REAL 1         | http://SERVER:3201     |
| REAL 2         | http://SERVER:3202     |

## Run Commands
```bash
./deploy.sh              # deploy all bots (sim + real) + main dashboard
./deploy.sh all          # same as above
./deploy.sh sim          # deploy sim bots only (sim1, sim2 + dashboards)
./deploy.sh real         # deploy real bots only (real1, real2 + dashboards)
./deploy.sh down         # stop and remove all containers
./deploy.sh logs         # tail logs for sim1 (default)
./deploy.sh logs real1   # tail logs for a specific service
./deploy.sh status       # show status of all bot containers
```

## Compound Logic (floor(equity/10) = bet)
| Equity  | Max Bet |
|---------|---------|
| $0-$9   | $1      |
| $10-$19 | $1      |
| $20-$29 | $2      |
| $30-$39 | $3      |
| $50-$59 | $5      |
| $100+   | $10+    |

## Gas Auto-Stop
- 50% POL reserved at all times
- Warning at < 5 orders worth
- AUTO-STOP at < 2 orders worth
- Resume via dashboard button or: POST /api/gas/resume

## Real Bot Setup
1. Edit `envs/real1.env`
2. Add POLY_PRIVATE_KEY, POLY_API_KEY, POLY_SECRET, POLY_PASSPHRASE
3. Run: `docker compose --profile real1 up -d --build`
4. Open http://SERVER:3201 → click ▶ RUN button

## BTC 5M
- 12 entries per hour (every 5 min window)
- Entry zone: T-30s to T-5s before window close
- 7 indicators: Window Delta (dominant), EMA9/21, RSI14, Micro Momentum,
  Acceleration, Volume Surge, Tick Trend
- Auto-detect slug: btc-updown-5m-{window_ts}
# polymarket

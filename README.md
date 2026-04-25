# POLYMARKET BOT FINAL
## BTC 5m + Soccer Only | Multi-Bot | Per-Bot Dashboard

## Quick Start (3 SIM bots)
```bash
docker compose --profile sim up -d --build
```

## Ports
| Service       | URL                      |
|---------------|--------------------------|
| Main Dashboard| http://SERVER:3000       |
| SIM 1         | http://SERVER:3101       |
| SIM 2         | http://SERVER:3102       |
| SIM 3         | http://SERVER:3103       |
| REAL 1        | http://SERVER:3201       |
| REAL 2        | http://SERVER:3202       |

## Run Commands
```bash
docker compose --profile sim up -d --build    # all 3 sim bots
docker compose up sim1-api sim1-ui main-ui -d # only sim1
docker compose --profile real1 up -d --build  # real bot 1
docker compose --profile real up -d --build   # both real bots
docker compose down                           # stop all
docker compose logs -f sim1-api               # view logs
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

import { useState } from "react"
import { useBot, useDbSummary } from "./hooks/useBot.js"

const u2  = n => n == null ? "—" : `$${Number(n).toFixed(2)}`
const p1  = n => n == null ? "—" : `${Number(n).toFixed(1)}%`
const sgn = n => { const v = Number(n); return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}` }

const Dot  = ({ on }) => <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: on ? "var(--green)" : "var(--red)", boxShadow: on ? "0 0 4px var(--green)" : "none", animation: on ? "pulse 2s infinite" : "none", marginRight: 4 }}/>
const Chip = ({ t, c = "#444" }) => <span style={{ fontSize: 8, fontFamily: "var(--mono)", padding: "0 4px", border: `1px solid ${c}44`, background: `${c}15`, color: c, borderRadius: 2, whiteSpace: "nowrap" }}>{t}</span>
const Bar  = ({ pct, c = "#fff", h = 2 }) => <div style={{ height: h, background: "#1a1a1a", borderRadius: 1, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, Math.max(0, pct || 0))}%`, background: c, transition: "width .5s" }}/></div>

const BOTS = [
  { prefix: "sim1",  label: "Koceng",  mode: "sim",  port: 3101 },
  { prefix: "sim2",  label: "Wedos",   mode: "sim",  port: 3102 },
  { prefix: "real1", label: "REAL 1",  mode: "real", port: 3201 },
  { prefix: "real2", label: "REAL 2",  mode: "real", port: 3202 },
]

// ─── BOT CARD (redesigned) ────────────────────────────────────
function BotCard({ prefix, label, mode, port }) {
  const { stats, btc5m, balance, conn, start, stop, resumeGas } = useBot(prefix)
  const pnl    = stats?.pnl ?? 0
  const isPos  = pnl >= 0
  const gas    = stats?.gas
  const isReal = mode === "real"
  const dc     = btc5m?.predicted_dir === "UP" ? "var(--green)" : btc5m?.predicted_dir === "DOWN" ? "var(--red)" : "var(--dim)"

  // Card border glow: real=amber, sim running=green, stopped=gray
  const borderColor = isReal
    ? "rgba(255,170,0,.35)"
    : stats?.running
      ? "rgba(0,255,127,.18)"
      : "rgba(255,255,255,.06)"

  const cbOk = stats?.circuit_breakers
    ? (stats.circuit_breakers.balance_floor_ok !== false &&
       stats.circuit_breakers.daily_loss_ok !== false &&
       stats.circuit_breakers.gas_ok !== false)
    : true
  const cbColor = !cbOk ? "var(--red)" : gas?.status === "low" ? "var(--amber)" : "var(--green)"

  const balFresh = balance?.last_refresh
    ? (Date.now() - new Date(balance.last_refresh).getTime()) < 5 * 60 * 1000
    : false

  return (
    <div style={{
      background: "rgba(255,255,255,0.025)",
      backdropFilter: "blur(8px)",
      border: `1px solid ${borderColor}`,
      borderRadius: 6,
      overflow: "hidden",
      transition: "box-shadow .2s",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "rgba(0,0,0,.4)", borderBottom: `1px solid ${borderColor}` }}>
        <Dot on={conn}/>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, color: "var(--white)", letterSpacing: ".04em" }}>{label}</span>
        <Chip t={mode.toUpperCase()} c={isReal ? "var(--amber)" : "#444"}/>
        {stats && <Chip t={stats.running ? "RUN" : "STOP"} c={stats.running ? "var(--green)" : "var(--red)"}/>}
        {gas?.paused && <Chip t="GAS STOP" c="var(--red)"/>}
        {btc5m?.in_entry_zone && <Chip t="ZONE" c="var(--amber)"/>}
        <Chip t={`CB ${cbOk ? "OK" : "HALT"}`} c={cbColor}/>
        <a href={`http://${window.location.hostname}:${port}`} target="_blank"
          style={{ marginLeft: "auto", fontSize: 8, fontFamily: "var(--mono)", color: "var(--dim)", textDecoration: "none", border: "1px solid #222", padding: "1px 6px", borderRadius: 2 }}>
          OPEN
        </a>
      </div>

      {/* Live balance row (Sprint 1) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", borderBottom: `1px solid ${borderColor}`, padding: "3px 10px", background: "rgba(0,0,0,.2)", gap: 4 }}>
        <div>
          <div style={{ fontSize: 7, color: "var(--dim2)", fontFamily: "var(--mono)", textTransform: "uppercase" }}>USDC</div>
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: balFresh ? "var(--green)" : "var(--dim2)", display: "inline-block" }}/>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, color: "var(--white)" }}>
              {balance ? `$${Number(balance.usdc || stats?.available || 0).toFixed(2)}` : u2(stats?.available)}
            </span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 7, color: "var(--dim2)", fontFamily: "var(--mono)", textTransform: "uppercase" }}>POL</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, color: "var(--dim)" }}>
            {balance ? Number(balance.pol || 0).toFixed(2) : (gas?.pol_left || "—")}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 7, color: "var(--dim2)", fontFamily: "var(--mono)", textTransform: "uppercase" }}>BTC DIR</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, color: dc }}>
            {btc5m?.predicted_dir ? (btc5m.predicted_dir === "UP" ? "↑ UP" : "↓ DN") : (btc5m?.signal_ready ? "WEAK" : "—")}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 7, color: "var(--dim2)", fontFamily: "var(--mono)", textTransform: "uppercase" }}>CONF</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, color: btc5m?.confidence >= .7 ? "var(--green)" : btc5m?.confidence >= .4 ? "var(--amber)" : "var(--dim)" }}>
            {btc5m?.signal_ready ? `${((btc5m.confidence || 0) * 100).toFixed(0)}%` : "—"}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", borderBottom: `1px solid ${borderColor}` }}>
        {[
          ["EQUITY", u2(stats?.capital),                    isPos ? "var(--green)" : "var(--red)"],
          ["P&L",    sgn(pnl),                              isPos ? "var(--green)" : "var(--red)"],
          ["WIN",    p1(stats?.win_rate),                   stats?.win_rate >= 60 ? "var(--green)" : stats?.win_rate >= 45 ? "var(--amber)" : "var(--red)"],
          ["W/L",    `${Math.floor(stats?.wins ?? 0)}/${Math.floor(stats?.losses ?? 0)}`, "#aaa"],
          ["BET",    `$${Math.floor(stats?.compound_bet ?? 1)}`,                          "var(--white)"],
        ].map(([l, v, c]) => (
          <div key={l} style={{ padding: "3px 6px", borderRight: `1px solid ${borderColor}` }}>
            <div style={{ fontSize: 7, color: "var(--dim2)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: ".05em" }}>{l}</div>
            <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "var(--mono)", color: c || "var(--white)", whiteSpace: "nowrap" }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Progress bars */}
      <div style={{ padding: "4px 10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, borderBottom: `1px solid ${borderColor}` }}>
        <div>
          <div style={{ fontSize: 7, color: "var(--dim2)", fontFamily: "var(--mono)", marginBottom: 1 }}>COMPOUND ${stats?.compound_bet ?? 1}/bet</div>
          <Bar pct={stats?.compound_prog ?? 0} c="var(--white)" h={2}/>
          <div style={{ fontSize: 7, color: "var(--dim2)", fontFamily: "var(--mono)", marginTop: 1 }}>→${stats?.compound_next ?? 10}</div>
        </div>
        <div>
          <div style={{ fontSize: 7, color: "var(--dim2)", fontFamily: "var(--mono)", marginBottom: 1 }}>GAS {gas?.orders_left != null ? Math.floor(gas.orders_left) : "—"} orders</div>
          <Bar pct={Math.min(100, ((gas?.pol_used || 0) / (gas?.pol_total || 11)) * 100)} c={gas?.status === "critical" ? "var(--red)" : gas?.status === "low" ? "var(--amber)" : "var(--white)"} h={2}/>
          <div style={{ fontSize: 7, color: "var(--dim2)", fontFamily: "var(--mono)", marginTop: 1 }}>{(gas?.pol_left || 0).toFixed(2)} POL</div>
        </div>
      </div>

      {/* Daily summary + actions */}
      <div style={{ padding: "3px 10px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 7, color: "var(--dim2)", fontFamily: "var(--mono)" }}>
          Daily:{" "}
          <span style={{ color: (stats?.daily_pnl ?? 0) >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
            {sgn(stats?.daily_pnl ?? 0)}
          </span>
        </span>
        <span style={{ fontSize: 7, color: "var(--dim2)", fontFamily: "var(--mono)" }}>
          Trades: <span style={{ color: "var(--white)" }}>{Math.floor(stats?.total_trades ?? 0)}</span>
        </span>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {isReal && (stats?.running
            ? <button onClick={stop} style={{ padding: "1px 8px", background: "rgba(255,34,68,.12)", border: "1px solid var(--red)", color: "var(--red)", borderRadius: 3, fontSize: 8, fontFamily: "var(--mono)", cursor: "pointer" }}>■ STOP</button>
            : <button onClick={start} style={{ padding: "1px 8px", background: "rgba(0,255,127,.12)", border: "1px solid var(--green)", color: "var(--green)", borderRadius: 3, fontSize: 8, fontFamily: "var(--mono)", cursor: "pointer" }}>▶ RUN</button>
          )}
          {gas?.paused && <button onClick={resumeGas} style={{ padding: "1px 8px", background: "transparent", border: "1px solid var(--amber)", color: "var(--amber)", borderRadius: 3, fontSize: 8, fontFamily: "var(--mono)", cursor: "pointer" }}>RESUME GAS</button>}
          <span style={{ fontSize: 7, color: "var(--dim2)", fontFamily: "var(--mono)", alignSelf: "center" }}>
            {stats?.scan_count != null ? Math.floor(stats.scan_count).toLocaleString() : "—"} scans
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── DB SUMMARY TABLE (with sortable columns) ─────────────────
function DbTable({ summary, sort, sortKey, sortAsc }) {
  const SortHeader = ({ k, label }) => (
    <th
      onClick={() => sort(k)}
      style={{ padding: "3px 8px", fontSize: 8, fontFamily: "var(--mono)", color: sortKey === k ? "var(--white)" : "var(--dim2)", textTransform: "uppercase", letterSpacing: ".05em", borderBottom: "1px solid var(--border)", textAlign: "left", background: "rgba(0,0,0,.3)", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}>
      {label} {sortKey === k ? (sortAsc ? "↑" : "↓") : ""}
    </th>
  )
  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 6, overflow: "hidden" }}>
      <div style={{ padding: "4px 10px", background: "rgba(0,0,0,.3)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 9, color: "var(--dim)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: ".07em" }}>Cross-Bot DB Summary</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <SortHeader k="bot_id"    label="Bot"/>
            <SortHeader k="total"     label="Trades"/>
            <SortHeader k="wins"      label="Wins"/>
            <SortHeader k="total_pnl" label="Total PnL"/>
            <SortHeader k="avg_pnl"   label="Avg PnL"/>
            <th style={{ padding: "3px 8px", fontSize: 8, fontFamily: "var(--mono)", color: "var(--dim2)", textTransform: "uppercase", letterSpacing: ".05em", borderBottom: "1px solid var(--border)", textAlign: "left", background: "rgba(0,0,0,.3)", whiteSpace: "nowrap" }}>Win Rate</th>
            <th style={{ padding: "3px 8px", fontSize: 8, fontFamily: "var(--mono)", color: "var(--dim2)", textTransform: "uppercase", letterSpacing: ".05em", borderBottom: "1px solid var(--border)", textAlign: "left", background: "rgba(0,0,0,.3)", whiteSpace: "nowrap" }}>Last Trade</th>
          </tr></thead>
          <tbody>
            {summary.length === 0 && <tr><td colSpan={7} style={{ padding: "10px", textAlign: "center", color: "var(--dim)", fontSize: 8, fontFamily: "var(--mono)" }}>no data yet</td></tr>}
            {summary.map((b, i) => {
              const wr = b.total > 0 ? (b.wins / b.total * 100) : 0
              const mode = b.bot_id?.startsWith("real") ? "real" : "sim"
              return (
                <tr key={b.bot_id} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.008)" }}>
                  <td style={{ padding: "3px 8px", fontFamily: "var(--mono)", fontSize: 9 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ color: mode === "real" ? "var(--amber)" : "var(--white)" }}>{b.bot_id}</span>
                      <Chip t={mode.toUpperCase()} c={mode === "real" ? "var(--amber)" : "#444"}/>
                    </div>
                  </td>
                  <td style={{ padding: "3px 8px", fontFamily: "var(--mono)", fontSize: 9, color: "#aaa" }}>{Math.floor(b.total)}</td>
                  <td style={{ padding: "3px 8px", fontFamily: "var(--mono)", fontSize: 9, color: "#aaa" }}>{Math.floor(b.wins)}</td>
                  <td style={{ padding: "3px 8px", fontFamily: "var(--mono)", fontSize: 9, fontWeight: 700, color: Number(b.total_pnl) >= 0 ? "var(--green)" : "var(--red)" }}>
                    {Number(b.total_pnl) >= 0 ? "+" : ""}${Number(b.total_pnl || 0).toFixed(3)}
                  </td>
                  <td style={{ padding: "3px 8px", fontFamily: "var(--mono)", fontSize: 9, color: Number(b.avg_pnl) >= 0 ? "var(--green)" : "var(--red)" }}>
                    {Number(b.avg_pnl) >= 0 ? "+" : ""}${Number(b.avg_pnl || 0).toFixed(3)}
                  </td>
                  <td style={{ padding: "3px 8px", minWidth: 80 }}>
                    <div style={{ fontSize: 8, fontFamily: "var(--mono)", color: wr >= 60 ? "var(--green)" : wr >= 45 ? "var(--amber)" : "var(--red)", marginBottom: 1 }}>{wr.toFixed(1)}%</div>
                    <Bar pct={wr} c={wr >= 60 ? "var(--green)" : wr >= 45 ? "var(--amber)" : "var(--red)"} h={2}/>
                  </td>
                  <td style={{ padding: "3px 8px", fontFamily: "var(--mono)", fontSize: 8, color: "var(--dim)" }}>{b.last_trade?.slice(11, 19) || "—"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── CIRCUIT BREAKER SUMMARY ROW ─────────────────────────────
function CircuitBreakerRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", background: "rgba(0,0,0,.3)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 4, fontSize: 8, fontFamily: "var(--mono)" }}>
      <span style={{ color: "var(--dim2)", textTransform: "uppercase", letterSpacing: ".07em" }}>Circuit Breakers:</span>
      {BOTS.map(b => <BotCbStatus key={b.prefix} prefix={b.prefix} label={b.prefix}/>)}
    </div>
  )
}

function BotCbStatus({ prefix, label }) {
  const { stats } = useBot(prefix)
  const cb  = stats?.circuit_breakers
  const gas = stats?.gas
  if (!stats) return <span style={{ color: "var(--dim2)" }}>{label} ···</span>
  const ok    = !cb || (cb.balance_floor_ok !== false && cb.daily_loss_ok !== false && cb.gas_ok !== false)
  const warn  = gas?.status === "low"
  const color = !ok ? "var(--red)" : warn ? "var(--amber)" : "var(--green)"
  const icon  = !ok ? "✗" : warn ? "⚠" : "✓"
  const detail = !ok
    ? (!cb?.balance_floor_ok ? "FLOOR" : !cb?.daily_loss_ok ? "DAILY" : "GAS")
    : warn ? "LOW GAS" : ""
  return (
    <span style={{ color }}>
      {icon} {label}{detail ? ` ${detail}` : ""}
    </span>
  )
}

// ─── PORT MAP TILES ───────────────────────────────────────────
function PortTiles() {
  const tiles = [
    { label: "Main Dashboard", url: `http://${window.location.hostname}:3000`, mode: "—"    },
    { label: "SIM 1 (Koceng)", url: `http://${window.location.hostname}:3101`, mode: "sim"  },
    { label: "SIM 2 (Wedos)",  url: `http://${window.location.hostname}:3102`, mode: "sim"  },
    { label: "REAL 1",         url: `http://${window.location.hostname}:3201`, mode: "real" },
    { label: "REAL 2",         url: `http://${window.location.hostname}:3202`, mode: "real" },
  ]
  return (
    <div style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 6, overflow: "hidden" }}>
      <div style={{ padding: "4px 10px", background: "rgba(0,0,0,.3)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 9, color: "var(--dim)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: ".07em" }}>Port Map</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 1, background: "var(--border)" }}>
        {tiles.map(({ label, url, mode }) => (
          <a
            key={label} href={url} target="_blank"
            style={{ display: "flex", flexDirection: "column", gap: 3, padding: "8px 12px", background: "var(--black)", textDecoration: "none", transition: "background .15s" }}
            onMouseEnter={e => e.currentTarget.style.background = "#111"}
            onMouseLeave={e => e.currentTarget.style.background = "var(--black)"}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: mode === "real" ? "var(--amber)" : "var(--white)", fontWeight: 700 }}>{label}</span>
              {mode !== "—" && <span style={{ fontSize: 7, fontFamily: "var(--mono)", padding: "0 3px", background: mode === "real" ? "rgba(255,170,0,.15)" : "rgba(255,255,255,.05)", color: mode === "real" ? "var(--amber)" : "#666", borderRadius: 2 }}>{mode.toUpperCase()}</span>}
            </div>
            <span style={{ fontFamily: "var(--mono)", fontSize: 8, color: "var(--blue)" }}>{url.replace("http://", "")}</span>
          </a>
        ))}
      </div>
    </div>
  )
}

// ─── MAIN APP ─────────────────────────────────────────────────
export default function App() {
  const { summary, sort, sortKey, sortAsc } = useDbSummary()
  const combined = summary.reduce((a, b) => ({
    total:     a.total + (b.total || 0),
    wins:      a.wins  + (b.wins  || 0),
    total_pnl: a.total_pnl + Number(b.total_pnl || 0),
  }), { total: 0, wins: 0, total_pnl: 0 })

  const runningBots = BOTS.length  // will be dynamic once per-card state bubbles up

  return (
    <div style={{ minHeight: "100vh", background: "var(--black)", display: "flex", flexDirection: "column", overflowY: "auto" }}>

      {/* Sticky header */}
      <div style={{ height: 32, background: "rgba(0,0,0,.9)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,.07)", display: "flex", alignItems: "center", padding: "0 12px", gap: 12, flexShrink: 0, position: "sticky", top: 0, zIndex: 10 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, color: "var(--white)", letterSpacing: ".08em" }}>
          POLY<span style={{ color: "var(--dim)" }}>BOT</span>
          <span style={{ fontSize: 9, color: "var(--dim)", marginLeft: 4 }}>MAIN</span>
        </span>
        <div style={{ width: 1, height: 16, background: "rgba(255,255,255,.1)" }}/>
        <span style={{ fontSize: 9, fontFamily: "var(--mono)", color: "var(--dim)" }}>{BOTS.length} bots</span>
        <div style={{ display: "flex", gap: 16, marginLeft: "auto", fontSize: 9, fontFamily: "var(--mono)" }}>
          <span style={{ color: "var(--dim)" }}>
            Trades: <span style={{ color: "var(--white)", fontWeight: 700 }}>{combined.total}</span>
          </span>
          <span style={{ color: "var(--dim)" }}>
            Win Rate:{" "}
            <span style={{ color: combined.wins / Math.max(combined.total, 1) >= .6 ? "var(--green)" : combined.wins / Math.max(combined.total, 1) >= .45 ? "var(--amber)" : "var(--red)", fontWeight: 700 }}>
              {combined.total > 0 ? (combined.wins / combined.total * 100).toFixed(1) : "0"}%
            </span>
          </span>
          <span style={{ color: "var(--dim)" }}>
            PnL:{" "}
            <span style={{ color: combined.total_pnl >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
              {combined.total_pnl >= 0 ? "+" : ""}${combined.total_pnl.toFixed(2)}
            </span>
          </span>
        </div>
      </div>

      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Circuit breaker summary row */}
        <CircuitBreakerRow/>

        {/* Bot cards grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 10 }}>
          {BOTS.map(b => <BotCard key={b.prefix} {...b}/>)}
        </div>

        {/* DB summary */}
        <DbTable summary={summary} sort={sort} sortKey={sortKey} sortAsc={sortAsc}/>

        {/* Port map */}
        <PortTiles/>
      </div>
    </div>
  )
}

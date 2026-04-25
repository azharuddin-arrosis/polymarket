import { useState } from "react"
import { useBot, useDbSummary } from "./hooks/useBot.js"

const u2  = n => n==null?"—":"$${Number(n).toFixed(2)}"
const p1  = n => n==null?"—":"${Number(n).toFixed(1)}%"
const sgn = n => { const v=Number(n); return "${v>=0?"+":"-"}$${Math.abs(v).toFixed(2)}" }

const Dot  = ({on}) => <span style={{display:"inline-block",width:5,height:5,borderRadius:"50%",background:on?"var(--green)":"var(--red)",boxShadow:on?"0 0 4px var(--green)":"none",animation:on?"pulse 2s infinite":"none",marginRight:4}}/>
const Chip = ({t,c="#444"}) => <span style={{fontSize:8,fontFamily:"var(--mono)",padding:"0 4px",border:`1px solid ${c}44`,background:`${c}15`,color:c,borderRadius:2,whiteSpace:"nowrap"}}>{t}</span>
const Bar  = ({pct,c="#fff",h=2}) => <div style={{height:h,background:"#1a1a1a",borderRadius:1,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(100,Math.max(0,pct||0))}%`,background:c,transition:"width .5s"}}/></div>

const BOTS = [
  {prefix:"sim1", label:"Koceng", mode:"sim", port:3101},
  {prefix:"sim2", label:"Wedos", mode:"sim", port:3102},
  {prefix:"real1",label:"REAL 1",mode:"real",port:3201},
  {prefix:"real2",label:"REAL 2",mode:"real",port:3202},
]

function BotCard({prefix,label,mode,port}) {
  const {stats,btc5m,conn,start,stop,resumeGas} = useBot(prefix)
  const pnl   = stats?.pnl ?? 0
  const isPos = pnl >= 0
  const gas   = stats?.gas
  const isReal= mode === "real"
  const dc    = btc5m?.predicted_dir==="UP"?"var(--green)":btc5m?.predicted_dir==="DOWN"?"var(--red)":"var(--dim)"

  return(
    <div style={{background:"#080808",border:`1px solid ${isReal?"rgba(255,170,0,.3)":"var(--border)"}`,borderRadius:4,overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"3px 8px",background:"#0f0f0f",borderBottom:"1px solid var(--border)"}}>
        <Dot on={conn}/>
        <span style={{fontFamily:"var(--mono)",fontSize:10,fontWeight:700,color:"var(--white)"}}>{label}</span>
        <Chip t={mode.toUpperCase()} c={isReal?"var(--amber)":"#444"}/>
        {stats&&<Chip t={stats.running?"RUN":"STOP"} c={stats.running?"var(--green)":"var(--red)"}/>}
        {gas?.paused&&<Chip t="GAS STOP" c="var(--red)"/>}
        {btc5m?.in_entry_zone&&<Chip t="⚡ZONE" c="var(--amber)"/>}
        {btc5m?.predicted_dir&&<Chip t={`BTC ${btc5m.predicted_dir} ${btc5m.confidence?(btc5m.confidence*100).toFixed(0)+"%":""}`} c={dc}/>}
        <a href={`http://${window.location.hostname}:${port}`} target="_blank"
          style={{marginLeft:"auto",fontSize:8,fontFamily:"var(--mono)",color:"#444",textDecoration:"none",border:"1px solid #222",padding:"0 5px",borderRadius:2}}>
          OPEN ↗
        </a>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",borderBottom:"1px solid var(--border)"}}>
        {[
          ["EQUITY",u2(stats?.capital),isPos?"var(--green)":"var(--red)"],
          ["P&L",sgn(pnl),isPos?"var(--green)":"var(--red)"],
          ["WIN",p1(stats?.win_rate),stats?.win_rate>=60?"var(--green)":stats?.win_rate>=45?"var(--amber)":"var(--red)"],
          ["W/L",`${Math.floor(stats?.wins??0)}/${Math.floor(stats?.losses??0)}`,"#aaa"],
          ["BET",`$${Math.floor(stats?.compound_bet??1)}`,"var(--white)"],
        ].map(([l,v,c])=>(
          <div key={l} style={{padding:"2px 6px",borderRight:"1px solid var(--border)"}}>
            <div style={{fontSize:7,color:"var(--dim2)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".05em"}}>{l}</div>
            <div style={{fontSize:10,fontWeight:700,fontFamily:"var(--mono)",color:c||"var(--white)",whiteSpace:"nowrap"}}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{padding:"3px 8px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,borderBottom:"1px solid var(--border)"}}>
        <div>
          <div style={{fontSize:7,color:"var(--dim2)",fontFamily:"var(--mono)",marginBottom:1}}>COMPOUND ${stats?.compound_bet??1}/bet</div>
          <Bar pct={stats?.compound_prog??0} c="var(--white)" h={2}/>
          <div style={{fontSize:7,color:"var(--dim2)",fontFamily:"var(--mono)",marginTop:1}}>→${stats?.compound_next??10}</div>
        </div>
        <div>
          <div style={{fontSize:7,color:"var(--dim2)",fontFamily:"var(--mono)",marginBottom:1}}>GAS {gas?.orders_left!=null?Math.floor(gas.orders_left):"—"} orders</div>
          <Bar pct={Math.min(100,((gas?.pol_used||0)/(gas?.pol_total||11))*100)} c={gas?.status==="critical"?"var(--red)":gas?.status==="low"?"var(--amber)":"var(--white)"} h={2}/>
          <div style={{fontSize:7,color:"var(--dim2)",fontFamily:"var(--mono)",marginTop:1}}>{(gas?.pol_left||0).toFixed(2)} POL</div>
        </div>
      </div>

      <div style={{display:"flex",gap:4,padding:"3px 8px"}}>
        {isReal&&(stats?.running
          ?<button onClick={stop} style={{padding:"1px 6px",background:"transparent",border:"1px solid var(--red)",color:"var(--red)",borderRadius:2,fontSize:8,fontFamily:"var(--mono)",cursor:"pointer"}}>■ STOP</button>
          :<button onClick={start} style={{padding:"1px 6px",background:"transparent",border:"1px solid var(--green)",color:"var(--green)",borderRadius:2,fontSize:8,fontFamily:"var(--mono)",cursor:"pointer"}}>▶ RUN</button>
        )}
        {gas?.paused&&<button onClick={resumeGas} style={{padding:"1px 6px",background:"transparent",border:"1px solid var(--amber)",color:"var(--amber)",borderRadius:2,fontSize:8,fontFamily:"var(--mono)",cursor:"pointer"}}>RESUME GAS</button>}
        <span style={{marginLeft:"auto",fontSize:7,color:"var(--dim2)",fontFamily:"var(--mono)",alignSelf:"center"}}>scans:{stats?.scan_count!=null?Math.floor(stats.scan_count).toLocaleString():"—"}</span>
      </div>
    </div>
  )
}

function DbTable({summary}) {
  return(
    <div style={{background:"#080808",border:"1px solid var(--border)",borderRadius:4,overflow:"hidden"}}>
      <div style={{padding:"3px 8px",background:"#0f0f0f",borderBottom:"1px solid var(--border)"}}>
        <span style={{fontSize:9,color:"var(--dim)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".07em"}}>Cross-Bot DB Summary</span>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr>{["Bot","Trades","Wins","Total PnL","Avg PnL","Last Trade"].map(h=>(
            <th key={h} style={{padding:"2px 8px",fontSize:8,fontFamily:"var(--mono)",color:"var(--dim2)",textTransform:"uppercase",letterSpacing:".05em",borderBottom:"1px solid var(--border)",textAlign:"left",background:"var(--bg3)",whiteSpace:"nowrap"}}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {summary.length===0&&<tr><td colSpan={6} style={{padding:"8px",textAlign:"center",color:"var(--dim)",fontSize:8,fontFamily:"var(--mono)"}}>no data yet</td></tr>}
            {summary.map((b,i)=>{
              const wr=b.total>0?(b.wins/b.total*100).toFixed(1):"0"
              return(
                <tr key={b.bot_id} style={{borderBottom:"1px solid var(--border)",background:i%2===0?"transparent":"rgba(255,255,255,.008)"}}>
                  <td style={{padding:"2px 8px",fontFamily:"var(--mono)",fontSize:9,color:"var(--white)"}}>{b.bot_id}</td>
                  <td style={{padding:"2px 8px",fontFamily:"var(--mono)",fontSize:9,color:"#aaa"}}>{Math.floor(b.total)}</td>
                  <td style={{padding:"2px 8px",fontFamily:"var(--mono)",fontSize:9,color:"#aaa"}}>{Math.floor(b.wins)} ({wr}%)</td>
                  <td style={{padding:"2px 8px",fontFamily:"var(--mono)",fontSize:9,fontWeight:700,color:Number(b.total_pnl)>=0?"var(--green)":"var(--red)"}}>{Number(b.total_pnl)>=0?"+":""}${Number(b.total_pnl||0).toFixed(3)}</td>
                  <td style={{padding:"2px 8px",fontFamily:"var(--mono)",fontSize:9,color:Number(b.avg_pnl)>=0?"var(--green)":"var(--red)"}}>{Number(b.avg_pnl)>=0?"+":""}${Number(b.avg_pnl||0).toFixed(3)}</td>
                  <td style={{padding:"2px 8px",fontFamily:"var(--mono)",fontSize:8,color:"var(--dim)"}}>{b.last_trade?.slice(11,19)||"—"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function App() {
  const summary = useDbSummary()
  const combined = summary.reduce((a,b)=>({
    total:a.total+(b.total||0), wins:a.wins+(b.wins||0),
    total_pnl:a.total_pnl+Number(b.total_pnl||0)
  }),{total:0,wins:0,total_pnl:0})

  return(
    <div style={{height:"100vh",background:"var(--black)",display:"flex",flexDirection:"column",overflow:"hidden",overflowY:"auto"}}>
      <div style={{height:28,background:"var(--bg1)",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",padding:"0 10px",gap:10,flexShrink:0,position:"sticky",top:0,zIndex:10}}>
        <span style={{fontFamily:"var(--mono)",fontSize:12,fontWeight:700,color:"var(--white)",letterSpacing:".08em"}}>POLY<span style={{color:"var(--dim)"}}>BOT</span><span style={{fontSize:9,color:"var(--dim)",marginLeft:4}}>MAIN</span></span>
        <div style={{width:1,height:14,background:"var(--border)"}}/>
        <span style={{fontSize:9,fontFamily:"var(--mono)",color:"var(--dim)"}}>{BOTS.length} bots configured</span>
        <div style={{display:"flex",gap:12,marginLeft:"auto",fontSize:9,fontFamily:"var(--mono)"}}>
          <span style={{color:"var(--dim)"}}>Total Trades: <span style={{color:"var(--white)"}}>{combined.total}</span></span>
          <span style={{color:"var(--dim)"}}>Win Rate: <span style={{color:combined.wins/Math.max(combined.total,1)>=.6?"var(--green)":combined.wins/Math.max(combined.total,1)>=.45?"var(--amber)":"var(--red)"}}>{combined.total>0?(combined.wins/combined.total*100).toFixed(1):"0"}%</span></span>
          <span style={{color:"var(--dim)"}}>PnL: <span style={{color:combined.total_pnl>=0?"var(--green)":"var(--red)"}}>{combined.total_pnl>=0?"+":""}${combined.total_pnl.toFixed(2)}</span></span>
        </div>
      </div>

      <div style={{padding:"10px",display:"flex",flexDirection:"column",gap:8}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:8}}>
          {BOTS.map(b=><BotCard key={b.prefix} {...b}/>)}
        </div>
        <DbTable summary={summary}/>
        <div style={{background:"#080808",border:"1px solid var(--border)",borderRadius:4,padding:"8px 10px"}}>
          <div style={{fontSize:8,color:"var(--dim)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Port Map</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:4,fontSize:8,fontFamily:"var(--mono)",color:"var(--dim)"}}>
            {[
              ["Main Dashboard","localhost:3000","--"],
              ["SIM 1","localhost:3101","sim1"],
              ["SIM 2","localhost:3102","sim2"],
              ["REAL 1","localhost:3201","real1"],
              ["REAL 2","localhost:3202","real2"],
            ].map(([l,url,prefix])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"2px 0",borderBottom:"1px solid var(--border)"}}>
                <span style={{color:l.includes("REAL")?"var(--amber)":"var(--white)"}}>{l}</span>
                <a href={`http://${window.location.hostname.replace("localhost",window.location.hostname)}:${url.split(":")[1]}`}
                  target="_blank" style={{color:"var(--blue)",textDecoration:"none"}}>{url}</a>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

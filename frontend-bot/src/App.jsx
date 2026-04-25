import { useState, useEffect, useMemo } from 'react'
import { useBot } from './hooks/useBot.js'

const u2  = n => n==null?'—':`\$${Number(n).toFixed(2)}`
const u3  = n => n==null?'—':`\$${Number(n).toFixed(3)}`
const p1  = n => n==null?'—':`${Number(n).toFixed(1)}%`
const sgn = n => { const v=Number(n); return `${v>=0?'+':'-'}\$${Math.abs(v).toFixed(2)}` }
const dur = s => { if(!s||s<=0)return'—'; if(s<60)return`${Math.round(s)}s`; if(s<3600)return`${Math.round(s/60)}m`; return`${(s/3600).toFixed(1)}h` }
const vol = v => { if(!v)return'—'; if(v>=1e6)return`\$${(v/1e6).toFixed(1)}M`; if(v>=1e3)return`\$${(v/1e3).toFixed(0)}K`; return`\$${v.toFixed(0)}` }

const Dot  = ({on}) => <span style={{display:'inline-block',width:5,height:5,borderRadius:'50%',background:on?'var(--green)':'var(--red)',boxShadow:on?'0 0 4px var(--green)':'none',animation:on?'pulse 2s infinite':'none',marginRight:4}}/>
const Chip = ({t,c='#444'}) => <span style={{fontSize:8,fontFamily:'var(--mono)',padding:'0 4px',border:`1px solid ${c}44`,background:`${c}15`,color:c,borderRadius:2,whiteSpace:'nowrap'}}>{t}</span>
const Bar  = ({pct,c='#fff',h=2}) => <div style={{height:h,background:'#1a1a1a',borderRadius:1,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(100,Math.max(0,pct||0))}%`,background:c,transition:'width .5s'}}/></div>
const SH   = ({t,r}) => <div style={{display:'flex',justifyContent:'space-between',padding:'2px 6px',background:'var(--bg2)',borderBottom:'1px solid var(--border)',flexShrink:0}}><span style={{fontSize:8,color:'var(--dim)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.07em'}}>{t}</span>{r&&<span style={{fontSize:8,color:'var(--dim)',fontFamily:'var(--mono)'}}>{r}</span>}</div>
const SC   = ({l,v,c}) => <div style={{padding:'2px 8px',borderRight:'1px solid var(--border)',flexShrink:0}}><div style={{fontSize:7,color:'var(--dim2)',fontFamily:'var(--mono)',textTransform:'uppercase',letterSpacing:'.05em'}}>{l}</div><div style={{fontSize:11,fontWeight:700,fontFamily:'var(--mono)',color:c||'var(--white)',whiteSpace:'nowrap'}}>{v}</div></div>

function Spark({hist,h=30}) {
  if(hist.length<2) return <div style={{height:h,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--dim)',fontSize:8,fontFamily:'var(--mono)'}}>no data</div>
  const vals=hist.map(x=>x.v),mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||.001
  const W=300,p=2
  const pts=hist.map((x,i)=>`${p+(i/(hist.length-1))*(W-2*p)},${h-p-((x.v-mn)/rng)*(h-2*p)}`).join(' ')
  const c=vals[vals.length-1]>=0?'var(--green)':'var(--red)'
  return <svg width="100%" height={h} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round"/></svg>
}
function usePnlHist(cap,init) {
  const [h,setH]=useState([{t:0,v:0}])
  useEffect(()=>{ if(cap==null)return; setH(p=>[...p,{t:p.length,v:Number((cap-(init||10)).toFixed(4))}].slice(-100)) },[cap])
  return h
}

function PosRow({p}) {
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{ const id=setInterval(()=>setNow(Date.now()),1000); return()=>clearInterval(id) },[])
  const el=(now-new Date(p.opened_at).getTime())/1000
  const rm=Math.max(0,(p.resolve_sec||86400)-el)
  const pr=Math.min(100,(el/(p.resolve_sec||86400))*100)
  const c=rm<60?'var(--red)':rm<300?'var(--amber)':'var(--dim)'
  const catC=p.category==='btc5m'?'#ff66ff':'var(--green)'
  return(
    <tr className="tr" style={{borderBottom:'1px solid var(--border)',animation:'fadeIn .2s'}}>
      <td className="td" style={{fontFamily:'var(--mono)',fontSize:8,color:'var(--dim2)'}}>{p.id}</td>
      <td className="td" style={{color:'var(--white)'}} title={p.question}>{p.question}</td>
      <td className="td"><Chip t={p.category==='btc5m'?'BTC5M':'SOCCER'} c={catC}/></td>
      <td className="td"><Chip t={p.outcome} c={p.outcome==='YES'||p.outcome==='UP'?'var(--green)':'var(--amber)'}/></td>
      <td className="td" style={{fontFamily:'var(--mono)',textAlign:'right',color:'var(--dim)'}}>{p.price?.toFixed(3)}</td>
      <td className="td" style={{fontFamily:'var(--mono)',textAlign:'right',color:'var(--white)'}}>{u2(p.size)}</td>
      <td className="td" style={{fontFamily:'var(--mono)',textAlign:'right',color:p.ev>.10?'var(--green)':p.ev>.05?'var(--amber)':'var(--dim)',fontSize:8}}>{(p.ev*100).toFixed(0)}%</td>
      <td className="td" style={{width:52}}>
        <div style={{fontFamily:'var(--mono)',fontSize:8,color:c,textAlign:'right'}}>{rm<1?'res':dur(rm)}</div>
        <Bar pct={pr} c={c} h={1}/>
      </td>
    </tr>
  )
}

function Btc5mPanel({d}) {
  if(!d) return <div style={{padding:'6px',color:'var(--dim)',fontSize:8,fontFamily:'var(--mono)'}}>connecting to BTC5m…</div>
  const {secs_left,btc_price,win_open,delta_pct,predicted_dir,confidence,score,entry_fired,in_entry_zone,indicators:ind={},klines=[],stats:b5s={}}=d
  const dc=predicted_dir==='UP'?'var(--green)':predicted_dir==='DOWN'?'var(--red)':'var(--dim)'
  const prog=secs_left>0?Math.round((300-secs_left)/300*100):100
  const miniPts=useMemo(()=>{
    if(klines.length<2) return ''
    const cls=klines.map(k=>k.close),mn=Math.min(...cls),mx=Math.max(...cls),rng=mx-mn||1
    return cls.map((c,i)=>`${2+(i/(cls.length-1))*116},${26-2-((c-mn)/rng)*22}`).join(' ')
  },[klines])

  const rows=[
    ['Win Δ', ind.win_delta?`${(ind.win_delta.pct||0)>=0?'+':''}${(ind.win_delta.pct||0).toFixed(4)}%`:'—', (ind.win_delta?.score||0)>0?'var(--green)':(ind.win_delta?.score||0)<0?'var(--red)':'var(--dim)', `s${ind.win_delta?.score??0}`],
    ['MicroMom', ind.micro_mom?`s:${ind.micro_mom.score}`:'—', (ind.micro_mom?.score||0)>0?'var(--green)':(ind.micro_mom?.score||0)<0?'var(--red)':'var(--dim)', ''],
    ['Accel', ind.acceleration?`s:${ind.acceleration.score}`:'—', (ind.acceleration?.score||0)>0?'var(--green)':(ind.acceleration?.score||0)<0?'var(--red)':'var(--dim)', ''],
    ['EMA9/21', ind.ema_9_21?`${(ind.ema_9_21.score||0)>0?'▲BULL':'▼BEAR'}`:'—', (ind.ema_9_21?.score||0)>0?'var(--green)':'var(--red)', `s${ind.ema_9_21?.score??0}`],
    ['RSI14', ind.rsi14?`${(ind.rsi14.rsi||50).toFixed(1)}`:'—', (ind.rsi14?.rsi||50)>65?'var(--red)':(ind.rsi14?.rsi||50)<35?'var(--green)':'var(--dim)', `s${ind.rsi14?.score??0}`],
    ['Volume', ind.volume?`${ind.volume.surge?'SPIKE':'flat'}`:'—', ind.volume?.surge?'var(--amber)':'var(--dim)', `s${ind.volume?.score??0}`],
    ['Ticks', ind.tick_trend?`↑${ind.tick_trend.ups}↓${ind.tick_trend.downs}`:'—', (ind.tick_trend?.score||0)>0?'var(--green)':(ind.tick_trend?.score||0)<0?'var(--red)':'var(--dim)', `s${ind.tick_trend?.score??0}`],
  ]

  return(
    <div style={{padding:'5px 7px'}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:5}}>
        <div>
          <div style={{fontSize:7,color:'var(--dim)'}}>BTC PRICE</div>
          <div style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:700,color:'var(--white)'}}>{btc_price?`\$${btc_price.toLocaleString()}`:'—'}</div>
          {win_open>0&&<div style={{fontFamily:'var(--mono)',fontSize:8,color:(delta_pct||0)>=0?'var(--green)':'var(--red)'}}>Δ {(delta_pct||0)>=0?'+':''}{(delta_pct||0).toFixed(4)}%</div>}
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:7,color:'var(--dim)'}}>WINDOW {in_entry_zone&&<span style={{color:'var(--amber)'}}>⚡</span>}{entry_fired&&<span style={{color:'var(--green)'}}>✓</span>}</div>
          <div style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:700,color:in_entry_zone?'var(--amber)':'var(--dim)'}}>{secs_left??'—'}s</div>
          <div style={{fontSize:7,color:'var(--dim2)'}}>12x/hr · T-30→T-5</div>
        </div>
      </div>

      <Bar pct={prog} c={in_entry_zone?'var(--amber)':predicted_dir?dc:'var(--dim)'} h={3}/>

      <div style={{display:'grid',gridTemplateColumns:'120px 1fr',gap:4,marginTop:5,marginBottom:5,alignItems:'center'}}>
        {miniPts
          ?<svg width="120" height="26" viewBox="0 0 120 26"><polyline points={miniPts} fill="none" stroke="var(--blue)" strokeWidth="1.2" strokeLinejoin="round"/></svg>
          :<div style={{height:26,background:'var(--bg3)',borderRadius:2}}/>
        }
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:3}}>
          <div style={{padding:'3px 4px',textAlign:'center',background:predicted_dir?`${dc}12`:'var(--bg3)',border:`1px solid ${predicted_dir?`${dc}33`:'var(--border)'}`,borderRadius:2}}>
            <div style={{fontSize:7,color:'var(--dim)'}}>PREDICT</div>
            <div style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:dc}}>{predicted_dir||'—'}</div>
          </div>
          <div style={{padding:'3px 4px',textAlign:'center',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:2}}>
            <div style={{fontSize:7,color:'var(--dim)'}}>CONF</div>
            <div style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:confidence>=.7?'var(--green)':confidence>=.4?'var(--amber)':'var(--dim)'}}>{confidence?(confidence*100).toFixed(0)+'%':'—'}</div>
          </div>
        </div>
      </div>

      <div style={{marginBottom:5}}>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:7,color:'var(--dim)',fontFamily:'var(--mono)',marginBottom:2}}>
          <span>◀ DOWN</span><span style={{color:(score||0)>0?'var(--green)':(score||0)<0?'var(--red)':'var(--dim)',fontWeight:700}}>score {score?.toFixed(1)??0}/7</span><span>UP ▶</span>
        </div>
        <div style={{height:4,background:'var(--bg3)',borderRadius:2,overflow:'hidden',position:'relative'}}>
          <div style={{position:'absolute',left:'50%',top:0,width:1,height:'100%',background:'var(--dim2)'}}/>
          {(score||0)>0
            ?<div style={{position:'absolute',left:'50%',width:`${Math.min(50,(score||0)/7*50)}%`,height:'100%',background:'var(--green)',borderRadius:2}}/>
            :<div style={{position:'absolute',right:'50%',width:`${Math.min(50,Math.abs(score||0)/7*50)}%`,height:'100%',background:'var(--red)',borderRadius:2}}/>
          }
        </div>
      </div>

      <table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead><tr>
          <th style={{fontSize:7,color:'var(--dim2)',fontFamily:'var(--mono)',textAlign:'left',padding:'1px 0',borderBottom:'1px solid var(--border)'}}>Indicator</th>
          <th style={{fontSize:7,color:'var(--dim2)',fontFamily:'var(--mono)',textAlign:'right',padding:'1px 0',borderBottom:'1px solid var(--border)'}}>Value</th>
          <th style={{fontSize:7,color:'var(--dim2)',fontFamily:'var(--mono)',textAlign:'right',padding:'1px 0',borderBottom:'1px solid var(--border)'}}>Pts</th>
        </tr></thead>
        <tbody>
          {rows.map(([k,v,c,pts])=>(
            <tr key={k} style={{borderBottom:'1px solid var(--border)'}}>
              <td style={{padding:'1px 0',fontSize:8,fontFamily:'var(--mono)',color:'var(--dim)'}}>{k}</td>
              <td style={{padding:'1px 0',fontSize:8,fontFamily:'var(--mono)',color:c,textAlign:'right'}}>{v}</td>
              <td style={{padding:'1px 0',fontSize:7,fontFamily:'var(--mono)',color:'var(--dim2)',textAlign:'right'}}>{pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontSize:7,fontFamily:'var(--mono)',color:'var(--dim)'}}>
        <span>W:{b5s.wins??0} L:{b5s.losses??0}</span>
        <span>WR:{b5s.total>0?`${((b5s.wins||0)/(b5s.total||1)*100).toFixed(0)}%`:'—'}</span>
        <span style={{color:'var(--dim2)'}}>{d.market_found?'mkt✓':'mkt?'}</span>
      </div>
    </div>
  )
}

function SoccerTable({markets}) {
  const [q,setQ]=useState('')
  const rows=useMemo(()=>{ let r=[...markets]; if(q){const ql=q.toLowerCase();r=r.filter(m=>m.question?.toLowerCase().includes(ql))}; return r },[markets,q])
  const SC_C={arb:'var(--green)',no_bias:'var(--amber)',high_prob:'var(--blue)'}
  return(
    <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden'}}>
      <div style={{display:'flex',gap:4,padding:'2px 6px',borderBottom:'1px solid var(--border)',background:'var(--bg2)',alignItems:'center',flexShrink:0}}>
        <span style={{fontSize:8,color:'var(--dim)',fontFamily:'var(--mono)'}}>{rows.length}</span>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="filter…" style={{flex:1,padding:'1px 4px',fontSize:8,fontFamily:'var(--mono)',background:'var(--bg4)',border:'1px solid var(--border)',borderRadius:2,color:'var(--white)',outline:'none'}}/>
        <span style={{fontSize:8,color:'var(--dim)',fontFamily:'var(--mono)'}}>{rows.filter(r=>r.signal!=='—').length}sig</span>
      </div>
      <div style={{overflowY:'auto',flex:1}}>
        <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
          <colgroup><col style={{width:'auto'}}/><col style={{width:38}}/><col style={{width:42}}/><col style={{width:42}}/><col style={{width:55}}/><col style={{width:38}}/><col style={{width:34}}/></colgroup>
          <thead style={{position:'sticky',top:0}}><tr>{['Match','Res','YES','NO','Signal','Conf','EV'].map(h=><th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {rows.length===0&&<tr><td colSpan={7} style={{padding:'8px',textAlign:'center',color:'var(--dim)',fontSize:8,fontFamily:'var(--mono)'}}>scanning…</td></tr>}
            {rows.map((m,i)=>{
              const hs=m.signal&&m.signal!=='—'; const sc=SC_C[m.signal]||'transparent'
              const rs=m.resolve_sec||0; const rc=rs<3600?'var(--green)':rs<86400?'var(--blue)':'var(--amber)'
              return(
                <tr key={m.id||i} className="tr" style={{borderBottom:'1px solid var(--border)',background:hs?`${sc}08`:''}}>
                  <td className="td" style={{color:'var(--white)'}} title={m.question}>{m.question}</td>
                  <td className="td" style={{fontFamily:'var(--mono)',fontSize:8,color:rc}}>{m.resolve_fmt||'?'}</td>
                  <td className="td" style={{fontFamily:'var(--mono)',textAlign:'right',color:Number(m.yes_price)>=.55&&Number(m.yes_price)<=.88?'var(--green)':'var(--dim)'}}>{m.yes_price?.toFixed(3)}</td>
                  <td className="td" style={{fontFamily:'var(--mono)',textAlign:'right',color:'var(--dim)'}}>{m.no_price?.toFixed(3)}</td>
                  <td className="td">{hs?<Chip t={m.signal.replace('_','-').toUpperCase()} c={sc}/>:<span style={{color:'var(--dim)',fontSize:8}}>—</span>}</td>
                  <td className="td" style={{fontFamily:'var(--mono)',textAlign:'right',color:m.confidence>=.7?'var(--green)':m.confidence>=.5?'var(--amber)':'var(--dim)',fontSize:8}}>{hs?`${(m.confidence*100).toFixed(0)}%`:'—'}</td>
                  <td className="td" style={{fontFamily:'var(--mono)',textAlign:'right',color:m.ev>.10?'var(--green)':m.ev>.05?'var(--amber)':'var(--dim)',fontSize:8}}>{hs?`${(m.ev*100).toFixed(1)}%`:'—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LogList({log}) {
  const EI={OPEN:'▲',CLOSE_WON:'✓',CLOSE_LOST:'✗',REJECTED:'·',COMPOUND_UP:'↑',SALARY:'\$',GAS_WARN:'!',GAS_STOP:'■',BOT_START:'▶',BOT_STOP:'■',RESUMED:'»'}
  return(
    <div style={{overflowY:'auto',flex:1}}>
      {log.length===0&&<div style={{padding:'6px',color:'var(--dim)',fontSize:8,fontFamily:'var(--mono)'}}>running…</div>}
      {log.map((e,i)=>{
        const isO=e.event==='OPEN',isC=e.event==='CLOSE',won=e.result==='won'
        const isSal=e.event==='SALARY',isCmp=e.event==='COMPOUND_UP',isGS=e.event==='GAS_STOP',isGW=e.event==='GAS_WARN'
        const ik=isC?(won?'CLOSE_WON':'CLOSE_LOST'):e.event; const icon=EI[ik]||'·'
        const c=isO?'var(--blue)':isC?(won?'var(--green)':'var(--red)'):isSal?'var(--amber)':isCmp?'var(--green)':isGS?'var(--red)':isGW?'var(--amber)':'var(--dim2)'
        return(
          <div key={i} style={{display:'grid',gridTemplateColumns:'14px 50px 80px 1fr auto',alignItems:'center',gap:3,padding:'0 5px',height:17,borderBottom:'1px solid var(--border)',background:isSal?'rgba(255,170,0,.04)':isCmp?'rgba(0,255,127,.04)':i%2===0?'transparent':'rgba(255,255,255,.008)',animation:'fadeIn .15s'}}>
            <span style={{fontFamily:'var(--mono)',fontSize:9,color:c,textAlign:'center'}}>{icon}</span>
            <span style={{fontFamily:'var(--mono)',fontSize:8,color:'var(--dim2)'}}>{e.time}</span>
            <span style={{fontFamily:'var(--mono)',fontSize:8,color:c,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.event}</span>
            <span style={{fontSize:9,color:'var(--dim)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {isO&&`${e.id} · ${e.question||''}`}
              {isC&&`${e.id} · ${e.result?.toUpperCase()} PnL ${Number(e.pnl)>=0?'+':''}${Number(e.pnl).toFixed(3)}`}
              {isSal&&`Gajian ${u2(e.withdrawn)} modal ${u2(e.kept)}`}
              {isCmp&&`${u2(e.old_bet)} → ${u2(e.new_bet)}/bet`}
              {(isGW||isGS)&&(e.message||'')}
              {e.event==='REJECTED'&&(e.reason||'')}
              {e.event==='RESUMED'&&(e.message||'')}
            </span>
            <div style={{display:'flex',gap:2}}>
              {isO&&<Chip t={e.strategy||''} c={e.category==='btc5m'?'#ff66ff':'var(--green)'}/>}
              {isC&&<span style={{fontFamily:'var(--mono)',fontSize:8,color:won?'var(--green)':'var(--red)',whiteSpace:'nowrap'}}>{won?'+':'-'}{u2(Math.abs(Number(e.pnl)))}</span>}
              {isCmp&&<Chip t={`\$${e.new_bet}`} c="var(--green)"/>}
              {isSal&&<Chip t="GAJIAN" c="var(--amber)"/>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function HistTable({hist}) {
  return(
    <div style={{overflowY:'auto',flex:1}}>
      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
        <colgroup><col style={{width:70}}/><col/><col style={{width:55}}/><col style={{width:40}}/><col style={{width:42}}/><col style={{width:48}}/><col style={{width:55}}/></colgroup>
        <thead style={{position:'sticky',top:0}}><tr>{['ID','Market','Cat','Side','Bet','PnL','Result'].map(h=><th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody>
          {hist.length===0&&<tr><td colSpan={7} style={{padding:'6px',textAlign:'center',color:'var(--dim)',fontSize:8,fontFamily:'var(--mono)'}}>no closed trades</td></tr>}
          {hist.map((t,i)=>{
            const won=t.status==='won'; const catC=t.category==='btc5m'?'#ff66ff':'var(--green)'
            return(
              <tr key={t.id||i} className="tr" style={{borderBottom:'1px solid var(--border)'}}>
                <td className="td" style={{fontFamily:'var(--mono)',fontSize:8,color:'var(--dim2)'}}>{t.id}</td>
                <td className="td" style={{color:'var(--white)',fontSize:9}} title={t.question}>{t.question}</td>
                <td className="td"><Chip t={t.category==='btc5m'?'BTC5M':'SOCCER'} c={catC}/></td>
                <td className="td"><Chip t={t.outcome} c={t.outcome==='YES'||t.outcome==='UP'?'var(--green)':'var(--amber)'}/></td>
                <td className="td" style={{fontFamily:'var(--mono)',textAlign:'right'}}>{u2(t.size)}</td>
                <td className="td" style={{fontFamily:'var(--mono)',textAlign:'right',fontWeight:700,color:Number(t.pnl)>=0?'var(--green)':'var(--red)'}}>{Number(t.pnl)>=0?'+':'-'}{u3(Math.abs(Number(t.pnl)))}</td>
                <td className="td"><Chip t={t.status?.toUpperCase()} c={won?'var(--green)':'var(--red)'}/></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function App() {
  const {stats,pos,log,soccer,hist,btc5m,gas,conn,start,stop,resumeGas,reset}=useBot()
  const pnlHist=usePnlHist(stats?.capital,stats?.initial)
  const pnl=stats?.pnl??0; const isPos=pnl>=0
  const sal=stats?.salary; const isReal=stats?.mode==='REAL'

  return(
    <div style={{height:'100vh',background:'var(--black)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{height:26,background:'var(--bg1)',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',padding:'0 8px',gap:8,flexShrink:0,overflowX:'auto'}}>
        <span style={{fontFamily:'var(--mono)',fontSize:11,fontWeight:700,color:'var(--white)',letterSpacing:'.08em',whiteSpace:'nowrap'}}>POLY<span style={{color:'var(--dim)'}}>BOT</span><span style={{fontSize:9,color:isReal?'var(--amber)':'var(--dim)',marginLeft:4}}>{stats?.bot_id||'…'}</span></span>
        <Dot on={conn}/><span style={{fontFamily:'var(--mono)',fontSize:8,color:conn?'var(--green)':'var(--red)',whiteSpace:'nowrap'}}>{conn?'LIVE':'···'}</span>
        {stats&&<Chip t={stats.mode} c={isReal?'var(--amber)':'#444'}/>}
        {stats&&<Chip t={stats.running?'RUNNING':'STOPPED'} c={stats.running?'var(--green)':'var(--red)'}/>}
        {gas?.status==='critical'&&<Chip t={`GAS CRIT ${gas.orders_left}ord`} c="var(--red)"/>}
        {gas?.paused&&<Chip t="AUTO-STOPPED" c="var(--red)"/>}
        {btc5m?.in_entry_zone&&<Chip t="⚡BTC ENTRY" c="var(--amber)"/>}
        {btc5m?.predicted_dir&&<Chip t={`BTC ${btc5m.predicted_dir} ${btc5m.confidence?(btc5m.confidence*100).toFixed(0)+'%':''}`} c={btc5m.predicted_dir==='UP'?'var(--green)':'var(--red)'}/>}
        <div style={{marginLeft:'auto',display:'flex',gap:4,flexShrink:0}}>
          {isReal&&(stats?.running
            ?<button onClick={stop} style={{padding:'2px 8px',background:'rgba(255,34,68,.15)',border:'1px solid var(--red)',color:'var(--red)',borderRadius:2,fontSize:8,fontFamily:'var(--mono)',cursor:'pointer'}}>■ STOP</button>
            :<button onClick={start} style={{padding:'2px 8px',background:'rgba(0,255,127,.15)',border:'1px solid var(--green)',color:'var(--green)',borderRadius:2,fontSize:8,fontFamily:'var(--mono)',cursor:'pointer'}}>▶ RUN</button>
          )}
          {gas?.paused&&<button onClick={resumeGas} style={{padding:'2px 6px',background:'transparent',border:'1px solid var(--amber)',color:'var(--amber)',borderRadius:2,fontSize:8,fontFamily:'var(--mono)',cursor:'pointer'}}>RESUME GAS</button>}
          <button onClick={reset} style={{padding:'2px 6px',background:'transparent',border:'1px solid var(--border2)',color:'var(--dim)',borderRadius:2,fontSize:8,fontFamily:'var(--mono)',cursor:'pointer'}}>RST</button>
        </div>
      </div>

      <div style={{display:'flex',borderBottom:'1px solid var(--border)',flexShrink:0,background:'var(--bg1)',overflowX:'auto'}}>
        <SC l="EQUITY"  v={u2(stats?.capital)}        c={isPos?'var(--green)':'var(--red)'}/>
        <SC l="P&L"     v={sgn(pnl)}                  c={isPos?'var(--green)':'var(--red)'}/>
        <SC l="WIN"     v={p1(stats?.win_rate)}       c={stats?.win_rate>=60?'var(--green)':stats?.win_rate>=45?'var(--amber)':'var(--red)'}/>
        <SC l="W/L"     v={`${stats?.wins??0}/${stats?.losses??0}`}/>
        <SC l="DAILY"   v={sgn(stats?.daily_pnl??0)} c={(stats?.daily_pnl??0)>=0?'var(--green)':'var(--red)'}/>
        <SC l="OPEN"    v={pos.length}/>
        <SC l="BET"     v={`\$${stats?.compound_bet??1}`}/>
        <SC l="→NEXT"   v={`\$${stats?.compound_next??10}`} c="var(--dim)"/>
        <SC l="GAJIAN"  v={u2(sal?.total_withdrawn)}  c="var(--amber)"/>
        <SC l="GAS ORD" v={gas?.orders_left??'—'}     c={gas?.status==='ok'?'var(--white)':gas?.status==='low'?'var(--amber)':'var(--red)'}/>
        <SC l="SCANS"   v={(stats?.scan_count??0).toLocaleString()}/>
        <div style={{flex:1}}/>
      </div>

      <div style={{flex:1,display:'grid',gridTemplateColumns:'210px 1fr 1fr',overflow:'hidden',minHeight:0}}>
        <div style={{display:'flex',flexDirection:'column',borderRight:'1px solid var(--border)',overflow:'hidden'}}>
          <SH t="BTC 5M · 7 Indicators" r="12x/hr"/>
          <div style={{flex:1,overflowY:'auto'}}><Btc5mPanel d={btc5m}/></div>
          <div style={{borderTop:'1px solid var(--border)',padding:'4px 6px',flexShrink:0}}>
            <div style={{fontSize:7,color:'var(--dim)',fontFamily:'var(--mono)',marginBottom:2}}>COMPOUND floor(\$eq/10)</div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:2,fontSize:9,fontFamily:'var(--mono)'}}>
              <span style={{color:'var(--white)',fontWeight:700}}>\${stats?.compound_bet??1}/bet</span>
              <span style={{color:'var(--dim)'}}>→\${stats?.compound_next??10}</span>
            </div>
            <Bar pct={stats?.compound_prog??0} c="var(--white)" h={2}/>
          </div>
          <div style={{borderTop:'1px solid var(--border)',padding:'4px 6px',flexShrink:0}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
              <span style={{fontSize:7,color:'var(--amber)',fontFamily:'var(--mono)'}}>💰 SALARY {sal?.salary_count??0}x</span>
              <span style={{fontSize:7,color:'var(--dim)',fontFamily:'var(--mono)'}}>\${Number(sal?.total_withdrawn||0).toFixed(2)}</span>
            </div>
            <Bar pct={sal?.progress_pct??0} c="var(--amber)" h={2}/>
            <div style={{display:'flex',justifyContent:'space-between',marginTop:2,fontSize:7,fontFamily:'var(--mono)',color:'var(--dim)'}}>
              <span>\${Number(sal?.current_equity||0).toFixed(2)}</span>
              <span style={{color:'var(--amber)'}}>{sal?.progress_pct??0}%</span>
              <span>→\${sal?.next_target??100}</span>
            </div>
          </div>
          <div style={{borderTop:'1px solid var(--border)',padding:'4px 6px',flexShrink:0}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
              <span style={{fontSize:7,color:'var(--dim)',fontFamily:'var(--mono)'}}>⛽ GAS · 50% reserve</span>
              <Chip t={gas?.status?.toUpperCase()||'—'} c={gas?.status==='ok'?'var(--white)':gas?.status==='low'?'var(--amber)':'var(--red)'}/>
            </div>
            <Bar pct={Math.min(100,((gas?.pol_used||0)/(gas?.pol_total||11))*100)} c={gas?.status==='critical'?'var(--red)':gas?.status==='low'?'var(--amber)':'var(--white)'} h={2}/>
            <div style={{display:'flex',justifyContent:'space-between',marginTop:2,fontSize:7,fontFamily:'var(--mono)',color:'var(--dim)'}}>
              <span>{(gas?.pol_left||0).toFixed(2)} POL</span>
              <span style={{color:gas?.orders_left<=5?'var(--amber)':'var(--dim)'}}>{gas?.orders_left??'—'} orders</span>
            </div>
            {gas?.paused&&<button onClick={resumeGas} style={{marginTop:3,width:'100%',padding:'2px',background:'transparent',border:'1px solid var(--red)',color:'var(--red)',fontFamily:'var(--mono)',fontSize:7,borderRadius:2,cursor:'pointer'}}>RESUME SETELAH TOP-UP POL</button>}
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',borderRight:'1px solid var(--border)',overflow:'hidden'}}>
          <div style={{flex:'0 0 auto',borderBottom:'1px solid var(--border)',display:'flex',flexDirection:'column',maxHeight:'42%'}}>
            <SH t="⚽ Soccer Scanner" r={`${soccer.filter(m=>m.signal!=='—').length} signals`}/>
            <SoccerTable markets={soccer}/>
          </div>
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0}}>
            <SH t="Activity Log" r={log.length}/>
            <LogList log={log}/>
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',overflow:'hidden'}}>
          <div style={{borderBottom:'1px solid var(--border)',flexShrink:0}}>
            <SH t="PnL Curve" r={`${sgn(pnl)} · ${p1(stats?.roi_pct)}`}/>
            <div style={{padding:'3px 6px',background:'var(--bg2)'}}><Spark hist={pnlHist} h={30}/></div>
          </div>
          <div style={{flex:'0 0 auto',display:'flex',flexDirection:'column',borderBottom:'1px solid var(--border)',maxHeight:'32%'}}>
            <SH t={`Open Positions (${pos.length})`} r={`avail ${u2(stats?.available)} locked ${u2(stats?.locked)}`}/>
            <div style={{overflowY:'auto'}}>
              {pos.length===0
                ?<div style={{padding:'4px 6px',color:'var(--dim)',fontSize:8,fontFamily:'var(--mono)'}}>no open positions</div>
                :<table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
                  <colgroup><col style={{width:68}}/><col/><col style={{width:55}}/><col style={{width:40}}/><col style={{width:40}}/><col style={{width:42}}/><col style={{width:34}}/><col style={{width:50}}/></colgroup>
                  <thead><tr>{['ID','Market','Cat','Side','@Px','Bet','EV','Remain'].map(h=><th key={h} className="th">{h}</th>)}</tr></thead>
                  <tbody>{pos.map(p=><PosRow key={p.id} p={p}/>)}</tbody>
                </table>
              }
            </div>
          </div>
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0}}>
            <SH t="Trade History" r={hist.length}/>
            <HistTable hist={hist}/>
          </div>
        </div>
      </div>
    </div>
  )
}

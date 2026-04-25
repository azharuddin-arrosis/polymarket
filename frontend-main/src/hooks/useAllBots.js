import { useState, useEffect, useRef, useCallback } from 'react'

const BOTS = [
  { id:'sim1', prefix:'/s1', label:'SIM 1', mode:'sim', port:3101 },
  { id:'sim2', prefix:'/s2', label:'SIM 2', mode:'sim', port:3102 },
  { id:'real1',prefix:'/r1', label:'REAL 1',mode:'real',port:3201 },
  { id:'real2',prefix:'/r2', label:'REAL 2',mode:'real',port:3202 },
]
export { BOTS }

function useSingleBot(prefix) {
  const [data, setData] = useState(null)
  const [conn, setConn] = useState(false)
  const ws  = useRef(null)
  const tmr = useRef(null)

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return
    try {
      const proto = window.location.protocol==='https:'?'wss':'ws'
      ws.current  = new WebSocket(`${proto}://${window.location.host}${prefix}/ws`)
      ws.current.onopen  = () => { setConn(true); clearTimeout(tmr.current) }
      ws.current.onclose = () => { setConn(false); tmr.current=setTimeout(connect,5000) }
      ws.current.onerror = () => ws.current?.close()
      ws.current.onmessage = ({data:raw}) => {
        try {
          const m = JSON.parse(raw)
          if (m.type==='init') setData(m.data)
          else if (m.type==='stats')    setData(p=>p?{...p,stats:m.data}:p)
          else if (m.type==='positions')setData(p=>p?{...p,positions:m.data}:p)
          else if (m.type==='btc5m')    setData(p=>p?{...p,btc5m:m.data}:p)
          else if (m.type==='soccer')   setData(p=>p?{...p,soccer:m.data}:p)
          else if (m.type==='log')      setData(p=>p?{...p,log:[m.data,...(p.log||[])].slice(0,100)}:p)
          else if (m.type==='gas')      setData(p=>p?{...p,gas:m.data}:p)
        } catch {}
      }
    } catch {}
  }, [prefix])

  useEffect(() => {
    connect()
    const id = setInterval(async () => {
      if (ws.current?.readyState===WebSocket.OPEN) return
      try {
        const [s,p,b,g] = await Promise.all([
          fetch(`${prefix}/api/stats`).then(r=>r.json()),
          fetch(`${prefix}/api/positions`).then(r=>r.json()),
          fetch(`${prefix}/api/btc5m`).then(r=>r.json()),
          fetch(`${prefix}/api/gas`).then(r=>r.json()),
        ])
        setData(prev => ({...prev, stats:s, positions:p, btc5m:b, gas:g}))
      } catch {}
    }, 8000)
    return () => { clearInterval(id); clearTimeout(tmr.current); ws.current?.close() }
  }, [connect])

  const call = (path) => fetch(`${prefix}${path}`, {method:'POST'})
  return { data, conn, prefix, start:()=>call('/api/bot/start'), stop:()=>call('/api/bot/stop'), resumeGas:()=>call('/api/gas/resume') }
}

export function useAllBots() {
  // Connect to all bots
  const b = BOTS.map(cfg => ({ ...cfg, ...useSingleBot(cfg.prefix) }))
  return b
}

export function useDbSummary() {
  const [summary, setSummary] = useState([])
  useEffect(() => {
    const load = async () => {
      try { setSummary(await fetch('/api/db/summary').then(r=>r.json())) } catch {}
    }
    load()
    const id = setInterval(load, 12000)
    return () => clearInterval(id)
  }, [])
  return summary
}

// Aggregate all soccer signals from all bots (deduplicated)
export function useGlobalScanner(bots) {
  return bots.flatMap(b => (b.data?.soccer||[]).filter(r=>r.signal&&r.signal!=='—'))
    .filter((r,i,arr) => arr.findIndex(x=>x.id===r.id)===i)
    .sort((a,b) => b.ev - a.ev)
}

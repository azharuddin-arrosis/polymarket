import { useState, useEffect, useRef, useCallback } from 'react'

export function useBot() {
  const [stats, setStats]   = useState(null)
  const [pos,   setPos]     = useState([])
  const [log,   setLog]     = useState([])
  const [soccer,setSoccer]  = useState([])
  const [hist,  setHist]    = useState([])
  const [btc5m, setBtc5m]   = useState(null)
  const [gas,   setGas]     = useState(null)
  const [conn,  setConn]    = useState(false)
  const ws  = useRef(null)
  const tmr = useRef(null)

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return
    try {
      const proto = window.location.protocol==='https:'?'wss':'ws'
      ws.current  = new WebSocket(`${proto}://${window.location.host}/ws`)
      ws.current.onopen  = () => { setConn(true); clearTimeout(tmr.current) }
      ws.current.onclose = () => { setConn(false); tmr.current=setTimeout(connect,3000) }
      ws.current.onerror = () => ws.current?.close()
      ws.current.onmessage = ({data}) => {
        try {
          const m=JSON.parse(data), d=m.data
          if (m.type==='init') { setStats(d.stats);setPos(d.positions||[]);setLog(d.log||[]);setSoccer(d.soccer||[]);setHist(d.history||[]);setBtc5m(d.btc5m||null);setGas(d.gas) }
          else if (m.type==='stats')     { setStats(d); setGas(d.gas) }
          else if (m.type==='positions') { setPos(d) }
          else if (m.type==='log')       { setLog(p=>[d,...p].slice(0,300)) }
          else if (m.type==='soccer')    { setSoccer(d) }
          else if (m.type==='btc5m')     { setBtc5m(d) }
          else if (m.type==='gas')       { setGas(d) }
          else if (m.type==='gas_stop')  { setGas(g=>g?{...g,paused:true,status:'critical'}:g) }
        } catch {}
      }
    } catch {}
  }, [])

  useEffect(() => {
    connect()
    const id = setInterval(async() => {
      if (ws.current?.readyState===WebSocket.OPEN) return
      try {
        const [s,p,l,sc,h,b,g] = await Promise.all([
          fetch('/api/stats').then(r=>r.json()),
          fetch('/api/positions').then(r=>r.json()),
          fetch('/api/log?limit=60').then(r=>r.json()),
          fetch('/api/soccer').then(r=>r.json()),
          fetch('/api/history?limit=50').then(r=>r.json()),
          fetch('/api/btc5m').then(r=>r.json()),
          fetch('/api/gas').then(r=>r.json()),
        ])
        setStats(s);setPos(p);setLog(l);setSoccer(sc);setHist(h);setBtc5m(b);setGas(g)
      } catch {}
    }, 5000)
    return () => { clearInterval(id); clearTimeout(tmr.current); ws.current?.close() }
  }, [connect])

  const api = (path) => fetch(path, {method:'POST'})
  return {
    stats, pos, log, soccer, hist, btc5m, gas, conn,
    start:     () => api('/api/bot/start'),
    stop:      () => api('/api/bot/stop'),
    resumeGas: () => api('/api/gas/resume'),
    reset:     () => { if(confirm('Reset bot?')) api('/api/reset') },
  }
}

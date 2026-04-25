import { useState, useEffect, useRef, useCallback } from 'react'

// Connect to a specific bot by prefix path
export function useBot(prefix) {
  const [stats,  setStats]   = useState(null)
  const [btc5m,  setBtc5m]   = useState(null)
  const [conn,   setConn]    = useState(false)
  const ws  = useRef(null)
  const tmr = useRef(null)
  const base = `/${prefix}`

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return
    try {
      const proto = window.location.protocol==='https:'?'wss':'ws'
      ws.current  = new WebSocket(`${proto}://${window.location.host}${base}/ws`)
      ws.current.onopen  = () => { setConn(true); clearTimeout(tmr.current) }
      ws.current.onclose = () => { setConn(false); tmr.current=setTimeout(connect,5000) }
      ws.current.onerror = () => ws.current?.close()
      ws.current.onmessage = ({data}) => {
        try {
          const m=JSON.parse(data), d=m.data
          if (m.type==='init') { setStats(d.stats); setBtc5m(d.btc5m) }
          else if (m.type==='stats') setStats(d)
          else if (m.type==='btc5m') setBtc5m(d)
        } catch {}
      }
    } catch {}
  }, [base])

  useEffect(() => {
    connect()
    const id = setInterval(async() => {
      if (ws.current?.readyState===WebSocket.OPEN) return
      try {
        const s = await fetch(`${base}/api/stats`).then(r=>r.json())
        setStats(s)
      } catch {}
    }, 6000)
    return ()=>{ clearInterval(id); clearTimeout(tmr.current); ws.current?.close() }
  }, [connect, base])

  const api = (path) => fetch(`${base}${path}`, {method:'POST'})
  return { stats, btc5m, conn, start:()=>api('/api/bot/start'), stop:()=>api('/api/bot/stop'), resumeGas:()=>api('/api/gas/resume') }
}

export function useDbSummary() {
  const [summary, setSummary] = useState([])
  useEffect(() => {
    const load = async() => {
      try { setSummary(await fetch('/sim1/api/db/summary').then(r=>r.json())) } catch {}
    }
    load(); const id=setInterval(load,10000); return()=>clearInterval(id)
  }, [])
  return summary
}

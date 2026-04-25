import { useState, useEffect, useRef, useCallback } from 'react'

// Connect to a specific bot by prefix path
export function useBot(prefix) {
  const [stats,   setStats]   = useState(null)
  const [btc5m,   setBtc5m]   = useState(null)
  const [balance, setBalance] = useState(null)   // Sprint 1: live balance per bot
  const [conn,    setConn]    = useState(false)
  const ws  = useRef(null)
  const tmr = useRef(null)
  const balTmr = useRef(null)
  const base = `/${prefix}`

  const fetchBalance = useCallback(async () => {
    try {
      const b = await fetch(`${base}/api/balance`).then(r => r.json())
      setBalance(b)
    } catch {}
  }, [base])

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return
    try {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      ws.current  = new WebSocket(`${proto}://${window.location.host}${base}/ws`)
      ws.current.onopen  = () => { setConn(true); clearTimeout(tmr.current); fetchBalance() }
      ws.current.onclose = () => { setConn(false); tmr.current = setTimeout(connect, 5000) }
      ws.current.onerror = () => ws.current?.close()
      ws.current.onmessage = ({ data }) => {
        try {
          const m = JSON.parse(data), d = m.data
          if (m.type === 'init') {
            setStats(d.stats); setBtc5m(d.btc5m)
            if (d.balance) setBalance(d.balance)
          }
          else if (m.type === 'stats')          { setStats(d) }
          else if (m.type === 'btc5m')          { setBtc5m(d) }
          else if (m.type === 'balance_update') { setBalance(b => ({ ...b, ...d })) }
        } catch {}
      }
    } catch {}
  }, [base, fetchBalance])

  useEffect(() => {
    connect()
    const id = setInterval(async () => {
      if (ws.current?.readyState === WebSocket.OPEN) return
      try {
        const s = await fetch(`${base}/api/stats`).then(r => r.json())
        setStats(s)
      } catch {}
    }, 6000)
    // Balance polling every 60s per bot (Sprint 1)
    balTmr.current = setInterval(fetchBalance, 60000)
    return () => {
      clearInterval(id)
      clearInterval(balTmr.current)
      clearTimeout(tmr.current)
      ws.current?.close()
    }
  }, [connect, base, fetchBalance])

  const api = (path) => fetch(`${base}${path}`, { method: 'POST' })
  return {
    stats, btc5m, balance, conn,
    start:     () => api('/api/bot/start'),
    stop:      () => api('/api/bot/stop'),
    resumeGas: () => api('/api/gas/resume'),
  }
}

export function useDbSummary() {
  const [summary, setSummary] = useState([])
  const [sortKey, setSortKey] = useState('bot_id')
  const [sortAsc, setSortAsc] = useState(true)
  useEffect(() => {
    const load = async () => {
      try { setSummary(await fetch('/sim1/api/db/summary').then(r => r.json())) } catch {}
    }
    load(); const id = setInterval(load, 10000); return () => clearInterval(id)
  }, [])
  const sort = (key) => {
    setSortKey(key)
    setSortAsc(a => sortKey === key ? !a : true)
  }
  const sorted = [...summary].sort((a, b) => {
    const av = a[sortKey] ?? '', bv = b[sortKey] ?? ''
    return sortAsc
      ? (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv)))
      : (typeof bv === 'number' ? bv - av : String(bv).localeCompare(String(av)))
  })
  return { summary: sorted, sort, sortKey, sortAsc }
}

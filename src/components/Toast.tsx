import { useEffect, useState } from 'react'

interface ToastItem {
  id: number
  msg: string
  kind: 'ok' | 'err'
}

let listeners: ((t: ToastItem) => void)[] = []
let seq = 1

export function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  const item = { id: seq++, msg, kind }
  listeners.forEach((l) => l(item))
}

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    const l = (t: ToastItem) => {
      setItems((prev) => [...prev, t])
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 2600)
    }
    listeners.push(l)
    return () => {
      listeners = listeners.filter((x) => x !== l)
    }
  }, [])

  return (
    <div role="status" aria-live="polite" className="fixed left-1/2 -translate-x-1/2 z-[90] flex flex-col items-center gap-2 pointer-events-none" style={{ bottom: 'calc(var(--mini-h) + 84px)' }}>
      {items.map((t) => (
        <div
          key={t.id}
          className={`animate-scale-in px-4 py-2.5 rounded-xl text-[13px] font-medium shadow-2xl border ${
            t.kind === 'ok'
              ? 'bg-[#17172b] border-white/10 text-white'
              : 'bg-red-950/90 border-red-500/30 text-red-200'
          }`}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}

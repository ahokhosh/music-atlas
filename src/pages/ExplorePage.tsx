import { useMemo, useState } from 'react'
import { COUNTRIES, REGIONS, type Region } from '../data/countries'
import CountryFlag from '../components/CountryFlag'
import { EmptyState } from '../components/Feedback'

type Filter = 'All' | Region

export default function ExplorePage({ nav }: { nav: (p: string) => void }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('All')

  const counts = useMemo(() => {
    const m = new Map<Region, number>()
    for (const c of COUNTRIES) m.set(c.region, (m.get(c.region) || 0) + 1)
    return m
  }, [])

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return COUNTRIES.filter((c) => {
      if (filter !== 'All' && c.region !== filter) return false
      if (!needle) return true
      return c.name.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle)
    })
  }, [q, filter])

  return (
    <div className="animate-fade-in">
      <div className="pt-6 pb-3">
        <h1 className="display text-2xl font-extrabold">Music Atlas</h1>
        <p className="text-[13px] text-(--text-dim) mt-1">
          {COUNTRIES.length} countries · tap one to open its live chart
        </p>
      </div>

      {/* ── Sticky search + region filter ─────────────────── */}
      <div
        className="sticky top-0 z-20 -mx-4 px-4 pt-3 pb-3"
        style={{ background: 'rgba(7,7,13,0.88)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
      >
        <div className="relative">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="absolute left-4 top-1/2 -translate-y-1/2 text-(--muted)">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            className="input !pl-11 !pr-11"
            placeholder="Find a country…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 icon-btn !w-8 !h-8"
              onClick={() => setQ('')}
              aria-label="Clear search"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar mt-3 pb-0.5">
          {(['All', ...REGIONS] as Filter[]).map((r) => (
            <button
              key={r}
              onClick={() => setFilter(r)}
              className={`pill flex-shrink-0 ${filter === r ? 'active' : ''}`}
            >
              {r === 'All' ? `🌐 All · ${COUNTRIES.length}` : `${r} · ${counts.get(r) || 0}`}
            </button>
          ))}
        </div>
      </div>

      {/* ── Result count ──────────────────────────────────── */}
      <p className="text-[11.5px] text-(--muted) mt-1 mb-3">
        {list.length} countr{list.length === 1 ? 'y' : 'ies'}
        {filter !== 'All' ? ` in ${filter}` : ''}
        {q.trim() ? ` matching “${q.trim()}”` : ''}
      </p>

      {/* ── Country grid: real flags, big readable cards ──── */}
      {list.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-6">
          {list.map((c) => (
            <button
              key={c.code}
              className="card card-hover !rounded-2xl p-3 flex flex-col items-center gap-2 text-center"
              onClick={() => nav(`/country/${c.code}`)}
            >
              <CountryFlag code={c.code} hue={c.hue} className="w-full" />
              <div className="min-w-0 w-full">
                <p className="text-[13px] font-bold leading-tight truncate">{c.name}</p>
                <p className="text-[10.5px] text-(--muted) font-semibold mt-0.5 tracking-wider">
                  {c.code} · {c.region}
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="🧭"
          title="No country found"
          sub={`Nothing matches "${q}". Try another spelling or clear the filter.`}
          action={<button className="btn btn-soft !py-2" onClick={() => { setQ(''); setFilter('All') }}>Show all</button>}
        />
      )}
    </div>
  )
}

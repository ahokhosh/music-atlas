import { useCallback, useEffect, useState } from 'react'
import { api, getRecent, type Playlist, type Track } from '../services/api'
import { usePlayer } from '../services/PlayerContext'
import TrackRow from '../components/TrackRow'
import PlaylistCard from '../components/PlaylistCard'
import CountryFlag from '../components/CountryFlag'
import { CardSkeleton, EmptyState, TrackSkeleton } from '../components/Feedback'
import { COUNTRIES, getCountry, type Country } from '../data/countries'
import { GENRES } from '../data/genres'

// World Tour order: US, CN, IN, IR, ES first, then the rest by population (desc).
const FEATURED_CODES = ['US', 'CN', 'IN', 'IR', 'ES', 'BR', 'MX', 'JP', 'TR', 'DE', 'GB', 'FR', 'IT', 'KR']
const FEATURED: Country[] = FEATURED_CODES.map((c) => COUNTRIES.find((x) => x.code === c)!).filter(Boolean)

interface ScPack {
  id: string
  name: string
  emoji: string
  category: string
  description: string
  tracksCount: number
  artwork: string | null
  permalink: string
}

interface GeoData {
  country: string
  countryName: string
  flag: string
  hue: number
}

interface HomeData {
  country?: { code: string; name: string; flag: string; hue: number; region: string }
  trending?: { tracks: Track[]; fallback?: boolean }
  featured?: ScPack[]
  trendingPlaylists?: ScPack[]
  trendingPlaylistsFallback?: boolean
  community?: Playlist[]
  genres?: { slug: string; name: string; hue: number; artwork: string | null; tracksCount?: number }[]
  cached?: boolean
}

interface Props {
  nav: (p: string) => void
  onAdd: (t: Track) => void
}

export default function HomePage({ nav, onAdd }: Props) {
  const { playQueue } = usePlayer()
  const [tracks, setTracks] = useState<Track[]>([])
  const [fallback, setFallback] = useState(false)
  const [chartLoading, setChartLoading] = useState(true)
  const [chartCountry, setChartCountry] = useState('US')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [packs, setPacks] = useState<ScPack[]>([])
  const [trendPacks, setTrendPacks] = useState<ScPack[]>([])
  const [trendFallback, setTrendFallback] = useState(false)
  const [packsLoading, setPacksLoading] = useState(true)
  const [geo, setGeo] = useState<GeoData | null>(null)
  const [packImgFailed, setPackImgFailed] = useState<Record<string, boolean>>({})
  const [genreArt, setGenreArt] = useState<Record<string, string>>({})
  const [genreCount, setGenreCount] = useState<Record<string, number>>({})
  // Snapshot recents once per mount — getRecent() is JSON.parse on localStorage.
  const [recent] = useState<Track[]>(() => getRecent())

  const loadChart = useCallback(async (code: string, fresh = false) => {
    setChartLoading(true)
    try {
      const d = await api<{ tracks: Track[]; fallback?: boolean }>(
        `/music/trending/${code}${fresh ? '?fresh=1' : ''}`
      )
      setTracks(d.tracks || [])
      setFallback(!!d.fallback)
    } catch {
      setTracks([])
    } finally {
      setChartLoading(false)
    }
  }, [])

  const loadPacks = useCallback(async (fresh = false) => {
    setPacksLoading(true)
    try {
      const d = await api<{ playlists: ScPack[] }>(`/music/featured${fresh ? '?fresh=1' : ''}`)
      setPacks(d.playlists || [])
    } catch {
      setPacks([])
    } finally {
      setPacksLoading(false)
    }
  }, [])

  const loadCommunity = useCallback(async () => {
    try {
      const d = await api<{ playlists: Playlist[] }>('/playlists/public?limit=12')
      setPlaylists(d.playlists || [])
    } catch {
      setPlaylists([])
    }
  }, [])

  // Initial load: ONE aggregate request (/home) for geo + chart + packs
  // + community — answered from warm server caches in milliseconds.
  // Individual loaders below stay as fallback + manual refresh paths.
  useEffect(() => {
    let cancelled = false
    const fallbackLoad = () => {
      if (cancelled) return
      api<GeoData>('/geo')
        .then((g) => {
          if (cancelled) return 'US'
          setGeo(g)
          const code = g.country || 'US'
          setChartCountry(code)
          return code
        })
        .catch(() => 'US')
        .then((code) => {
          if (!cancelled && code) loadChart(code)
        })
      loadPacks()
      loadCommunity()
    }
    api<HomeData>('/home')
      .then((d) => {
        if (cancelled || !d) return
        if (d.country?.code) {
          setGeo({ country: d.country.code, countryName: d.country.name, flag: d.country.flag, hue: d.country.hue })
          setChartCountry(d.country.code)
        } else {
          fallbackLoad()
          return
        }
        setTracks(d.trending?.tracks || [])
        setFallback(!!d.trending?.fallback)
        setChartLoading(false)
        setPacks(d.featured || [])
        setTrendPacks(d.trendingPlaylists || [])
        setTrendFallback(!!d.trendingPlaylistsFallback)
        setPacksLoading(false)
        setPlaylists(d.community || [])
        const art: Record<string, string> = {}
        const cnt: Record<string, number> = {}
        for (const g of d.genres || []) {
          if (g?.slug && g.artwork) art[g.slug] = g.artwork
          if (g?.slug && g.tracksCount) cnt[g.slug] = g.tracksCount
        }
        setGenreArt(art)
        setGenreCount(cnt)
      })
      .catch(fallbackLoad)
    return () => { cancelled = true }
  }, [loadChart, loadPacks, loadCommunity])

  const changeCountry = (code: string) => {
    setChartCountry(code)
    loadChart(code)
    api<{ playlists: ScPack[]; fallback?: boolean }>(`/music/trending/playlists/${code}`)
      .then((d) => {
        setTrendPacks(d.playlists || [])
        setTrendFallback(!!d.fallback)
      })
      .catch(() => {})
  }

  const openPack = (id: string) => nav(`/pack/${id}`)
  const chartMeta = getCountry(chartCountry)
  const countryOptions = geo && !FEATURED_CODES.includes(geo.country)
    ? [...FEATURED, { code: geo.country, name: geo.countryName, region: 'Asia' as const, flag: geo.flag, hue: geo.hue }]
    : FEATURED

  return (
    <div className="animate-fade-in">
      {/* ── Search ───────────────────────────────────────── */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-white/4 border border-white/8 text-(--muted) text-sm mt-4 mb-7 hover:border-violet-500/40 transition-colors"
        onClick={() => nav('/search')}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-violet-300 flex-shrink-0">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <span className="truncate">Search songs, artists, countries, playlists…</span>
      </button>

      {/* ── Trending by genre (first) ──────────────────── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-1">
          <h2 className="section-title"><span>🎛️</span> Trending by genre</h2>
        </div>
        <p className="text-[11.5px] text-(--muted) mb-3">
          New & hot from the official charts — tap a genre to open its playlist.
        </p>
        <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 pb-2 snap-x">
          {GENRES.map((g) => (
            <button
              key={g.slug}
              onClick={() => nav(`/genre/${g.slug}`)}
              className="snap-start flex-shrink-0 w-[128px] rounded-2xl overflow-hidden border border-white/8 hover:border-violet-500/40 transition-all group text-left"
              style={{ background: `linear-gradient(150deg, hsl(${g.hue},60%,24%), hsl(${(g.hue + 50) % 360},55%,13%))` }}
            >
              <div className="relative h-[86px] flex items-center justify-center overflow-hidden">
                {genreArt[g.slug] ? (
                  <img src={genreArt[g.slug]} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={() => setGenreArt((prev) => { const n = { ...prev }; delete n[g.slug]; return n })} />
                ) : (
                  <span className="text-[38px] drop-shadow-lg group-hover:scale-110 transition-transform">🎵</span>
                )}
                <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 20,12 7,20" /></svg>
                  </span>
                </div>
              </div>
              <div className="px-2.5 py-2 bg-black/30">
                <p className="font-bold text-[12.5px] text-white truncate">{g.name}</p>
                <p className="text-[10px] text-white/55 font-semibold">
                  {genreCount[g.slug] ? `${genreCount[g.slug]} tracks` : 'Open →'}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ── Fresh picks (live SoundCloud sets) ───────────── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-1">
          <h2 className="section-title"><span>✨</span> Fresh picks</h2>
          <button
            className="text-[12px] font-semibold text-violet-400 disabled:opacity-50"
            onClick={() => loadPacks(true)}
            disabled={packsLoading}
          >
            {packsLoading ? 'Updating…' : '↻ Refresh'}
          </button>
        </div>
        <p className="text-[11.5px] text-(--muted) mb-3">
          Live curated sets — not a fixed list.
        </p>
        {packsLoading && packs.length === 0 ? (
          <CardSkeleton n={4} />
        ) : packs.length ? (
          <div className="flex gap-3.5 overflow-x-auto no-scrollbar -mx-4 px-4 pb-2 snap-x">
            {packs.map((p) => (
              <div
                key={p.id}
                onClick={() => openPack(p.id)}
                className="snap-start flex-shrink-0 w-[164px] p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/8 hover:border-orange-500/30 transition-all cursor-pointer group flex flex-col justify-between"
              >
                <div>
                  <div className="relative aspect-square w-full rounded-xl overflow-hidden mb-2.5 bg-neutral-900 border border-white/5">
                    {p.artwork && !packImgFailed[p.id] ? (
                      <img src={p.artwork} alt="" className="w-full h-full object-cover" loading="lazy" onError={() => setPackImgFailed((prev) => ({ ...prev, [p.id]: true }))} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-center font-bold text-[15px] px-3 text-orange-100/90 leading-snug bg-gradient-to-br from-orange-950 via-[#1c1410] to-neutral-900">
                        <span className="line-clamp-3">{p.name}</span>
                      </div>
                    )}
                    <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/60 border border-white/15 text-orange-200">
                      {p.category}
                    </span>
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="w-10 h-10 rounded-full bg-orange-500 text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21" /></svg>
                      </span>
                    </div>
                  </div>
                  <p className="font-bold text-[13px] text-white truncate">{p.name}</p>
                  <p className="text-[11px] text-(--muted) line-clamp-2 mt-0.5 leading-tight">{p.description}</p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-orange-400 font-semibold">
                  <span>{p.tracksCount ?? 0} tracks</span>
                  <span>Open →</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card">
            <EmptyState
              icon="📡"
              title="Couldn’t load fresh picks"
              sub="Music service is unreachable right now. Check your connection and try again."
              action={<button className="btn btn-soft !py-2" onClick={() => loadPacks(true)}>Try again</button>}
            />
          </div>
        )}
      </section>

      {/* ── Trending playlists (fresh, per country) ─────── */}
      {trendPacks.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-1">
            <h2 className="section-title"><span>📀</span> Trending playlists</h2>
          </div>
          <p className="text-[11.5px] text-(--muted) mb-3">
            {trendFallback
              ? `Almost no local sets for ${chartMeta?.name || chartCountry} on SoundCloud yet — showing global picks.`
              : `Fresh sets for ${chartMeta?.name || chartCountry} — ranked by recency & engagement.`}
          </p>
          <div className="flex gap-3.5 overflow-x-auto no-scrollbar -mx-4 px-4 pb-2 snap-x">
            {trendPacks.map((p) => (
              <div
                key={`trend-${p.id}`}
                onClick={() => openPack(p.id)}
                className="snap-start flex-shrink-0 w-[164px] p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/8 hover:border-emerald-500/30 transition-all cursor-pointer group flex flex-col justify-between"
              >
                <div>
                  <div className="relative aspect-square w-full rounded-xl overflow-hidden mb-2.5 bg-neutral-900 border border-white/5">
                    {p.artwork && !packImgFailed[`trend-${p.id}`] ? (
                      <img src={p.artwork} alt="" className="w-full h-full object-cover" loading="lazy" onError={() => setPackImgFailed((prev) => ({ ...prev, [`trend-${p.id}`]: true }))} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-center font-bold text-[15px] px-3 text-emerald-100/90 leading-snug bg-gradient-to-br from-emerald-950 via-[#101c16] to-neutral-900">
                        <span className="line-clamp-3">{p.name}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="w-10 h-10 rounded-full bg-emerald-500 text-black flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21" /></svg>
                      </span>
                    </div>
                  </div>
                  <p className="font-bold text-[13px] text-white truncate">{p.name}</p>
                  <p className="text-[11px] text-(--muted) line-clamp-2 mt-0.5 leading-tight">{p.description}</p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-emerald-400 font-semibold">
                  <span>{p.tracksCount ?? 0} tracks</span>
                  <span>Open →</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Local chart (switchable, always fresh) ────────── */}
      <section className="mb-8">
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <h2 className="section-title">
            <span>🔥</span> {chartMeta ? `Top Hits · ${chartMeta.flag} ${chartMeta.name}` : 'Top Hits'}
          </h2>
          <div className="flex items-center gap-2">
            <select
              value={chartCountry}
              onChange={(e) => changeCountry(e.target.value)}
              className="text-[12px] font-semibold bg-white/6 border border-white/10 rounded-full px-3 py-1.5 outline-none cursor-pointer"
              title="Switch chart country"
            >
              {countryOptions.map((c) => (
                <option key={c.code} value={c.code} className="bg-neutral-900">
                  {c.flag} {c.name}
                </option>
              ))}
            </select>
            {tracks.length > 0 && (
              <button className="text-[12px] font-semibold text-violet-400" onClick={() => playQueue(tracks, 0)}>Play all ▶</button>
            )}
            <button
              className="text-[12px] font-semibold text-(--muted) hover:text-white disabled:opacity-50"
              onClick={() => loadChart(chartCountry, true)}
              disabled={chartLoading}
              title="Reload chart"
            >
              ↻
            </button>
          </div>
        </div>
        {fallback && tracks.length > 0 && (
          <div className="flex items-center justify-between gap-2 text-[11.5px] px-3 py-2 rounded-xl bg-amber-500/8 border border-amber-500/20 text-amber-300 mb-2">
            <span>Live chart for this country is empty — showing global hits.</span>
            <button className="font-bold underline underline-offset-2 flex-shrink-0" onClick={() => loadChart(chartCountry, true)}>Retry</button>
          </div>
        )}
        <div className="track-list">
          {chartLoading ? (
            <div className="p-2"><TrackSkeleton rows={6} /></div>
          ) : tracks.length ? (
            <>
              {tracks.slice(0, 8).map((t, i) => <TrackRow key={t.videoId + i} track={t} i={i} list={tracks} onAdd={onAdd} />)}
              <button
                className="w-full text-center text-[12px] font-semibold text-violet-400 py-2.5 hover:text-violet-300"
                onClick={() => nav(`/country/${chartCountry}`)}
              >
                Full {chartMeta?.name || ''} chart →
              </button>
            </>
          ) : (
            <EmptyState
              icon="🛰️"
              title="Chart unavailable"
              sub="We couldn’t reach the music service. Check your connection and retry."
              action={<button className="btn btn-soft !py-2" onClick={() => loadChart(chartCountry, true)}>Retry</button>}
            />
          )}
        </div>
      </section>

      {/* ── World Tour ───────────────────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title"><span>🌍</span> World Tour</h2>
          <button className="text-[12px] font-semibold text-violet-400" onClick={() => nav('/explore')}>All 249 countries →</button>
        </div>
        <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
          {FEATURED.map((c) => (
            <button key={c.code} className="flex flex-col items-center gap-1.5 flex-shrink-0 group" onClick={() => nav(`/country/${c.code}`)}>
              <span className="transition-transform group-hover:scale-105 rounded-full">
                <CountryFlag code={c.code} hue={c.hue} circle className="w-[58px]" />
              </span>
              <span className="text-[11px] font-medium text-(--text-dim) max-w-[70px] truncate">{c.name}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Community Playlists ──────────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title"><span>💜</span> Community Playlists</h2>
          <button className="text-[12px] font-semibold text-violet-400" onClick={() => nav('/library')}>Library →</button>
        </div>
        {playlists.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-3xl mb-2">📻</p>
            <p className="text-[13.5px] font-semibold">No community playlists yet</p>
            <p className="text-[12px] text-(--text-dim) mt-1 mb-4">Be the first — create one and pick your country!</p>
            <button className="btn btn-primary !py-2.5" onClick={() => nav('/library?new=1')}>Create playlist</button>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
            {playlists.map((p) => (
              <PlaylistCard key={p.id} playlist={p} onClick={() => nav(`/playlist/${p.id}`)} />
            ))}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section className="mb-4">
          <h2 className="section-title mb-3"><span>🕐</span> Jump back in</h2>
          <div className="track-list">
            {recent.slice(0, 20).map((t, i) => (
              <TrackRow key={t.videoId + i} track={t} i={i} list={recent} onAdd={onAdd} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

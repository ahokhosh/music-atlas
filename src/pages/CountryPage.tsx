import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Playlist, type Track } from '../services/api'
import { usePlayer } from '../services/PlayerContext'
import { useUser } from '../services/UserContext'
import { getCountry } from '../data/countries'
import TrackRow from '../components/TrackRow'
import PlaylistCard from '../components/PlaylistCard'
import BackButton from '../components/BackButton'
import CountryFlag from '../components/CountryFlag'
import { TrackSkeleton, EmptyState } from '../components/Feedback'
import { toast } from '../components/Toast'
interface Props {
  code: string
  nav: (p: string) => void
  onAdd: (t: Track) => void
}

export default function CountryPage({ code, nav, onAdd }: Props) {
  const country = getCountry(code)
  const { playQueue, addToQueue } = usePlayer()
  const { user } = useUser()
  const [tab, setTab] = useState<'chart' | 'community'>('chart')
  const [visibleCount, setVisibleCount] = useState(20)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const [saving, setSaving] = useState(false)
  const pageRef = useRef(1)
  const loadingMoreRef = useRef(false)

  const loadMore = async () => {
    if (loadingMoreRef.current) return
    // Still have unrevealed loaded tracks? Just reveal them.
    if (visibleCount < tracks.length) {
      setVisibleCount((n) => n + 20)
      return
    }
    // Loaded list exhausted and server says more exists → fetch next page.
    // Page-based offset (not tracks.length): all-duplicate pages still
    // advance, so More can never get stuck fetching the same page.
    if (!hasMore) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const d = await api<{ tracks: Track[]; hasMore?: boolean }>(
        `/music/trending/${code}/more?offset=${pageRef.current * 20}`
      )
      pageRef.current += 1
      const fresh = (d.tracks || []).filter((t) => !tracks.some((x) => x.videoId === t.videoId))
      if (fresh.length) {
        setTracks((prev) => [...prev, ...fresh])
        setVisibleCount((n) => n + 20)
      }
      setHasMore(!!d.hasMore)
    } catch {
      toast('Could not load more', 'err')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }
  const [tracks, setTracks] = useState<Track[]>([])
  const [fallback, setFallback] = useState(false)
  const [loading, setLoading] = useState(true)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [plLoading, setPlLoading] = useState(true)

  const loadCommunity = useCallback(() => {
    setPlLoading(true)
    api<{ playlists: Playlist[] }>(`/playlists/public?country=${code}&limit=30`)
      .then((d) => setPlaylists(d.playlists || []))
      .catch(() => setPlaylists([]))
      .finally(() => setPlLoading(false))
  }, [code])

  useEffect(() => {
    if (!country) return
    let cancelled = false
    setTab('chart')
    setVisibleCount(20)
    setHasMore(true)
    setLoadingMore(false)
    loadingMoreRef.current = false
    pageRef.current = 1
    setLoading(true)
    setTracks([])
    setPlaylists([])
    api<{ tracks: Track[]; fallback?: boolean }>(`/music/trending/${code}`)
      .then((d) => {
        if (cancelled) return
        setTracks(d.tracks || [])
        setFallback(!!d.fallback)
      })
      .catch(() => { if (!cancelled) setTracks([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    loadCommunity()
    return () => { cancelled = true }
  }, [code, country])

  const saveChart = async () => {
    if (!user) {
      nav('/auth')
      return
    }
    if (!tracks.length) return
    setSaving(true)
    try {
      const res = await api<{ playlist: Playlist }>('/playlists/from-chart', {
        method: 'POST',
        body: JSON.stringify({
          name: `${country!.flag} ${country!.name} Top Hits`,
          country: code,
          tracks: tracks.slice(0, 30),
        }),
      })
      toast('Chart saved to your playlists 🎉')
      loadCommunity()
      nav(`/playlist/${res.playlist.id}`)
    } catch (e: any) {
      toast(e?.status === 401 ? 'Please sign in first' : 'Could not save chart', 'err')
    } finally {
      setSaving(false)
    }
  }

  if (!country) {
    return (
      <EmptyState
        icon="🧭" title="Country not found" sub="Pick another one from the Atlas."
        action={<button className="btn btn-primary" onClick={() => nav('/explore')}>Open Atlas</button>}
      />
    )
  }

  const hue = country.hue
  const flagUrl = `https://flagcdn.com/${country.code.toLowerCase()}.svg`
  return (
    <div className="animate-fade-in">
      <div className="relative -mx-4 overflow-hidden">
        {/* sharp flag banner */}
        <div
          className="relative h-44 sm:h-52 overflow-hidden"
          style={{ background: `linear-gradient(135deg, hsl(${hue},55%,26%), hsl(${(hue + 60) % 360},50%,12%))` }}
        >
          <img
            src={flagUrl}
            alt=""
            aria-hidden
            loading="eager"
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 45%, var(--bg) 100%)' }}
          />
          <div className="absolute top-4 left-4">
            <BackButton onClick={() => nav('/explore')} label="Back to Atlas" />
          </div>
          <span className="absolute bottom-3 right-4 text-[10px] font-bold tracking-[0.2em] text-white/70 uppercase">
            {country.code}
          </span>
        </div>

        {/* overlapping identity row */}
        <div className="px-4 relative">
          <div className="flex items-end gap-4 -mt-10">
            <CountryFlag code={country.code} hue={country.hue} circle className="w-[84px] shadow-2xl ring-4 ring-[#101019]" />
            <div className="min-w-0 pb-1">
              <h1 className="display text-[26px] font-extrabold leading-tight truncate drop-shadow-lg">{country.name}</h1>
              <p className="text-[12.5px] text-white/70 font-medium mt-0.5">{country.region} · Top Hits</p>
            </div>
          </div>

          <div className="flex gap-2 mt-4 mb-6">
            <button type="button" className="btn btn-primary !py-2.5 !px-4 !text-[13px] flex-1" disabled={!tracks.length} onClick={() => playQueue(tracks, 0)}>
              ▶ Play top hits
            </button>
            <button type="button" className="btn btn-soft !py-2.5 !px-4 !text-[13px]" disabled={!tracks.length || saving} onClick={saveChart} title="Save chart as playlist" aria-label="Save chart as playlist">
              {saving ? '⏳' : '💾'} Save
            </button>
            <button type="button" className="btn btn-soft !py-2.5 !px-3 !text-[13px]" disabled={!tracks.length} onClick={() => tracks.forEach(addToQueue)} title="Queue all" aria-label="Queue all tracks">
              ＋
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-2 mb-5">
        <button className={`pill ${tab === 'chart' ? 'active' : ''}`} onClick={() => setTab('chart')}>🔥 Top Charts</button>
        <button className={`pill ${tab === 'community' ? 'active' : ''}`} onClick={() => setTab('community')}>
          💜 Community {plLoading ? '' : `· ${playlists.length}`}
        </button>
      </div>

      {tab === 'chart' ? (
        <>
          {fallback && tracks.length > 0 && (
            <p className="text-[11px] text-amber-400/70 mb-3">
              Live chart for {country.name} is unavailable — showing global hits
            </p>
          )}
          <div className="track-list">
            {loading ? (
              <div className="p-2"><TrackSkeleton rows={8} /></div>
            ) : tracks.length ? (
              <>
                {tracks.slice(0, visibleCount).map((t, i) => <TrackRow key={`${t.videoId}-${i}`} track={t} i={i} list={tracks} onAdd={onAdd} />)}
                {(visibleCount < tracks.length || hasMore) && (
                  <button
                    className="w-full text-center text-[12.5px] font-bold text-violet-400 py-3 hover:text-violet-300 transition-colors disabled:opacity-50"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore
                      ? 'Loading more…'
                      : visibleCount < tracks.length
                        ? `More (${tracks.length - visibleCount} remaining) ↓`
                        : 'More ↓'}
                  </button>
                )}
              </>
            ) : (
              <EmptyState icon="📡" title="Chart unavailable" sub="Music sources are unreachable right now. Try again later." />
            )}
          </div>
        </>
      ) : plLoading ? (
        <TrackSkeleton rows={4} />
      ) : playlists.length ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {playlists.map((p) => (
            <PlaylistCard key={p.id} playlist={p} wide onClick={() => nav(`/playlist/${p.id}`)} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon="🕊️"
          title={`No playlists for ${country.name} yet`}
          sub="Save the chart above as your playlist, or create one from scratch — it will show up here."
          action={
            <div className="flex gap-2 justify-center">
              <button className="btn btn-primary !py-2.5" onClick={saveChart} disabled={!tracks.length || saving}>💾 Save this chart</button>
              <button className="btn btn-soft !py-2.5" onClick={() => nav(user ? '/library?new=1' : '/auth')}>＋ New</button>
            </div>
          }
        />
      )}
    </div>
  )
}

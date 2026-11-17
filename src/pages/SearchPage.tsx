import { useEffect, useMemo, useRef, useState } from 'react'
import { api, parseSoundCloudUrl, getRecent, clearRecent, type Track } from '../services/api'
import { usePlayer } from '../services/PlayerContext'
import { useUser } from '../services/UserContext'
import TrackRow from '../components/TrackRow'
import { TrackSkeleton, EmptyState } from '../components/Feedback'
import { toast } from '../components/Toast'
import { COUNTRIES } from '../data/countries'
import CountryFlag from '../components/CountryFlag'

const SUGGESTIONS = [
  'top hits 2026',
  'lofi study',
  'persian pop',
  'deep house mix',
  'afrobeats',
  'k-pop',
  'workout phonk',
  'reggaeton hits',
  'acoustic chill',
  'synthwave',
]

interface ScPlaylistInfo {
  id: number
  title: string
  description: string
  trackCount: number
  artworkUrl: string
  permalink: string
}

interface ScListItem {
  id: number
  title: string
  trackCount: number
  artworkUrl: string
  permalink: string
}

export default function SearchPage({ initialQuery, addPlaylistId, onAdd, nav }: { initialQuery?: string; addPlaylistId?: string | null; onAdd: (t: Track) => void; nav: (p: string) => void }) {
  const { playQueue } = usePlayer()
  const { user } = useUser()
  const [q, setQ] = useState(initialQuery || '')
  const [tracks, setTracks] = useState<Track[]>([])
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [scPl, setScPl] = useState<ScPlaylistInfo | null>(null)
  const [scPlTracks, setScPlTracks] = useState<Track[]>([])
  const [scLoading, setScLoading] = useState(false)
  const [scLists, setScLists] = useState<ScListItem[]>([])
  const [importing, setImporting] = useState(false)
  const [recent, setRecent] = useState<Track[]>(() => getRecent())
  const inputRef = useRef<HTMLInputElement>(null)
  const reqIdRef = useRef(0)

  // Refresh the local recent list whenever the box is cleared, so tracks
  // played on this same visit show up without a remount.
  useEffect(() => {
    if (!q.trim()) setRecent(getRecent())
  }, [q])

  // Country shortcut: match the query against country names/codes (client-side,
  // instant) so "japan", "iran", "de" … jump straight to that country's chart.
  const countryHits = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (query.length < 2) return []
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(query) || c.code.toLowerCase() === query
    ).slice(0, 6)
  }, [q])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const query = q.trim()
    const reqId = ++reqIdRef.current
    const alive = () => reqId === reqIdRef.current
    setScPl(null)
    setScPlTracks([])
    if (!query) {
      setTracks([])
      setScLists([])
      setSearched(false)
      setLoading(false)
      setScLoading(false)
      return
    }
    const link = parseSoundCloudUrl(query)
    if (link?.kind === 'playlist') {
      // SoundCloud set link → resolve the playlist instead of track search
      setLoading(false)
      setScLoading(true)
      const t = setTimeout(() => {
        api<{ playlist: ScPlaylistInfo; tracks: Track[] }>(`/music/soundcloud/playlist?url=${encodeURIComponent(link.url)}`)
          .then((d) => {
            if (!alive()) return
            setScPl(d.playlist)
            setScPlTracks(d.tracks || [])
            setSearched(true)
          })
          .catch(() => { if (alive()) setSearched(true) })
          .finally(() => { if (alive()) setScLoading(false) })
      }, 350)
      return () => clearTimeout(t)
    }
    // Debounced keyword search: spinner + stale results are cleared only
    // when the debounced request actually fires, and late responses from an
    // older query can never overwrite newer ones (reqId guard).
    const t = setTimeout(() => {
      if (!alive()) return
      setLoading(true)
      api<{ tracks: Track[]; source: string }>(`/music/search?q=${encodeURIComponent(query)}`)
        .then((d) => {
          if (!alive()) return
          setTracks(d.tracks || [])
          setSource(d.source || '')
          setSearched(true)
        })
        .catch(() => {
          if (!alive()) return
          setTracks([])
          setSearched(true)
        })
        .finally(() => { if (alive()) setLoading(false) })
      // Keyword playlist discovery (runs in parallel, never blocks tracks)
      api<{ playlists: ScListItem[] }>(`/music/sc/playlists?q=${encodeURIComponent(query)}`)
        .then((d) => { if (alive()) setScLists((d.playlists || []).slice(0, 6)) })
        .catch(() => { if (alive()) setScLists([]) })
    }, 400)
    return () => clearTimeout(t)
  }, [q])

  const importPlaylist = async () => {
    if (!user) {
      toast('Sign in to import playlists')
      nav('/auth')
      return
    }
    if (!scPl) return
    setImporting(true)
    try {
      const res = await api<{ playlist: { id: number }; added: number }>(`/playlists/import`, {
        method: 'POST',
        body: JSON.stringify({ url: scPl.permalink || q.trim() }),
      })
      toast(`Imported ${res.added} tracks 🎉`)
      nav(`/playlist/${res.playlist.id}`)
    } catch (e: any) {
      if (e?.code === 'is_track' && e?.track) toast('That is a single track — press play instead')
      else toast('Could not import playlist', 'err')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="pt-6 pb-4 flex items-center justify-between">
        <div>
          <h1 className="display text-2xl font-extrabold">Search</h1>
          <p className="text-[12px] text-(--muted) mt-0.5">Songs, artists, countries & playlists — or paste a music link</p>
        </div>
      </div>

      {addPlaylistId && (
        <div className="flex items-center gap-2 text-[12px] px-3 py-2 rounded-xl bg-violet-500/8 border border-violet-500/20 text-violet-300 mb-4">
          <span>Tap ＋ on any track to add it to your playlist.</span>
          <button type="button" className="font-bold underline underline-offset-2 ml-auto flex-shrink-0" onClick={() => nav(`/playlist/${addPlaylistId}`)}>
            Back to playlist
          </button>
        </div>
      )}

      <div className="relative mb-5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="absolute left-4 top-1/2 -translate-y-1/2 text-orange-400">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        {q && (
          <button type="button" aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 icon-btn !w-8 !h-8" onClick={() => setQ('')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        <input
          ref={inputRef}
          type="search"
          aria-label="Search songs, artists, countries, playlists"
          className="input !pl-11 border-orange-500/20 focus:border-orange-500"
          placeholder="Song, artist, country, playlist…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {!q.trim() && (
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[11px] font-semibold text-orange-400 uppercase tracking-wider">☁️ Instant Discovery</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="pill hover:border-orange-500/40 hover:text-orange-300" onClick={() => setQ(s)}>{s}</button>
            ))}
          </div>

          {recent.length > 0 ? (
            <div className="mt-7">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-orange-400 uppercase tracking-wider">🕘 Recently played</span>
                <button className="text-[11px] font-semibold text-(--muted) hover:text-red-400" onClick={() => { clearRecent(); setRecent([]) }}>
                  Clear
                </button>
              </div>
              <div className="track-list">
                {recent.map((t, i) => (
                  <TrackRow key={t.videoId + i} track={t} i={i} list={recent} onAdd={onAdd} />
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-7 text-[12px] text-(--muted)">Nothing here yet — play something and it will show up.</p>
          )}
        </div>
      )}

      {scLoading && (
        <div className="card p-2 mt-2"><TrackSkeleton rows={6} /></div>
      )}

      {!scLoading && scPl && (
        <div className="card p-4 mb-4 border border-orange-500/20">
          <div className="flex gap-4 items-center">
            <img
              src={scPl.artworkUrl}
              alt=""
              className="w-20 h-20 rounded-xl object-cover flex-shrink-0 bg-neutral-900"
              onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.2')}
            />
            <div className="flex-1 min-w-0">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300 font-bold">☁️ Playlist Set</span>
              <p className="text-[15px] font-bold text-white mt-1.5 truncate">{scPl.title}</p>
              <p className="text-[11.5px] text-(--muted)">{scPl.trackCount} tracks{scPl.description ? ` · ${scPl.description.slice(0, 80)}` : ''}</p>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn btn-primary flex-1 !py-2.5" disabled={!scPlTracks.length} onClick={() => playQueue(scPlTracks, 0)}>
              ▶ Play all
            </button>
            <button className="btn btn-soft !py-2.5" disabled={importing || !scPlTracks.length} onClick={importPlaylist}>
              {importing ? '⏳ Importing…' : '📚 Import to Library'}
            </button>
          </div>
          {scPlTracks.length > 0 && (
            <div className="mt-4">
              <div className="card !bg-transparent !border-0 p-1.5">
                {scPlTracks.slice(0, 10).map((t, i) => (
                  <TrackRow key={t.videoId + i} track={t} i={i} list={scPlTracks} onAdd={onAdd} />
                ))}
              </div>
              {scPlTracks.length > 10 && (
                <p className="text-[11px] text-(--muted) text-center mt-1">+ {scPlTracks.length - 10} more in this set</p>
              )}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="card p-2 mt-2"><TrackSkeleton rows={7} /></div>
      )}

      {!loading && q.trim() && countryHits.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-semibold text-(--muted) uppercase tracking-wider mb-2">🌍 Countries</p>
          <div className="flex flex-wrap gap-2">
            {countryHits.map((c) => (
              <button
                key={c.code}
                onClick={() => nav(`/country/${c.code}`)}
                className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-white/4 border border-white/10 hover:border-violet-500/40 transition-colors"
              >
                <CountryFlag code={c.code} hue={c.hue} circle className="w-6" />
                <span className="text-[12.5px] font-semibold">{c.name}</span>
                <span className="text-[11px] text-violet-400">chart →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!loading && q.trim() && scLists.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-semibold text-(--muted) uppercase tracking-wider mb-2">📚 Playlists</p>
          <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
            {scLists.map((p) => (
              <div
                key={p.id}
                onClick={() => nav(`/pack/${p.id}`)}
                className="flex-shrink-0 w-[132px] rounded-2xl overflow-hidden bg-white/[0.03] border border-white/8 hover:border-orange-500/30 transition-colors cursor-pointer"
              >
                {p.artworkUrl ? (
                  <img src={p.artworkUrl} alt="" loading="lazy" className="w-full aspect-square object-cover" onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.2')} />
                ) : (
                  <div className="w-full aspect-square flex items-center justify-center text-3xl bg-gradient-to-br from-orange-950 to-neutral-900">🎧</div>
                )}
                <p className="text-[12px] font-semibold px-2 pt-1.5 truncate">{p.title}</p>
                <p className="text-[10.5px] text-(--muted) px-2 pb-2">{p.trackCount} tracks</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !scPl && q.trim() && tracks.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {source.includes('soundcloud') ? (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 font-semibold flex items-center gap-1">
                  <span>☁️</span> Live ({tracks.length} tracks)
                </span>
              ) : (
                <span className="text-[11px] text-(--muted) font-medium">{tracks.length} tracks found</span>
              )}
            </div>
            <button className="text-[12px] font-semibold text-orange-400 hover:text-orange-300" onClick={() => playQueue(tracks, 0)}>
              Play all ▶
            </button>
          </div>

          <div className="track-list">
            {tracks.map((t, i) => (
              <TrackRow key={t.videoId + i} track={t} i={i} list={tracks} onAdd={onAdd} />
            ))}
          </div>
        </>
      )}

      {!loading && !scLoading && !scPl && searched && tracks.length === 0 && scLists.length === 0 && countryHits.length === 0 && (
        <EmptyState icon="🔍" title="No results" sub={`Nothing found for "${q}". Try different keywords or paste a direct music link.`} />
      )}
    </div>
  )
}

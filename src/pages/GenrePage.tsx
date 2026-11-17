import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Track } from '../services/api'
import { usePlayer } from '../services/PlayerContext'
import { useUser } from '../services/UserContext'
import TrackRow from '../components/TrackRow'
import BackButton from '../components/BackButton'
import { TrackSkeleton, EmptyState } from '../components/Feedback'
import { toast } from '../components/Toast'
import { getGenre } from '../data/genres'

interface Props {
  slug: string
  nav: (p: string) => void
  onAdd: (t: Track) => void
}

export default function GenrePage({ slug, nav, onAdd }: Props) {
  const genre = getGenre(slug)
  const { playQueue, addToQueue } = usePlayer()
  const { user } = useUser()
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<number | string | null>(null)
  const reqIdRef = useRef(0)

  const load = useCallback(async () => {
    if (!genre) return
    const reqId = ++reqIdRef.current
    const alive = () => reqId === reqIdRef.current
    setLoading(true)
    try {
      const d = await api<{ tracks: Track[] }>(`/music/genre/${genre.slug}`)
      if (!alive()) return
      setTracks(d.tracks || [])
    } catch {
      if (!alive()) return
      setTracks([])
    } finally {
      if (!alive()) return
      setLoading(false)
    }
  }, [genre])

  useEffect(() => {
    setTracks([])
    setSavedId(null)
    load()
    return () => { reqIdRef.current++ }
  }, [load])

  // Favorite: save the whole chart as a playlist in the user's library
  // (same mechanism as "Save chart" on country pages). A second tap opens it.
  const favoriteChart = async () => {
    if (savedId) {
      nav(`/playlist/${savedId}`)
      return
    }
    if (!user) {
      nav('/auth')
      return
    }
    if (!tracks.length) return
    setSaving(true)
    try {
      const res = await api<{ playlist: { id: number } }>('/playlists/from-chart', {
        method: 'POST',
        body: JSON.stringify({
          name: `❤️ ${genre!.name} Trending`,
          tracks: tracks.slice(0, 30),
        }),
      })
      setSavedId(res.playlist.id)
      toast('Added to your favorites ❤️')
    } catch {
      toast('Could not save favorites', 'err')
    } finally {
      setSaving(false)
    }
  }

  if (!genre) {
    return (
      <EmptyState
        icon="🎛️" title="Unknown genre" sub="Pick another one from home."
        action={<button className="btn btn-primary" onClick={() => nav('/')}>Back home</button>}
      />
    )
  }

  const hue = genre.hue
  return (
    <div className="animate-fade-in">
      <div className="relative -mx-4 overflow-hidden">
        <div
          className="relative h-40 sm:h-48 overflow-hidden"
          style={{ background: `linear-gradient(135deg, hsl(${hue},65%,30%), hsl(${(hue + 60) % 360},55%,12%))` }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.05) 45%, var(--bg) 100%)' }}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[92px] opacity-20 select-none">🎵</span>
          </div>
          <div className="absolute top-4 left-4">
            <BackButton onClick={() => nav('/')} label="Back home" />
          </div>
          <span className="absolute bottom-3 right-4 text-[10px] font-bold tracking-[0.2em] text-white/70 uppercase">
            Trending
          </span>
        </div>

        <div className="px-4 relative">
          <div className="-mt-8">
            <h1 className="display text-[26px] font-extrabold leading-tight drop-shadow-lg">{genre.name}</h1>
            <p className="text-[12.5px] text-white/70 font-medium mt-0.5">
              New & hot · {tracks.length} tracks
            </p>
          </div>

          <div className="flex gap-2 mt-4 mb-6">
            <button type="button" className="btn btn-primary !py-2.5 !px-4 !text-[13px] flex-1" disabled={!tracks.length} onClick={() => playQueue(tracks, 0)}>
              ▶ Play
            </button>
            <button type="button" className="btn btn-soft !py-2.5 !px-3 !text-[13px]" disabled={!tracks.length} onClick={() => tracks.forEach(addToQueue)} title="Queue all" aria-label="Queue all tracks">
              ＋
            </button>
            <button
              type="button"
              className="btn btn-soft !py-2.5 !px-3 !text-[13px]"
              disabled={!tracks.length || saving}
              onClick={favoriteChart}
              title={savedId ? 'Open in your library' : 'Add to favorites'}
              aria-label={savedId ? 'Open favorites' : 'Add to favorites'}
            >
              <svg
                width="15" height="15" viewBox="0 0 24 24"
                fill={savedId ? 'currentColor' : 'none'} stroke="currentColor"
                strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                className={savedId ? 'text-red-500' : ''}
              >
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="track-list">
        {loading ? (
          <div className="p-2"><TrackSkeleton rows={8} /></div>
        ) : tracks.length ? (
          tracks.map((t, i) => <TrackRow key={`${t.videoId}-${i}`} track={t} i={i} list={tracks} onAdd={onAdd} />)
        ) : (
          <EmptyState icon="📡" title="Chart unavailable" sub="Music sources are unreachable right now. Try again later." />
        )}
      </div>
    </div>
  )
}

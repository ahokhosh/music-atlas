import { useEffect, useRef, useState } from 'react'
import { api, type Track } from '../services/api'
import { usePlayer } from '../services/PlayerContext'
import TrackRow from '../components/TrackRow'
import BackButton from '../components/BackButton'
import { TrackSkeleton, EmptyState } from '../components/Feedback'

interface Pack {
  id: string
  name: string
  emoji: string
  category: string
  description: string
  tracksCount: number
  artwork: string | null
  permalink: string
}

interface Props {
  id: string
  nav: (p: string) => void
  onAdd: (t: Track) => void
}

const PACK_PAGE_SIZE = 30

export default function PackPage({ id, nav, onAdd }: Props) {
  const { playQueue, addToQueue } = usePlayer()
  const [pack, setPack] = useState<Pack | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [partial, setPartial] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const retriedRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const reqIdRef = useRef(0)

  const load = (fresh = false) => {
    const reqId = ++reqIdRef.current
    const alive = () => reqId === reqIdRef.current
    if (fresh) setRefreshing(true)
    else setLoading(true)
    setNotFound(false)
    api<{ pack: Pack; tracks: Track[]; total?: number; hasMore?: boolean; partial?: boolean }>(
      `/music/charts/${id}?limit=${PACK_PAGE_SIZE}&offset=0${fresh ? '&fresh=1' : ''}`
    )
      .then((d) => {
        if (!alive()) return
        setPack(d.pack)
        setTracks(d.tracks || [])
        setTotal(d.total ?? d.tracks?.length ?? 0)
        setHasMore(!!d.hasMore)
        const isPartial = !!d.partial
        setPartial(isPartial)
        // Incomplete on first try (flaky upstream) → one silent live retry.
        if (isPartial && !fresh && !retriedRef.current) {
          retriedRef.current = true
          load(true)
          return
        }
        setRefreshing(false)
        setLoading(false)
      })
      .catch(() => {
        if (!alive()) return
        setNotFound(true)
        setLoading(false)
        setRefreshing(false)
      })
  }

  // Next page appends to the loaded list (server slices its cumulative
  // cache, so paging is instant once the first page is warm).
  const loadMore = () => {
    if (loadingMoreRef.current || !hasMore) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    api<{ tracks: Track[]; total?: number; hasMore?: boolean }>(
      `/music/charts/${id}?limit=${PACK_PAGE_SIZE}&offset=${tracks.length}`
    )
      .then((d) => {
        const fresh = (d.tracks || []).filter((t) => !tracks.some((x) => x.videoId === t.videoId))
        if (fresh.length) setTracks((prev) => [...prev, ...fresh])
        if (typeof d.total === 'number') setTotal(d.total)
        setHasMore(!!d.hasMore)
      })
      .catch(() => { /* keep loaded tracks, More stays for retry */ })
      .finally(() => {
        loadingMoreRef.current = false
        setLoadingMore(false)
      })
  }

  useEffect(() => {
    retriedRef.current = false
    loadingMoreRef.current = false
    setPartial(false)
    setPack(null)
    setTracks([])
    setTotal(0)
    setHasMore(false)
    setLoadingMore(false)
    load()
    return () => { reqIdRef.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-[76px] h-[76px] rounded-2xl bg-white/5 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-2/3 bg-white/5 rounded animate-pulse" />
            <div className="h-3 w-1/3 bg-white/5 rounded animate-pulse" />
          </div>
        </div>
        <div className="track-list"><TrackSkeleton rows={8} /></div>
      </div>
    )
  }

  if (notFound || !pack) {
    return (
      <EmptyState
        icon="📦"
          title="Playlist unavailable"
          sub="This playlist could not be loaded right now."
        action={
          <div className="flex gap-2 justify-center">
            <button type="button" className="btn btn-soft !py-2" onClick={() => load(true)}>Try again</button>
            <button type="button" className="btn btn-primary !py-2" onClick={() => nav('/')}>Back home</button>
          </div>
        }
      />
    )
  }

  return (
    <div className="animate-fade-in">
      <div className="relative -mx-4 px-4 pt-5 pb-6 overflow-hidden bg-gradient-to-br from-orange-950 via-[#1c1410] to-neutral-900">
        <BackButton onClick={() => nav('/')} className="mb-2" />
        <div className="flex items-center gap-4">
          <div className="w-[76px] h-[76px] rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-neutral-900 flex-shrink-0 flex items-center justify-center text-[30px]">
            {pack.artwork ? (
              <img src={pack.artwork} alt="" loading="lazy" className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.2')} />
            ) : (
              <span>{pack.emoji}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-orange-400 uppercase tracking-wider mb-0.5">{pack.category}</p>
            <h1 className="display text-[24px] font-extrabold leading-tight truncate">{pack.name}</h1>
            <p className="text-[12.5px] text-white/55 font-medium">
              {total || pack.tracksCount || tracks.length} tracks
              {(hasMore || tracks.length < (total || pack.tracksCount || 0)) && tracks.length > 0 ? ` · showing ${tracks.length}` : ''}
            </p>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button type="button" className="btn btn-primary !py-2.5 !px-4 !text-[13px] flex-1" disabled={!tracks.length} onClick={() => playQueue(tracks, 0)}>
            ▶ Play playlist
          </button>
          <button type="button" className="btn btn-soft !py-2.5 !px-3 !text-[13px]" disabled={!tracks.length} onClick={() => tracks.forEach(addToQueue)} title="Queue all" aria-label="Queue all tracks">
            ＋
          </button>
          <button
            type="button"
            className="btn btn-soft !py-2.5 !px-3 !text-[13px]"
            disabled={refreshing}
            onClick={() => load(true)}
            title="Reload the full track list"
            aria-label="Reload track list"
          >
            <svg
              width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
              className={refreshing ? 'animate-spin' : ''}
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
      </div>

      <p className="text-[11px] text-(--muted) mt-3 mb-3 line-clamp-2">{pack.description}</p>

      {partial && !loading && tracks.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-[11.5px] px-3 py-2 rounded-xl bg-amber-500/8 border border-amber-500/20 text-amber-300 mb-2">
          <span>Showing {tracks.length} of {pack.tracksCount} — some tracks failed to load.</span>
          <button className="font-bold underline underline-offset-2 flex-shrink-0" onClick={() => load(true)}>Retry</button>
        </div>
      )}

      {tracks.length ? (
        <div className="track-list">
          {tracks.map((t, i) => <TrackRow key={`${t.videoId}-${i}`} track={t} i={i} list={tracks} onAdd={onAdd} />)}
          {hasMore && (
            <button
              className="w-full text-center text-[12.5px] font-bold text-orange-400 py-3 hover:text-orange-300 transition-colors disabled:opacity-50"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading more…' : `More (showing ${tracks.length} of ${total || pack.tracksCount || '…'}) ↓`}
            </button>
          )}
        </div>
      ) : (
        <EmptyState icon="🎧" title="No tracks in this playlist" sub="The playlist is empty or its tracks are unavailable right now." action={<button type="button" className="btn btn-soft !py-2" onClick={() => load(true)}>Try again</button>} />
      )}
    </div>
  )
}
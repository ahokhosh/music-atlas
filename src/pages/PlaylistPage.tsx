import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Playlist, type Track } from '../services/api'
import { usePlayer } from '../services/PlayerContext'
import { useUser } from '../services/UserContext'
import { getCountry } from '../data/countries'
import CoverArt from '../components/CoverArt'
import TrackRow from '../components/TrackRow'
import BackButton from '../components/BackButton'
import Modal from '../components/Modal'
import PlaylistFormModal from '../components/PlaylistFormModal'
import { TrackSkeleton, EmptyState } from '../components/Feedback'
import { toast } from '../components/Toast'

interface Props {
  id: number
  nav: (p: string) => void
  onAdd: (t: Track) => void
}

export default function PlaylistPage({ id, nav, onAdd }: Props) {
  const { playQueue } = usePlayer()
  const { user } = useUser()
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [songs, setSongs] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    api<{ playlist: Playlist; songs: Track[] }>(`/playlists/${id}`)
      .then((d) => {
        setPlaylist(d.playlist)
        setSongs(d.songs || [])
        setError('')
      })
      .catch((e: any) => setError(e?.status === 403 ? 'private' : 'missing'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    load()
    setShowDeleteConfirm(false)
  }, [load])

  // DB ids can come back as strings — compare numerically so the owner
  // actions (edit/delete) never silently disappear.
  const isOwner = !!user && !!playlist && Number(playlist.user_id) === Number(user.id)

  const doDelete = async () => {
    setDeleting(true)
    setDeleteError('')
    try {
      await api(`/playlists/${id}`, { method: 'DELETE' })
      toast('Playlist deleted')
      setShowDeleteConfirm(false)
      nav('/library')
    } catch (e: any) {
      setDeleteError(
        e?.status === 401
          ? 'Your session expired — please sign in again.'
          : e?.status === 403
            ? 'Only the owner can delete this playlist.'
            : 'Could not delete — check your connection and try again.'
      )
    } finally {
      setDeleting(false)
    }
  }

  const removeSong = async (songId?: number, idx?: number) => {
    if (!isOwner) return
    const targetIdx = songs.findIndex((s: any, i: number) => (songId != null ? s.id === songId : i === idx))
    if (targetIdx < 0) return
    const target = songs[targetIdx] as any
    const rowId = target.id
    // No row id (shouldn't happen, but never wipe the whole list):
    // remove optimistically by index only.
    setSongs((s) => s.filter((_, i) => i !== targetIdx))
    if (rowId == null) {
      load()
      return
    }
    try {
      await api(`/playlists/${id}/songs/${rowId}`, { method: 'DELETE' })
      setPlaylist((p) => (p ? { ...p, song_count: Math.max(0, (p.song_count || 1) - 1) } : p))
      toast('Removed')
    } catch {
      toast('Could not remove', 'err')
      load()
    }
  }

  const movingRef = useRef(false)
  const move = async (idx: number, dir: -1 | 1) => {
    if (!isOwner || movingRef.current) return
    const ni = idx + dir
    if (ni < 0 || ni >= songs.length) return
    movingRef.current = true
    const next = [...songs]
    ;[next[idx], next[ni]] = [next[ni], next[idx]]
    setSongs(next)
    try {
      await api(`/playlists/${id}/reorder`, {
        method: 'POST',
        body: JSON.stringify({ ids: next.map((s: any) => s.id) }),
      })
    } catch {
      toast('Reorder failed', 'err')
      load()
    } finally {
      movingRef.current = false
    }
  }

  if (loading) {
    return (
      <div className="animate-fade-in pt-6">
        <div className="flex gap-4 items-end mb-6">
          <div className="skeleton w-32 h-32 rounded-3xl" />
          <div className="flex-1 space-y-3 pb-2">
            <div className="skeleton h-5 w-2/3 rounded-lg" />
            <div className="skeleton h-3.5 w-1/3 rounded-lg" />
          </div>
        </div>
        <TrackSkeleton rows={5} />
      </div>
    )
  }

  if (error === 'private') {
    return <EmptyState icon="🔒" title="Private playlist" sub="Only the owner can see this playlist." action={<button className="btn btn-primary" onClick={() => nav('/')}>Go home</button>} />
  }
  if (error || !playlist) {
    return <EmptyState icon="❓" title="Playlist not found" action={<button className="btn btn-primary" onClick={() => nav('/')}>Go home</button>} />
  }

  const country = getCountry(playlist.country)

  return (
    <div className="animate-fade-in">
      <div className="pt-5 flex items-center justify-between">
        <BackButton onClick={() => nav('/')} />
        {isOwner && (
          <div className="flex gap-1">
            <button type="button" className="icon-btn" title="Edit playlist" aria-label="Edit playlist" onClick={() => setEditing(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Delete playlist"
              aria-label="Delete playlist"
              onClick={() => {
                setDeleteError('')
                setShowDeleteConfirm(true)
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>
            </button>
          </div>
        )}
      </div>
      <div className="flex items-end gap-4 mt-3 mb-5">
        <CoverArt
          gradient={playlist.cover_gradient}
          emoji={playlist.cover_emoji}
          seed={playlist.name + playlist.id}
          className="w-32 h-32 rounded-3xl shadow-2xl flex-shrink-0"
          emojiSize="text-5xl"
        />
        <div className="min-w-0 pb-1">
          {country && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/6 border border-white/8 text-[10.5px] font-semibold mb-1.5">
              {country.flag} {country.name}
            </span>
          )}
          <h1 className="display text-[22px] font-extrabold leading-tight">{playlist.name}</h1>
          <p className="text-[12px] text-(--text-dim) mt-1">
            {playlist.owner_name} · {songs.length} tracks {playlist.is_public ? '· public' : '· private'}
          </p>
        </div>
      </div>

      {playlist.description && (
        <p className="text-[13px] text-(--text-dim) mb-4">{playlist.description}</p>
      )}

      <div className="flex gap-2 mb-5">
        <button className="btn btn-primary flex-1 !py-2.5" disabled={!songs.length} onClick={() => playQueue(songs, 0)}>
          ▶ Play all
        </button>
        {isOwner && (
          <button className="btn btn-soft !py-2.5" onClick={() => nav(`/search?add=${id}`)}>
            ＋ Add songs
          </button>
        )}
      </div>

      {songs.length === 0 ? (
        <EmptyState
          icon="🎵"
          title="Empty playlist"
          sub={isOwner ? 'Add songs via search — they will play in full length.' : 'The owner has not added tracks yet.'}
          action={isOwner ? <button className="btn btn-primary" onClick={() => nav(`/search?add=${id}`)}>Find songs</button> : undefined}
        />
      ) : (
        <div className="track-list">
          {songs.map((s, i) => (
            <div key={`${(s as any).id ?? s.videoId}-${i}`} className="relative">
              <TrackRow track={s} i={i} list={songs} onAdd={onAdd} />
              {isOwner && (
                <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col bg-[#12121c] border border-white/10 rounded-lg overflow-hidden" style={{ right: 8 }}>
                  <button type="button" className="icon-btn !w-7 !h-7 !rounded-none border-b border-white/8" onClick={() => move(i, -1)} title="Move up" aria-label="Move track up">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><polyline points="18,15 12,9 6,15" /></svg>
                  </button>
                  <button type="button" className="icon-btn !w-7 !h-7 !rounded-none border-b border-white/8" onClick={() => move(i, 1)} title="Move down" aria-label="Move track down">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><polyline points="6,9 12,15 18,9" /></svg>
                  </button>
                  <button type="button" className="icon-btn !w-7 !h-7 !rounded-none hover:!text-red-400" onClick={() => removeSong((s as any).id, i)} title="Remove from playlist" aria-label="Remove track from playlist">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isOwner && (
        <PlaylistFormModal
          open={editing}
          editing={playlist}
          onClose={() => setEditing(false)}
          onSaved={(p) => setPlaylist(p)}
        />
      )}

      <Modal open={showDeleteConfirm} onClose={() => !deleting && setShowDeleteConfirm(false)} title="Delete playlist?">
        <p className="text-[13.5px] text-(--text-dim) leading-relaxed">
          <span className="font-bold text-white">“{playlist.name}”</span> and its{' '}
          {songs.length} track{songs.length === 1 ? '' : 's'} will be permanently removed.
          This cannot be undone.
        </p>
        {deleteError && (
          <p className="text-[12.5px] text-red-400 bg-red-500/8 border border-red-500/20 rounded-xl px-3 py-2 mt-3">
            {deleteError}
          </p>
        )}
        <div className="flex gap-2 justify-end mt-5">
          <button className="btn btn-ghost" disabled={deleting} onClick={() => setShowDeleteConfirm(false)}>
            Cancel
          </button>
          <button
            className="btn !bg-red-500/15 !text-red-300 border border-red-500/30 hover:!bg-red-500/25"
            disabled={deleting}
            onClick={doDelete}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

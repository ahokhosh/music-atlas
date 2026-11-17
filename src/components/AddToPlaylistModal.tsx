import { useEffect, useState } from 'react'
import Modal from './Modal'
import { api, type Playlist, type Track } from '../services/api'
import { toast } from './Toast'
import CoverArt from './CoverArt'

interface Props {
  open: boolean
  track: Track | null
  onClose: () => void
  onNeedAuth: () => void
  onGoLibrary: () => void
}

export default function AddToPlaylistModal({ open, track, onClose, onNeedAuth, onGoLibrary }: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [adding, setAdding] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    reload()
  }, [open])

  const reload = () => {
    setLoading(true)
    setLoadError(false)
    api<{ playlists: Playlist[] }>('/playlists/mine')
      .then((d) => setPlaylists(d.playlists || []))
      .catch((e) => {
        if (e?.status === 401) onNeedAuth()
        else setLoadError(true)
      })
      .finally(() => setLoading(false))
  }

  const add = async (p: Playlist) => {
    if (!track) return
    setAdding(p.id)
    try {
      const res = await api<{ duplicate: boolean }>(`/playlists/${p.id}/songs`, {
        method: 'POST',
        body: JSON.stringify(track),
      })
      toast(res.duplicate ? 'Already in this playlist' : `Added to "${p.name}"`, res.duplicate ? 'err' : 'ok')
      onClose()
    } catch (e: any) {
      if (e?.status === 401) onNeedAuth()
      else toast('Could not add track', 'err')
    } finally {
      setAdding(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add to playlist">
      {loading ? (
        <div className="space-y-2 py-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-14 rounded-xl" />)}
        </div>
      ) : loadError ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-3">📡</div>
          <p className="text-sm font-semibold mb-1">Could not load playlists</p>
          <p className="text-xs text-(--text-dim) mb-4">Check your connection and try again.</p>
          <button type="button" className="btn btn-soft" onClick={reload}>Try again</button>
        </div>
      ) : playlists.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-3">🎧</div>
          <p className="text-sm font-semibold mb-1">No playlists yet</p>
          <p className="text-xs text-(--text-dim) mb-4">Create one from the Library tab, then add songs.</p>
          <button type="button" className="btn btn-primary" onClick={onGoLibrary}>Go to Library</button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {playlists.map((p) => (
            <button
              key={p.id}
              className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 text-left transition-colors"
              onClick={() => add(p)}
              disabled={adding === p.id}
            >
              <CoverArt
                gradient={p.cover_gradient}
                emoji={p.cover_emoji}
                seed={p.name + p.id}
                className="w-11 h-11 rounded-xl flex-shrink-0"
                emojiSize="text-xl"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold truncate">{p.name}</p>
                <p className="text-[11px] text-(--muted)">{p.song_count ?? 0} tracks</p>
              </div>
              {adding === p.id ? (
                <span className="eq"><span /><span /><span /></span>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="text-(--text-dim)">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

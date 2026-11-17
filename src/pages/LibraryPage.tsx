import { useCallback, useEffect, useState } from 'react'
import { api, clearRecent, getRecent, type Playlist, type Track } from '../services/api'
import { useUser } from '../services/UserContext'
import { getCountry } from '../data/countries'
import PlaylistCard from '../components/PlaylistCard'
import PlaylistFormModal from '../components/PlaylistFormModal'
import Modal from '../components/Modal'
import { toast } from '../components/Toast'
import { EmptyState } from '../components/Feedback'

interface Props {
  nav: (p: string) => void
  openNew: boolean
  onCloseNew: () => void
}

export default function LibraryPage({ nav, openNew, onCloseNew }: Props) {
  const { user, logout } = useUser()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(openNew)
  const [showImport, setShowImport] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  // Snapshot recents once per mount (not JSON.parse on every render).
  const [recent, setRecent] = useState<Track[]>(() => getRecent())

  // Navigating to /library?new=1 while already on /library must open the form.
  useEffect(() => {
    if (openNew) setShowForm(true)
  }, [openNew])

  const runImport = async () => {
    const url = importUrl.trim()
    if (!url) return
    setImporting(true)
    try {
      const res = await api<{ playlist: Playlist; added: number }>('/playlists/import', {
        method: 'POST',
        body: JSON.stringify({ url }),
      })
      setShowImport(false)
      setImportUrl('')
      load()
      nav(`/playlist/${res.playlist.id}`)
    } catch (e: any) {
      if (e?.code === 'is_track') toast('That link is a single track — add it via search instead', 'err')
      else toast(e?.code === 'playlist_not_found' ? 'Playlist not found' : 'Could not import that link', 'err')
    } finally {
      setImporting(false)
    }
  }

  const load = useCallback(() => {
    setLoading(true)
    api<{ playlists: Playlist[] }>('/playlists/mine')
      .then((d) => setPlaylists(d.playlists || []))
      .catch(() => setPlaylists([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (user) load()
    else {
      setLoading(false)
      // Never flash the previous user's playlists after sign-out.
      setPlaylists([])
      setRecent([])
    }
  }, [user, load])

  if (!user) {
    return (
      <div className="animate-fade-in">
        <EmptyState
          icon="🎧"
          title="Your music space"
          sub="Sign in to create playlists, save country charts and build your library."
          action={<button className="btn btn-primary" onClick={() => nav('/auth')}>Sign in / Create account</button>}
        />
      </div>
    )
  }

  const country = getCountry(user.country)

  return (
    <div className="animate-fade-in">
      <div className="pt-6 pb-5 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg"
            style={{ background: 'linear-gradient(135deg,#8b5cf6,#ec4899)' }}
          >
            {user.username[0].toUpperCase()}
          </div>
          <div>
            <h1 className="display text-xl font-extrabold leading-tight">{user.username}</h1>
            <p className="text-[12px] text-(--text-dim)">
              {country ? `${country.flag} ${country.name}` : user.email}
            </p>
          </div>
        </div>
        <button className="btn btn-ghost !text-[12px]" onClick={logout}>Sign out</button>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="section-title">Your playlists · {playlists.length}</h2>
        <div className="flex gap-2">
          <button className="btn btn-soft !py-2 !px-4 !text-[12.5px]" onClick={() => setShowImport(true)}>
            ☁️ Import
          </button>
          <button className="btn btn-primary !py-2 !px-4 !text-[12.5px]" onClick={() => nav('/library?new=1')}>
            ＋ New
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton aspect-square rounded-2xl" />)}
        </div>
      ) : playlists.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="📔"
            title="No playlists yet"
            sub="Create your first playlist, or save a country chart from the Atlas."
            action={<button className="btn btn-primary" onClick={() => nav('/library?new=1')}>Create playlist</button>}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {playlists.map((p) => (
            <PlaylistCard key={p.id} playlist={p} wide onClick={() => nav(`/playlist/${p.id}`)} />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <section className="mt-8 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">Recently played</h2>
            <button className="text-[12px] font-semibold text-(--muted) hover:text-red-400" onClick={() => { clearRecent(); setRecent([]) }}>
              Clear
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 pb-1">
            {recent.map((t, i) => (
              <div key={`${t.videoId}-${i}`} className="card card-hover w-[120px] flex-shrink-0 overflow-hidden cursor-pointer" onClick={() => nav(`/search?q=${encodeURIComponent(t.title)}`)}>
                <img src={t.thumbnail} alt="" loading="lazy" className="w-full aspect-square object-cover" onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.2')} />
                <p className="text-[11.5px] font-semibold px-2 pt-1.5 truncate">{t.title}</p>
                <p className="text-[10.5px] text-(--muted) px-2 pb-2 truncate">{t.artist}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <PlaylistFormModal
        open={showForm}
        defaultCountry={user.country || undefined}
        onClose={() => {
          setShowForm(false)
          if (openNew) onCloseNew()
        }}
        onSaved={(p) => {
          load()
          nav(`/playlist/${p.id}`)
        }}
      />

      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import playlist">
        <div className="space-y-3">
          <p className="text-[12.5px] text-(--text-dim)">
            Paste a playlist (set) link — every track will be copied into a new playlist in your library.
          </p>
          <input
            className="input w-full border-orange-500/20 focus:border-orange-500"
            placeholder="Paste a playlist link here"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runImport()}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button className="btn btn-ghost !text-[12.5px]" onClick={() => setShowImport(false)}>Cancel</button>
            <button className="btn btn-primary !text-[12.5px]" disabled={importing || !importUrl.trim()} onClick={runImport}>
              {importing ? '⏳ Importing…' : '☁️ Import playlist'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

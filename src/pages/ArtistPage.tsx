import { useState, useEffect } from 'react'
import { api, fmtTime, type Track } from '../services/api'
import { usePlayer } from '../services/PlayerContext'

interface ArtistInfo {
  name: string
  avatar: string
  tracks: Track[]
}

export default function ArtistPage({ name, nav }: { name: string; nav: (to: string) => void }) {
  const [artist, setArtist] = useState<ArtistInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { playQueue, current } = usePlayer()
  let decodedName = name
  try { decodedName = decodeURIComponent(name) } catch { /* use raw */ }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api<ArtistInfo>(`/music/artist/${encodeURIComponent(decodedName)}`)
      .then((data) => { if (!cancelled) { setArtist(data); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError('Could not load this artist — check your connection and try again'); setLoading(false) } })
    return () => { cancelled = true }
  }, [decodedName])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          <p className="text-white/50 text-sm">Loading artist...</p>
        </div>
      </div>
    )
  }

  if (error || !artist) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <p className="text-white/50 text-lg mb-2">Artist not found</p>
          <p className="text-white/30 text-sm">{error}</p>
          <div className="mt-4 flex gap-2 justify-center">
            <button onClick={() => nav('/')} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors">
              Go Home
            </button>
          </div>
        </div>
      </div>
    )
  }

  const isCurrentTrack = (track: Track) => current?.videoId === track.videoId

  return (
    <div className="pb-32">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-b from-violet-600/30 via-transparent to-transparent" />
        <div className="relative px-6 pt-12 pb-6">
          <button onClick={() => nav('/')} className="icon-btn mb-6" aria-label="Back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex flex-col items-center text-center">
            <div className="w-32 h-32 rounded-full overflow-hidden bg-white/10 border-4 border-white/20 shadow-2xl mb-4">
              {artist.avatar ? (
                <img src={artist.avatar.replace('-large', '-t500x500')} alt={artist.name} loading="lazy" className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.2')} />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500 to-purple-600">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/80">
                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
              )}
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">{artist.name}</h1>
            <p className="text-white/50 text-sm">{artist.tracks.length} tracks</p>
            {artist.tracks.length > 0 && (
              <button onClick={() => playQueue(artist.tracks, 0)} className="mt-4 px-6 py-2.5 rounded-full bg-violet-500 hover:bg-violet-600 text-white font-semibold text-sm transition-colors flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.54-6.86a1.05 1.05 0 0 0 0-1.76L9.56 4.26A1.04 1.04 0 0 0 8 5.14z" /></svg>
                Play All
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="px-4">
        <h2 className="text-lg font-semibold text-white mb-3">Tracks</h2>
        {artist.tracks.length === 0 ? (
          <p className="text-white/40 text-sm">No playable tracks found for this artist yet.</p>
        ) : (
        <div className="space-y-1">
          {artist.tracks.map((track, index) => (
            <div
              key={`${track.videoId}-${index}`}
              role="button"
              tabIndex={0}
              aria-label={`Play ${track.title} by ${track.artist}`}
              className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors ${isCurrentTrack(track) ? 'bg-violet-500/20' : 'hover:bg-white/5'}`}
              onClick={() => playQueue(artist.tracks, index)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playQueue(artist.tracks, index) } }}
            >
              <div className="w-8 text-center">
                {isCurrentTrack(track) ? (
                  <div className="flex items-center justify-center gap-0.5">
                    <span className="w-0.5 h-3 bg-violet-400 rounded-full animate-pulse" />
                    <span className="w-0.5 h-4 bg-violet-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                    <span className="w-0.5 h-2 bg-violet-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
                  </div>
                ) : (
                  <span className="text-white/30 text-sm">{index + 1}</span>
                )}
              </div>
              <img src={track.thumbnail} alt={track.title} loading="lazy" className="w-12 h-12 rounded-lg object-cover bg-white/5" onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.2')} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${isCurrentTrack(track) ? 'text-violet-400' : 'text-white'}`}>{track.title}</p>
                <p className="text-xs text-white/40 truncate">{track.artist}</p>
              </div>
              <span className="text-xs text-white/30 tabular-nums">{fmtTime(track.duration)}</span>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  )
}

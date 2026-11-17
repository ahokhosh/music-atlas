import { usePlayer } from '../services/PlayerContext'
import { fmtTime, type Track } from '../services/api'

interface Props {
  track: Track
  i?: number
  list?: Track[]
  onAdd?: (track: Track) => void
  compact?: boolean
}

export default function TrackRow({ track, list, onAdd, compact }: Props) {
  const { current, isPlaying, playQueue, addToQueue } = usePlayer()
  const playing = current?.videoId === track.videoId
  const active = playing && isPlaying

  const activate = () => {
    if (playing && isPlaying) return
    if (list && list.length) playQueue(list, list.indexOf(track) >= 0 ? list.indexOf(track) : 0)
    else playQueue([track], 0)
  }

  return (
    <div
      className={`track-card group ${playing ? 'playing' : ''}`}
      onClick={activate}
      role="button"
      tabIndex={0}
      aria-label={`Play ${track.title} by ${track.artist}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() } }}
    >
      <div className="track-art" style={compact ? { width: 44, height: 44, borderRadius: 12 } : undefined}>
        <img
          src={track.thumbnail}
          alt=""
          loading="lazy"
          onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.2')}
        />
        <span className={`veil ${active ? 'on' : ''}`}>
          {active ? (
            <span className="eq"><span /><span /><span /></span>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" opacity="0.95">
              <polygon points="7,4 20,12 7,20" />
            </svg>
          )}
        </span>
        <span className="track-dur">{fmtTime(track.duration)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="t-title text-[14px] font-semibold truncate">{track.title}</p>
        <p className="text-[12px] text-(--text-dim) truncate mt-0.5">{track.artist}</p>
      </div>
      <button
        type="button"
        className="track-act"
        title="Add to queue"
        aria-label={`Add ${track.title} to queue`}
        onClick={(e) => {
          e.stopPropagation()
          addToQueue(track)
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="3" y1="6" x2="13" y2="6" /><line x1="3" y1="12" x2="13" y2="12" />
          <line x1="3" y1="18" x2="9" y2="18" /><path d="M16 12v8m4-4h-8" />
        </svg>
      </button>
      {onAdd && (
        <button
          type="button"
          className="track-act"
          title="Add to playlist"
          aria-label={`Add ${track.title} to playlist`}
          onClick={(e) => {
            e.stopPropagation()
            onAdd(track)
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
    </div>
  )
}

import { gradientFor } from './CoverArt'
import { getCountry } from '../data/countries'
import type { Playlist } from '../services/api'

interface Props {
  playlist: Playlist
  onClick?: (p: Playlist) => void
  wide?: boolean
}

export default function PlaylistCard({ playlist, onClick, wide }: Props) {
  const country = getCountry(playlist.country)
  return (
    <button
      className={`card card-hover overflow-hidden text-left ${wide ? 'w-full' : 'w-[150px] flex-shrink-0'}`}
      onClick={() => onClick?.(playlist)}
    >
      <div
        className="relative w-full aspect-square"
        style={{
          background: playlist.thumbnail
            ? 'transparent'
            : (playlist.cover_gradient || gradientFor(playlist.name + playlist.id)),
        }}
      >
        {playlist.thumbnail ? (
          <img
            src={playlist.thumbnail}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[44px] drop-shadow-lg select-none">{playlist.cover_emoji || '🎵'}</span>
          </div>
        )}
        {country && (
          <span className="absolute top-2 right-2 w-7 h-7 rounded-full glass flex items-center justify-center text-[15px]">
            {country.flag}
          </span>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-[13px] font-semibold truncate">{playlist.name}</p>
        <p className="text-[11px] text-(--muted) truncate mt-0.5">
          {playlist.song_count ?? 0} tracks · {playlist.owner_name}
        </p>
      </div>
    </button>
  )
}

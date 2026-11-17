import { usePlayer } from '../services/PlayerContext'

export default function MiniPlayer() {
  const { current, isPlaying, loading, position, duration, toggle, prev, next, setSheetOpen, close } = usePlayer()
  if (!current) return null
  const pct = duration ? (position / duration) * 100 : 0

  return (
    <div
      className="fixed left-0 right-0 z-[60] px-3 pointer-events-none"
      style={{ bottom: 'calc(var(--nav-h) + 8px + env(safe-area-inset-bottom, 0px))' }}
    >
      <div
        className="pointer-events-auto relative max-w-[648px] mx-auto rounded-[24px] border border-white/12 shadow-[0_12px_40px_rgba(0,0,0,0.55)] overflow-hidden cursor-pointer"
        style={{ background: '#14141f' }}
        onClick={() => setSheetOpen(true)}
      >
        <button
          className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/50 border border-white/15 text-white/80 flex items-center justify-center hover:bg-black/80 hover:text-white active:scale-90 transition-all"
          aria-label="Close player"
          title="Close player"
          onClick={(e) => {
            e.stopPropagation()
            close()
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="flex items-center gap-4 p-3.5">
          <div className="relative flex-shrink-0">
            <img
              src={current.thumbnail}
              alt=""
              className="w-36 h-36 sm:w-40 sm:h-40 rounded-3xl object-cover bg-white/5 shadow-2xl"
            />
            {isPlaying && !loading && (
              <span className="absolute bottom-2.5 left-2.5 flex items-center px-2.5 py-1.5 rounded-full bg-black/55 border border-white/15 backdrop-blur-md">
                <span className="eq"><span /><span /><span /></span>
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
            <p className="text-[15px] font-bold truncate leading-snug">{current.title}</p>
            <p className="text-[12.5px] text-(--text-dim) truncate">
              {loading ? 'Loading…' : current.artist}
            </p>
            <div className="flex items-center gap-6 mt-2">
              <button
                className="flex items-center justify-center h-11 w-11 text-white transition-transform hover:scale-105 active:scale-95"
                aria-label="Previous"
                onClick={(e) => {
                  e.stopPropagation()
                  prev()
                }}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4a1 1 0 0 0-1 1v14a1 1 0 1 0 2 0V5a1 1 0 0 0-1-1Zm14.955.23L6 12.003l12.955 7.772A1.35 1.35 0 0 0 21 18.617V5.387a1.35 1.35 0 0 0-2.045-1.157Z" /></svg>
              </button>
              <button
                className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-transform"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                onClick={(e) => {
                  e.stopPropagation()
                  toggle()
                }}
              >
                {loading ? (
                  <span className="rounded-full border-2 border-black/20 border-t-black animate-spin" style={{ width: 24, height: 24 }} />
                ) : isPlaying ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                ) : (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.54-6.86a1.05 1.05 0 0 0 0-1.76L9.56 4.26A1.04 1.04 0 0 0 8 5.14z" /></svg>
                )}
              </button>
              <button
                className="flex items-center justify-center h-11 w-11 text-white transition-transform hover:scale-105 active:scale-95"
                aria-label="Next"
                onClick={(e) => {
                  e.stopPropagation()
                  next()
                }}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M20 20a1 1 0 0 0 1-1V5a1 1 0 0 0-2 0v14a1 1 0 0 0 1 1Zm-14.955-.226L18 12 5.045 4.228A1.35 1.35 0 0 0 3 5.386v13.23a1.35 1.35 0 0 0 2.045 1.158Z" /></svg>
              </button>
            </div>
          </div>
        </div>
        <div className="h-[3px] bg-white/8">
          <div
            className="h-full rounded-r-full transition-[width] duration-300"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' }}
          />
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { usePlayer } from '../services/PlayerContext'
import { fmtTime, downloadTrack } from '../services/api'
import BackButton from './BackButton'

function RepeatIcon({ mode }: { mode: 'off' | 'all' | 'one' }) {
  return (
    <span className="relative">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" />
        <path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" />
      </svg>
      {mode === 'one' && (
        <span className="absolute -top-1.5 -right-2 text-[9px] font-bold text-violet-400">1</span>
      )}
    </span>
  )
}

export default function NowPlaying() {
  const {
    current, isPlaying, loading, position, duration,
    shuffle, repeat, queue, sheetOpen,
    toggle, next, prev, seek, toggleShuffle, cycleRepeat, jumpTo, setSheetOpen,
  } = usePlayer()
  const [tab, setTab] = useState<'cover' | 'queue'>('cover')
  const [downloading, setDownloading] = useState(false)
  const handleDownload = async () => {
    if (!current || downloading) return
    setDownloading(true)
    try { await downloadTrack(current) } finally { setDownloading(false) }
  }
  if (!current || !sheetOpen) return null

  const pct = duration ? (position / duration) * 100 : 0
  const art = current.thumbnail

  const handleArtistClick = () => {
    if (current?.artist) {
      window.location.hash = `/artist/${encodeURIComponent(current.artist)}`
      setSheetOpen(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] animate-fade-in">
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[#06060d]" />
        <img src={art} alt="" className="w-full h-full object-cover scale-150 blur-3xl opacity-25" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/85 to-black/95" />
      </div>

      <div className="relative h-full flex flex-col px-6" style={{ paddingTop: 'calc(14px + env(safe-area-inset-top, 0px))' }}>
        <div className="flex items-center justify-between py-2">
          <BackButton onClick={() => setSheetOpen(false)} label="Minimize" />
          <div className="flex gap-1 p-1 rounded-full bg-white/5 border border-white/10">
            {(['cover', 'queue'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-full text-[12px] font-semibold transition-all ${tab === t ? 'bg-white text-black' : 'text-white/60'}`}
              >
                {t === 'cover' ? 'Playing' : `Queue · ${queue.length}`}
              </button>
            ))}
          </div>
          <div className="w-[38px]" />
        </div>
        {tab === 'cover' ? (
          <div className="flex-1 flex flex-col gap-4 max-w-md w-full mx-auto min-h-0">
            <div className="relative mx-auto w-full aspect-square max-w-[360px] rounded-3xl overflow-hidden shadow-2xl animate-scale-in">
              <img src={art} alt="" className={`w-full h-full object-cover ${isPlaying ? '' : 'grayscale-[40%] opacity-80'}`} />
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <span className="eq" style={{ height: 28 }}><span style={{ width: 5 }} /><span style={{ width: 5 }} /><span style={{ width: 5 }} /></span>
                </div>
              )}
              {!loading && isPlaying && (
                <div className="absolute bottom-3 left-3 flex items-center px-3 py-2 rounded-full bg-black/55 border border-white/15 backdrop-blur-md">
                  <span className="eq"><span /><span /><span /></span>
                </div>
              )}
            </div>

            <div className="text-center min-w-0">
              <h2 className="text-xl font-bold line-clamp-2">{current.title}</h2>
            </div>

            <div>
              <input
                type="range"
                aria-label="Seek"
                className="slider"
                min={0}
                max={duration || current.duration || 100}
                step={0.1}
                value={position}
                style={{ ['--fill' as any]: `${pct}%` }}
                onChange={(e) => seek(Number(e.target.value))}
              />
              <div className="flex justify-between text-[11px] text-white/45 mt-1.5 tabular-nums">
                <span>{fmtTime(position)}</span>
                <span>{fmtTime(duration || current.duration)}</span>
              </div>
            </div>

            <div className="flex items-center justify-center gap-4 sm:gap-5">
              <button
                className="flex items-center justify-center h-9 w-9 text-white transition-transform hover:scale-105 active:scale-95"
                onClick={handleDownload} title="Download" aria-label="Download"
                disabled={downloading}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7,10 12,15 17,10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
              <button
                className="flex items-center justify-center h-12 w-12 text-white transition-transform hover:scale-105 active:scale-95"
                onClick={prev} title="Previous" aria-label="Previous"
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4a1 1 0 0 0-1 1v14a1 1 0 1 0 2 0V5a1 1 0 0 0-1-1Zm14.955.23L6 12.003l12.955 7.772A1.35 1.35 0 0 0 21 18.617V5.387a1.35 1.35 0 0 0-2.045-1.157Z" /></svg>
              </button>
              <button
                className="w-[72px] h-[72px] rounded-full flex items-center justify-center bg-white text-black shadow-lg transition-transform active:scale-95"
                onClick={toggle} title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.2" /><rect x="14" y="4" width="4" height="16" rx="1.2" /></svg>
                ) : (
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.54-6.86a1.05 1.05 0 0 0 0-1.76L9.56 4.26A1.04 1.04 0 0 0 8 5.14z" /></svg>
                )}
              </button>
              <button
                className="flex items-center justify-center h-12 w-12 text-white transition-transform hover:scale-105 active:scale-95"
                onClick={next} title="Next" aria-label="Next"
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M20 20a1 1 0 0 0 1-1V5a1 1 0 0 0-2 0v14a1 1 0 0 0 1 1Zm-14.955-.226L18 12 5.045 4.228A1.35 1.35 0 0 0 3 5.386v13.23a1.35 1.35 0 0 0 2.045 1.158Z" /></svg>
              </button>
              <button
                className="flex items-center justify-center h-9 w-9 text-white"
                onClick={cycleRepeat} title={`Repeat: ${repeat}`} aria-label={`Repeat: ${repeat}`}
              >
                <RepeatIcon mode={repeat} />
              </button>
            </div>

            <button
              className="mx-auto flex items-center gap-3 pl-1.5 pr-4 py-1.5 rounded-full bg-white/5 border border-white/10 hover:border-violet-500/40 hover:bg-white/8 transition-all max-w-full"
              onClick={handleArtistClick}
              title={`View ${current.artist}`}
            >
              <img
                src={current.thumbnail}
                alt=""
                className="w-9 h-9 rounded-full object-cover bg-white/10 ring-1 ring-white/20 flex-shrink-0"
                onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0.2')}
              />
              <span className="text-[13.5px] font-semibold truncate">{current.artist}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="text-white/40 flex-shrink-0">
                <polyline points="9,18 15,12 9,6" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto no-scrollbar max-w-md w-full mx-auto pb-8">
            {queue.map((t, i) => (
              <div
                key={t.videoId + i}
                className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors ${current?.videoId === t.videoId ? 'bg-white/10' : 'hover:bg-white/5'}`}
                onClick={() => jumpTo(i)}
              >
                <span className="w-5 text-center text-[11px] text-white/35 tabular-nums">{i + 1}</span>
                <img src={t.thumbnail} alt="" className="w-10 h-10 rounded-lg object-cover bg-white/5" />
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] font-semibold truncate ${current?.videoId === t.videoId ? 'text-violet-400' : ''}`}>{t.title}</p>
                  <p className="text-[11.5px] text-white/45 truncate">{t.artist}</p>
                </div>
                <span className="text-[11px] text-white/35 tabular-nums">{fmtTime(t.duration)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

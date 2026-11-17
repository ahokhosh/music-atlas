import { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo, ReactNode } from 'react'
import { api, pushRecent, type Track } from './api'

type RepeatMode = 'off' | 'all' | 'one'

interface PlayerContextType {
  current: Track | null
  queue: Track[]
  isPlaying: boolean
  loading: boolean
  position: number
  duration: number
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  error: string | null
  sheetOpen: boolean
  playQueue: (tracks: Track[], startIndex?: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (sec: number) => void
  setVolume: (v: number) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  jumpTo: (index: number) => void
  addToQueue: (track: Track) => void
  setSheetOpen: (open: boolean) => void
  close: () => void
}

const PlayerContext = createContext<PlayerContextType | null>(null)

export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be inside PlayerProvider')
  return ctx
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function readVolume(): number {
  const raw = localStorage.getItem('ta_vol')
  if (raw === null || raw === '') return 0.9
  const v = parseFloat(raw)
  return Number.isFinite(v) ? clamp01(v) : 0.9
}

function readRepeat(): RepeatMode {
  const r = localStorage.getItem('ta_repeat')
  return r === 'all' || r === 'one' || r === 'off' ? r : 'off'
}

function artMime(url: string): string {
  const u = url.split('?')[0].toLowerCase()
  if (u.endsWith('.png')) return 'image/png'
  if (u.endsWith('.webp')) return 'image/webp'
  if (u.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [current, setCurrent] = useState<Track | null>(null)
  const [queue, setQueue] = useState<Track[]>([])
  const [index, setIndex] = useState(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVol] = useState(readVolume)
  const [shuffle, setShuffle] = useState(() => localStorage.getItem('ta_shuffle') === '1')
  const [repeat, setRepeat] = useState<RepeatMode>(readRepeat)
  const [error, setError] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const candidatesRef = useRef<string[]>([])
  const candidateIdxRef = useRef(0)
  const failedSourcesRef = useRef<Set<string>>(new Set())
  const sourceRef = useRef<string>('')
  const freshTriedRef = useRef(false)
  const failStreakRef = useRef(0)
  const hlsRef = useRef<any>(null)
  const hlsImportRef = useRef<Promise<any> | null>(null)
  const currentRef = useRef<Track | null>(null)
  const queueRef = useRef<Track[]>([])
  const indexRef = useRef(-1)
  const shuffleRef = useRef(shuffle)
  const repeatRef = useRef(repeat)
  // Monotonic request id: every startTrack/close bumps it; late async
  // results from a previous track are discarded instead of clobbering the
  // current one (the skip-A→B race).
  const resolveSeqRef = useRef(0)
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resolvingRef = useRef(false)
  const pendingSeekRef = useRef<number | null>(null)
  const lastPosRef = useRef(0)

  // Keep refs in sync without assigning during render.
  useEffect(() => { currentRef.current = current }, [current])
  useEffect(() => { queueRef.current = queue }, [queue])
  useEffect(() => { indexRef.current = index }, [index])
  useEffect(() => { shuffleRef.current = shuffle }, [shuffle])
  useEffect(() => { repeatRef.current = repeat }, [repeat])

  const clearSkipTimer = useCallback(() => {
    if (skipTimerRef.current) {
      clearTimeout(skipTimerRef.current)
      skipTimerRef.current = null
    }
  }, [])

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      try { hlsRef.current.destroy() } catch { /* ignore */ }
      hlsRef.current = null
    }
  }, [])

  /** Attach a stream URL to the <audio> element. HLS (.m3u8) is played via
   *  hls.js on Chrome/Edge/Firefox and natively on Safari.
   *  Resolves only after playback actually starts; rejects otherwise so the
   *  caller can move to the next candidate. */
  const attachSource = useCallback(async (url: string, track: Track): Promise<void> => {
    const audio = audioRef.current
    if (!audio) throw new Error('no_audio')
    if (/\.m3u8(\?|$)/i.test(url)) {
      const nativeHls = audio.canPlayType('application/vnd.apple.mpegurl')
      if (nativeHls) {
        destroyHls()
        audio.src = url
        await audio.play()
        pushRecent(track)
        failStreakRef.current = 0
        return
      }
      if (!hlsImportRef.current) hlsImportRef.current = import('hls.js')
      const mod = await hlsImportRef.current
      const Hls = mod.default
      if (!Hls.isSupported()) throw new Error('hls_unsupported')
      destroyHls()
      const hls = new Hls({ enableWorker: true, maxBufferLength: 30, maxMaxBufferLength: 60 })
      hlsRef.current = hls
      hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
        if (data?.fatal) void tryNextCandidateRef.current()
      })
      hls.attachMedia(audio)
      hls.loadSource(url)
      await audio.play()
      pushRecent(track)
      failStreakRef.current = 0
      return
    }
    destroyHls()
    audio.src = url
    await audio.play()
    pushRecent(track)
    failStreakRef.current = 0
  }, [destroyHls])

  // Mutable ref to tryNextCandidate so the HLS error handler above always
  // calls the latest closure without re-subscribing.
  const tryNextCandidateRef = useRef<() => Promise<void>>(async () => {})

  const scheduleSkip = useCallback(() => {
    if (failStreakRef.current >= 3) {
      failStreakRef.current = 0
      setError('Playback stopped — several tracks failed to load')
      audioRef.current?.pause()
      return
    }
    failStreakRef.current++
    setError('Stream failed — trying next track…')
    clearSkipTimer()
    skipTimerRef.current = setTimeout(() => {
      skipTimerRef.current = null
      advanceRef.current(1, true)
    }, 1400)
  }, [clearSkipTimer])

  // try next candidate url; if exhausted → re-resolve with a fresh mint
  const tryNextCandidate = useCallback(async () => {
    // Debounce clustered 'error' events from a single bad track.
    if (resolvingRef.current) return
    resolvingRef.current = true
    const seq = resolveSeqRef.current
    try {
      const audio = audioRef.current
      if (!audio) return
      const track = currentRef.current
      if (!track) return

      if (candidateIdxRef.current < candidatesRef.current.length) {
        const url = candidatesRef.current[candidateIdxRef.current++]
        try {
          await attachSource(url, track)
        } catch {
          resolvingRef.current = false
          if (seq === resolveSeqRef.current) await tryNextCandidateRef.current()
        }
        return
      }
      if (!track.videoId) {
        scheduleSkip()
        return
      }
      // Candidates exhausted → the signed URLs likely expired: re-resolve
      // with fresh=1 (the server bypasses its cache and mints new URLs).
      if (freshTriedRef.current) {
        if (sourceRef.current) failedSourcesRef.current.add(sourceRef.current)
      }
      freshTriedRef.current = true
      if (failedSourcesRef.current.size >= 6) {
        scheduleSkip()
        return
      }
      if (seq === resolveSeqRef.current) setLoading(true)
      try {
        const q = encodeURIComponent(`${track.title} ${track.artist}`.replace(/\bUnknown\b/gi, '').trim())
        const res = await api<{ streams: { url: string }[]; instance: string }>(
          `/music/resolve/${track.videoId}?fresh=1&q=${q}`
        )
        if (seq !== resolveSeqRef.current) return
        // Prefer progressive mp3 over HLS when both are offered.
        const urls = (res.streams || []).map((s) => s.url).sort((a, b) => {
          const ah = /\.m3u8(\?|$)/i.test(a) ? 1 : 0
          const bh = /\.m3u8(\?|$)/i.test(b) ? 1 : 0
          return ah - bh
        })
        if (urls.length) {
          candidatesRef.current = urls
          candidateIdxRef.current = 1
          sourceRef.current = res.instance
          try {
            await attachSource(urls[0], track)
          } catch {
            resolvingRef.current = false
            if (seq === resolveSeqRef.current) await tryNextCandidateRef.current()
          }
          return
        }
        scheduleSkip()
      } catch {
        if (seq === resolveSeqRef.current) scheduleSkip()
      } finally {
        if (seq === resolveSeqRef.current) setLoading(false)
      }
    } finally {
      resolvingRef.current = false
    }
  }, [attachSource, scheduleSkip])
  tryNextCandidateRef.current = tryNextCandidate

  const startTrack = useCallback(async (track: Track) => {
    const audio = audioRef.current
    if (!audio) return
    const seq = ++resolveSeqRef.current
    clearSkipTimer()
    resolvingRef.current = false
    setError(null)
    setLoading(true)
    setPosition(0)
    lastPosRef.current = 0
    setDuration(track.duration || 0)
    pendingSeekRef.current = null
    setCurrent(track)
    currentRef.current = track
    candidatesRef.current = []
    candidateIdxRef.current = 0
    failedSourcesRef.current = new Set()
    sourceRef.current = ''
    freshTriedRef.current = false
    destroyHls()
    updateMediaSession(track)

    if (!track.videoId) {
      setLoading(false)
      scheduleSkip()
      return
    }
    try {
      const q = encodeURIComponent(`${track.title} ${track.artist}`.replace(/\bUnknown\b/gi, '').trim())
      const res = await api<{ streams: { url: string }[]; instance: string }>(
        `/music/resolve/${track.videoId}?fresh=1&q=${q}`
      )
      if (seq !== resolveSeqRef.current) return
      const urls = (res.streams || []).map((s) => s.url).sort((a, b) => {
        const ah = /\.m3u8(\?|$)/i.test(a) ? 1 : 0
        const bh = /\.m3u8(\?|$)/i.test(b) ? 1 : 0
        return ah - bh
      })
      if (!urls.length) throw new Error('no streams')
      candidatesRef.current = urls
      candidateIdxRef.current = 1
      sourceRef.current = res.instance
      await attachSource(urls[0], track)
      failStreakRef.current = 0
    } catch {
      if (seq !== resolveSeqRef.current) return
      candidateIdxRef.current = 0
      candidatesRef.current = []
      await tryNextCandidate()
    } finally {
      if (seq === resolveSeqRef.current) setLoading(false)
    }
  }, [attachSource, clearSkipTimer, destroyHls, scheduleSkip, tryNextCandidate])

  const advanceRef = useRef((dir: 1 | -1, auto = false) => {})
  const advance = useCallback((dir: 1 | -1, auto = false) => {
    const q = queueRef.current
    if (!q.length) return
    let ni: number
    if (auto && repeatRef.current === 'one') {
      ni = indexRef.current
    } else if (shuffleRef.current) {
      if (q.length <= 1) {
        ni = indexRef.current
      } else {
        ni = Math.floor(Math.random() * q.length)
        if (ni === indexRef.current) ni = (ni + 1) % q.length
      }
    } else {
      ni = indexRef.current + dir
      if (ni >= q.length) {
        if (auto && repeatRef.current === 'off') {
          audioRef.current?.pause()
          return
        }
        ni = 0
      }
      if (ni < 0) ni = q.length - 1
    }
    setIndex(ni)
    indexRef.current = ni
    void startTrack(q[ni])
  }, [startTrack])
  advanceRef.current = advance

  const onEnded = useCallback(() => {
    if (repeatRef.current === 'one') {
      const a = audioRef.current
      if (a) {
        a.currentTime = 0
        a.play().catch(() => {})
      }
      return
    }
    advanceRef.current(1, true)
  }, [])

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'auto'
    audio.volume = readVolume()
    audioRef.current = audio
    // While a seek is in flight the element keeps emitting stale timeupdate
    // events (the old position) which would snap the scrubber back mid-drag.
    // Suppress them until the media element confirms the seek via 'seeked'.
    let seekPending = false
    const handlers: Array<[string, EventListener]> = [
      // Throttle position state to ~2Hz: timeupdate fires ~4Hz and every
      // update re-renders all player consumers.
      ['timeupdate', () => {
        if (seekPending) return
        const now = Date.now()
        if (now - lastPosRef.current < 500) return
        lastPosRef.current = now
        setPosition(audio.currentTime)
      }],
      ['seeking', () => { seekPending = true }],
      ['seeked', () => { seekPending = false; setPosition(audio.currentTime) }],
      ['loadedmetadata', () => {
        setDuration(audio.duration || 0)
        // Apply a seek that arrived before metadata was ready.
        if (pendingSeekRef.current != null) {
          const s = pendingSeekRef.current
          pendingSeekRef.current = null
          const d = audio.duration
          if (Number.isFinite(d) && d > 0) {
            const clamped = Math.max(0, Math.min(s, d))
            try { audio.currentTime = clamped } catch { /* ignore */ }
            setPosition(clamped)
          }
        }
      }],
      ['play', () => setIsPlaying(true)],
      ['pause', () => setIsPlaying(false)],
      ['error', () => { void tryNextCandidateRef.current() }],
      ['ended', () => onEnded()],
    ]
    for (const [ev, fn] of handlers) audio.addEventListener(ev, fn)
    return () => {
      resolveSeqRef.current++
      clearSkipTimer()
      audio.pause()
      destroyHls()
      try {
        audio.removeAttribute('src')
        audio.load()
      } catch { /* ignore */ }
      for (const [ev, fn] of handlers) audio.removeEventListener(ev, fn)
    }
  }, [clearSkipTimer, destroyHls, onEnded])

  const playQueue = useCallback((tracks: Track[], startIndex = 0) => {
    if (!tracks.length) return
    const si = Math.max(0, Math.min(startIndex, tracks.length - 1))
    failStreakRef.current = 0
    setQueue(tracks)
    queueRef.current = tracks
    setIndex(si)
    indexRef.current = si
    void startTrack(tracks[si])
  }, [startTrack])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !currentRef.current) return
    if (audio.paused) audio.play().catch(() => setError('Tap play to start audio'))
    else audio.pause()
  }, [])

  const next = useCallback(() => advanceRef.current(1), [])
  const prev = useCallback(() => advanceRef.current(-1), [])

  const seek = useCallback((sec: number) => {
    const audio = audioRef.current
    if (!audio) return
    const d = audio.duration
    // Metadata not loaded yet — park the seek and apply on loadedmetadata.
    if (!Number.isFinite(d) || d <= 0) {
      pendingSeekRef.current = sec
      return
    }
    const clamped = Math.max(0, Math.min(sec, d))
    audio.currentTime = clamped
    setPosition(clamped)
  }, [])

  const setVolume = useCallback((v: number) => {
    const c = clamp01(Number.isFinite(v) ? v : 0.9)
    setVol(c)
    try { localStorage.setItem('ta_vol', String(c)) } catch { /* ignore */ }
    if (audioRef.current) audioRef.current.volume = c
  }, [])

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => {
      try { localStorage.setItem('ta_shuffle', s ? '0' : '1') } catch { /* ignore */ }
      return !s
    })
  }, [])

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => {
      const nr: RepeatMode = r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'
      try { localStorage.setItem('ta_repeat', nr) } catch { /* ignore */ }
      return nr
    })
  }, [])

  const jumpTo = useCallback((i: number) => {
    const q = queueRef.current
    if (i < 0 || i >= q.length) return
    setIndex(i)
    indexRef.current = i
    void startTrack(q[i])
  }, [startTrack])

  const addToQueue = useCallback((track: Track) => {
    const q = queueRef.current
    if (!track?.videoId || q.some((t) => t.videoId === track.videoId)) return
    const nq = [...q, track]
    queueRef.current = nq
    setQueue(nq)
    if (!currentRef.current) {
      setIndex(0)
      indexRef.current = 0
      void startTrack(track)
    }
  }, [startTrack])

  /** Fully stop playback and dismiss the player (mini + sheet). */
  const close = useCallback(() => {
    // Invalidate every in-flight resolve so a late response can't resurrect
    // playback after dismiss.
    resolveSeqRef.current++
    clearSkipTimer()
    resolvingRef.current = false
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      try {
        audio.removeAttribute('src')
        audio.load()
      } catch { /* ignore */ }
    }
    destroyHls()
    candidatesRef.current = []
    candidateIdxRef.current = 0
    pendingSeekRef.current = null
    setIsPlaying(false)
    setLoading(false)
    setPosition(0)
    setDuration(0)
    setError(null)
    setCurrent(null)
    currentRef.current = null
    setQueue([])
    queueRef.current = []
    setIndex(-1)
    indexRef.current = -1
    setSheetOpen(false)
    clearMediaSession()
  }, [clearSkipTimer, destroyHls])

  function updateMediaSession(track: Track) {
    const w = window as any
    if (!w.mediaSession || !w.MediaMetadata) return
    try {
      const art = track.thumbnail
        ? [{ src: track.thumbnail, sizes: '512x512', type: artMime(track.thumbnail) }]
        : []
      w.mediaSession.metadata = new w.MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: 'Music Atlas',
        artwork: art,
      })
      w.mediaSession.setActionHandler('play', () => {
        const a = audioRef.current
        if (a) a.play().catch(() => setError('Tap play to start audio'))
      })
      w.mediaSession.setActionHandler('pause', () => audioRef.current?.pause())
      w.mediaSession.setActionHandler('previoustrack', () => advanceRef.current(-1))
      w.mediaSession.setActionHandler('nexttrack', () => advanceRef.current(1))
      try {
        w.mediaSession.setActionHandler('seekto', (d: any) => {
          if (typeof d?.seekTime === 'number') seek(d.seekTime)
        })
      } catch { /* seekto unsupported */ }
    } catch { /* ignore */ }
  }

  function clearMediaSession() {
    const w = window as any
    if (!w.mediaSession) return
    try {
      w.mediaSession.metadata = null
      for (const h of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto']) {
        try { w.mediaSession.setActionHandler(h, null) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  const value = useMemo<PlayerContextType>(() => ({
    current, queue, isPlaying, loading, position, duration, volume, shuffle, repeat, error, sheetOpen,
    playQueue, toggle, next, prev, seek, setVolume, toggleShuffle, cycleRepeat, jumpTo, addToQueue, setSheetOpen, close,
  }), [current, queue, isPlaying, loading, position, duration, volume, shuffle, repeat, error, sheetOpen,
    playQueue, toggle, next, prev, seek, setVolume, toggleShuffle, cycleRepeat, jumpTo, addToQueue, close])

  return (
    <PlayerContext.Provider value={value}>
      {children}
    </PlayerContext.Provider>
  )
}

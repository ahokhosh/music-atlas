// Music Atlas API client
export const API_BASE = '/music-atlas/api'

const REQUEST_TIMEOUT_MS = 15000

export function getToken(): string | null {
  try {
    return localStorage.getItem('ta_token')
  } catch {
    return null
  }
}

export function authHeaders(): Record<string, string> {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// De-duplicate concurrent identical GETs (home + pages often refetch the
// same trending/playlist within one tick). POSTs are never shared.
const inflight = new Map<string, Promise<any>>()

function apiError(status: number, code: string, message: string): Error {
  const err: any = new Error(message || code || `http_${status}`)
  err.status = status
  err.code = code
  return err as Error
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase()
  if (method === 'GET') {
    const key = `${method} ${path}`
    const existing = inflight.get(key)
    if (existing) return existing as Promise<T>
    const job = request<T>(path, options).finally(() => {
      if (inflight.get(key) === job) inflight.delete(key)
    })
    inflight.set(key, job)
    return job
  }
  return request<T>(path, options)
}

async function request<T>(path: string, options: RequestInit): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let signal: AbortSignal | undefined = options.signal as AbortSignal | undefined
  let timedOut = false
  if (!signal) {
    const ctrl = new AbortController()
    timer = setTimeout(() => {
      timedOut = true
      ctrl.abort()
    }, REQUEST_TIMEOUT_MS)
    signal = ctrl.signal
  }
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(options.headers || {}),
      },
    })
  } catch (e: any) {
    if (timer) clearTimeout(timer)
    if (e?.name === 'AbortError') {
      throw apiError(0, timedOut ? 'timeout' : 'aborted', 'Request timed out — check your connection and try again')
    }
    throw apiError(0, 'network', 'Network error — check your connection and try again')
  } finally {
    if (timer) clearTimeout(timer)
  }
  const ct = res.headers.get('content-type') || ''
  let data: any = {}
  try {
    if (ct.includes('application/json')) {
      data = await res.json().catch(() => ({}))
    } else {
      const text = await res.text().catch(() => '')
      data = text ? { error: `http_${res.status}`, message: text.slice(0, 200) } : {}
    }
  } catch {
    data = {}
  }
  if (!res.ok) {
    const code = data?.error || data?.code || `http_${res.status}`
    const message = data?.message || data?.detail || code
    throw apiError(res.status, code, message)
  }
  return data as T
}

// ---------------- types ----------------
export interface Track {
  videoId: string
  title: string
  artist: string
  thumbnail: string
  duration: number
  permalink?: string
}

/** Detect a SoundCloud link and its kind */
export function parseSoundCloudUrl(s: string): { kind: 'track' | 'playlist'; url: string } | null {
  if (typeof s !== 'string') return null
  const t = s.trim()
  if (!/^https?:\/\/(www\.)?(soundcloud\.com|snd\.sc)\//i.test(t)) return null
  if (/\/sets(\/|$)/i.test(t) || /\/playlists(\/|$)/i.test(t)) return { kind: 'playlist', url: t }
  return { kind: 'track', url: t }
}

export interface Playlist {
  id: number
  user_id: number
  name: string
  description: string | null
  country: string | null
  is_public: number | boolean
  cover_gradient: string | null
  cover_emoji: string | null
  owner_name?: string
  song_count?: number
  thumbnail?: string
  created_at?: string
  updated_at?: string
}
export function fmtTime(sec?: number | null): string {
  if (!Number.isFinite(sec) || (sec as number) < 0) return '–:––'
  const s = sec as number
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}

// recently played (local, per device)
export const RECENT_MAX = 20
export function pushRecent(track: Track) {
  try {
    if (!track?.videoId || track.videoId === 'sc_undefined') return
    const raw = localStorage.getItem('ta_recent')
    let list: Track[] = raw ? JSON.parse(raw) : []
    list = [track, ...list.filter((t) => t?.videoId && t.videoId !== track.videoId)].slice(0, RECENT_MAX)
    localStorage.setItem('ta_recent', JSON.stringify(list))
  } catch { /* ignore */ }
}

export function getRecent(): Track[] {
  try {
    const v = JSON.parse(localStorage.getItem('ta_recent') || '[]')
    if (!Array.isArray(v)) return []
    return v.filter((t) => t?.videoId && t.videoId !== 'sc_undefined').slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

export function clearRecent() {
  try {
    localStorage.removeItem('ta_recent')
  } catch { /* ignore */ }
}

// ---------------- direct client-side download from SoundCloud CDN ----------------
export async function getDownloadUrl(track: Track): Promise<string | null> {
  if (!track?.videoId) return null
  try {
    const q = encodeURIComponent(`${track.title} ${track.artist}`.replace(/\bUnknown\b/gi, '').trim())
    const res = await api<{ streams?: { url: string; label?: string }[] }>(`/music/resolve/${track.videoId}?q=${q}`)
    const streams = res.streams || []
    const prog = streams.find((s) => /progressive|mp3|mpeg/i.test(s.label || '') || /\.mp3(\?|$)/i.test(s.url || ''))
    return (prog || streams[0])?.url || null
  } catch {
    return null
  }
}

const DL_LIMIT = 20
const DL_WINDOW_MS = 24 * 60 * 60 * 1000

function dlState(): { count: number; resetAt: number } {
  try {
    const raw = localStorage.getItem('ta_dl')
    if (raw) {
      const v = JSON.parse(raw)
      if (typeof v?.count === 'number' && typeof v?.resetAt === 'number') return v
    }
  } catch { /* ignore */ }
  return { count: 0, resetAt: Date.now() + DL_WINDOW_MS }
}

function saveDlState(s: { count: number; resetAt: number }) {
  try { localStorage.setItem('ta_dl', JSON.stringify(s)) } catch { /* ignore */ }
}

export async function downloadTrack(track: Track): Promise<boolean> {
  let s = dlState()
  if (Date.now() >= s.resetAt) s = { count: 0, resetAt: Date.now() + DL_WINDOW_MS }
  if (s.count >= DL_LIMIT) {
    const hrs = Math.max(1, Math.ceil((s.resetAt - Date.now()) / 3600000))
    alert(`Download limit reached (${DL_LIMIT} per 24h). Try again in ~${hrs}h.`)
    return false
  }
  const url = await getDownloadUrl(track)
  if (!url) return false
  const a = document.createElement('a')
  a.href = url
  a.download = `${track.title} - ${track.artist}.mp3`.replace(/[\\/:*?"<>|]/g, '_')
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  a.remove()
  s.count += 1
  saveDlState(s)
  return true
}

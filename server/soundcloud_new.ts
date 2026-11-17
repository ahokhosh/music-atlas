// SoundCloud engine — api-v2 based (keyless, client_id only).
// Track metadata, search, playlists, and full-length playback (progressive
// mp3 + HLS aac_160k) with no third-party instances and no API keys.
import { cacheGet, cacheSet } from './db'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const API = 'https://api-v2.soundcloud.com'

// ---------------- client_id ----------------
let clientIdMemo: { id: string; until: number } | null = null
let clientIdPromise: Promise<string | null> | null = null

async function fetchClientIdFromAssets(): Promise<string | null> {
  try {
    const res = await fetch('https://soundcloud.com/', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })
    const html = await res.text()
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m: RegExpMatchArray) => m[1])
    for (const src of scripts) {
      try {
        const sr = await fetch(src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
        if (!sr.ok) continue
        const js = await sr.text()
        const cidMatch = js.match(/client_id[=:]\s*["']([a-zA-Z0-9]+)["']/)
        if (cidMatch) return cidMatch[1]
      } catch (_) { /* next asset */ }
    }
  } catch (_) { /* ignore */ }
  return null
}

export async function getClientId(): Promise<string | null> {
  // Return cached value if still valid
  if (clientIdMemo && clientIdMemo.until > Date.now()) return clientIdMemo.id
  
  // If already fetching, reuse the same promise (dedup concurrent requests)
  if (clientIdPromise) return clientIdPromise
  
  clientIdPromise = (async () => {
    try {
      // Try DB cache first (long TTL - 24h)
      const row = await cacheGet('sc:client_id')
      const cached = typeof row?.value === 'string' ? row.value : row?.value?.id
      if (cached) {
        clientIdMemo = { id: cached, until: Date.now() + 24 * 3600_000 } // 24h cache
        // Refresh in background (don't block)
        fetchClientIdFromAssets().then((fresh) => {
          if (fresh && fresh !== cached) {
            clientIdMemo = { id: fresh, until: Date.now() + 24 * 3600_000 }
            cacheSet('sc:client_id', fresh, 24 * 3600).catch(() => {})
          }
        }).catch(() => {})
        return cached
      }
    } catch { /* db optional */ }
    
    // Fetch fresh
    const fresh = await fetchClientIdFromAssets()
    if (fresh) {
      clientIdMemo = { id: fresh, until: Date.now() + 24 * 3600_000 } // 24h cache
      cacheSet('sc:client_id', fresh, 24 * 3600).catch(() => {})
    }
    return fresh
  })()
  
  try {
    return await clientIdPromise
  } finally {
    clientIdPromise = null
  }
}

export function cachedClientId(): string | null {
  return clientIdMemo && clientIdMemo.until > Date.now() ? clientIdMemo.id : null
}

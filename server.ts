// Force IPv4-first DNS: avoids IPv6 black-hole stalls (multi-second TTFB)
// on Node's fetch/undici for CDN hosts in some networks.
import dns from 'dns'
dns.setDefaultResultOrder('ipv4first')

import express from 'express'
import compression from 'compression'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { initDatabase, isDbAvailable, getUserById } from './server/db'
import { COUNTRIES } from './src/data/countries'
import { GENRES, getGenre } from './src/data/genres'
import { getTrending, getTrendingMore, getTrendingPlaylists, searchMusic, resolveStreams, instanceStatus, prefetchStreams } from './server/music'
import {
  scResolveUrl,
  scTrackById,
  scTrackJsonById,
  scPlaylistById,
  scSearchPlaylists,
  scSearchTracks,
  scCharts,
  scSystemPlaylistTracks,
  scStreamsById,
  invalidateScStreams,
  soundcloudIsUrl,
  extractScId,
  getClientId,
} from './server/soundcloud'
import { netopenFetch } from './server/scRelay'
import { Readable } from 'stream'

dotenv.config()
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true })
// Last-resort guards: a single failed stream/response must NEVER take the
// whole service down (server death = full portal outage for every user).
process.on('uncaughtException', (err) => {
  console.error('[guard] uncaughtException:', err?.stack || err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[guard] unhandledRejection:', reason)
})

const app = express()
const PORT = parseInt(process.env.PORT || '3000', 10)
const JWT_SECRET = process.env.JWT_SECRET || '';
const BASE = '/music-atlas'
const LEGACY_BASE = '/playlist'
const SC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
// SoundCloud CDN allowlist for the streaming proxy
const SC_ALLOWED_HOSTS = ['.soundcloud.com', '.sndcdn.com', '.soundcloud.cloud', '.snd.sc']

// ?? Bounded in-memory caches ?????????????????????????????????????????????
// genreMem/packMem/homeMem are keyed by user/country input and were unbounded
// (expiry only on read, so cold keys lived forever). Cap entries with
// oldest-first eviction; warm keys just overwrite. Tune with MEM_CACHE_CAP.
const MEM_CACHE_CAP = Math.max(50, parseInt(process.env.MEM_CACHE_CAP || '300', 10))
function boundedMemSet(map: Map<string, { exp: number; val: any }>, key: string, entry: { exp: number; val: any }) {
  if (!map.has(key) && map.size >= MEM_CACHE_CAP) {
    const first = map.keys().next()
    if (!first.done) map.delete(first.value)
  }
  map.set(key, entry)
}

app.use(cors())
app.use(express.json({ limit: '2mb' }))

// Perf: gzip/deflate HTML/JS/CSS/JSON. /api/* excluded: the audio-stream
// proxy pipes binary chunks and must flush unbuffered.
app.use(compression({
  filter: (req: any, res: any) => !req.path.startsWith('/api') && compression.filter(req, res),
}))

async function main() {
  await initDatabase()
  console.log(`[music-atlas] DB ready: ${isDbAvailable()}`)
}
main().catch(console.error)

// small DB-cache helpers (metadata resilience; DB optional)
async function dbGetCache(key: string): Promise<any> {
  try {
    const { cacheGet } = await import('./server/db')
    const row = await cacheGet(key)
    if (row && (!row.expiresAt || row.expiresAt > Date.now())) return row.value
  } catch { /* db optional */ }
  return null
}
async function dbSetCache(key: string, val: any, ttlSec: number) {
  try {
    const { cacheSet } = await import('./server/db')
    await cacheSet(key, val, ttlSec)
  } catch { /* db optional */ }
}
async function dbSetStale(key: string, val: any) {
  try {
    const { cacheSetStale } = await import('./server/db')
    await cacheSetStale(key, val)
  } catch { /* db optional */ }
}
async function dbGetStale(key: string): Promise<any> {
  try {
    const { cacheGetStale } = await import('./server/db')
    return await cacheGetStale(key)
  } catch { /* db optional */ }
  return null
}


function authMiddleware(req: any, res: any, next: any) {
  const header = req.headers.authorization
  if (!header) return res.status(401).json({ error: 'no_token' })
  try {
    const payload = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET) as any
    req.userId = payload.userId
    next()
  } catch {
    res.status(401).json({ error: 'invalid_token' })
  }
}

const api = express.Router()

api.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'music-atlas', app: 'music-atlas', db: isDbAvailable() })
})

api.post('/auth/register', async (req, res) => {
  try {
    if (!isDbAvailable()) return res.status(503).json({ error: 'db_unavailable' })
    const { username, email, password, country } = req.body || {}
    if (!username || !email || !password) return res.status(400).json({ error: 'missing_fields' })
    const { getUserByEmail, createUser } = await import('./server/db')
    const existing = await getUserByEmail(String(email).toLowerCase())
    if (existing) return res.status(409).json({ error: 'email_taken' })
    const hash = await bcrypt.hash(password, 10)
    const userId = await createUser(String(username).slice(0, 50), String(email).toLowerCase(), hash, country)
    const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '30d' })
    res.json({ token, user: { id: userId, username, email, country } })
  } catch (err: any) {
    console.error('register error:', err?.message)
    res.status(500).json({ error: 'server_error' })
  }
})

api.post('/auth/login', async (req, res) => {
  try {
    if (!isDbAvailable()) return res.status(503).json({ error: 'db_unavailable' })
    const { email, password } = req.body || {}
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' })
    const { getUserByEmail } = await import('./server/db')
    const user = await getUserByEmail(String(email).toLowerCase())
    if (!user) return res.status(401).json({ error: 'invalid_credentials' })
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return res.status(401).json({ error: 'invalid_credentials' })
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' })
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, country: user.country } })
  } catch (err: any) {
    console.error('login error:', err?.message)
    res.status(500).json({ error: 'server_error' })
  }
})

api.get('/auth/me', authMiddleware, async (req: any, res) => {
  try {
    const user = await getUserById(req.userId)
    if (!user) return res.status(404).json({ error: 'not_found' })
    res.json({ user })
  } catch {
    res.status(500).json({ error: 'server_error' })
  }
})

// Stream endpoint — accepts a SoundCloud URL and redirects to a playable stream
api.get('/music/stream', async (req, res) => {
  const url = String(req.query.url || '')
  if (!url) return res.status(400).json({ error: 'missing_url' })

  if (soundcloudIsUrl(url)) {
    try {
      const r = await scResolveUrl(url)
      if (r?.kind === 'track' && r.track) {
        const streams = await scStreamsById(r.track.id)
        if (streams.progressive) return res.redirect(`${BASE}/api/sc/stream/${r.track.id}/audio.mp3`)
        if (streams.hls) return res.redirect(`${BASE}/api/sc/stream/${r.track.id}/playlist.m3u8`)
        return res.status(404).json({ error: 'no_stream' })
      }
      if (r?.kind === 'playlist') {
        return res.status(400).json({ error: 'is_playlist', playlist: r.playlist, hint: `Use ${BASE}/api/music/sc/playlist?url=` })
      }
    } catch (e: any) {
      console.warn(`[stream] soundcloud failed:`, e?.message)
    }
    return res.status(404).json({ error: 'no_stream' })
  }

  return res.status(400).json({ error: 'unsupported_url', detail: 'Only soundcloud.com URLs are supported' })
})

// Resolve SoundCloud playlist is implemented further below
// (GET /music/soundcloud/playlist?url= / ?id= with full metadata).

api.get('/countries', (_req, res) => {
  res.json({ countries: COUNTRIES, count: COUNTRIES.length })
})

api.get('/music/trending/:country', async (req, res) => {
  try {
    const fresh = String(req.query.fresh || '') === '1'
    const debug = String(req.query.debug || '') === '1'
    const stats: any = {}
    const out = await getTrending(req.params.country || 'US', fresh, debug ? stats : undefined)
    res.json(debug ? { ...out, debug: stats } : out)
  } catch (err) {
    console.error('trending error:', err)
    res.json({ tracks: [], fallback: true, offline: true })
  }
})

api.get('/music/trending/:country/more', async (req, res) => {
  try {
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0)
    const out = await getTrendingMore(req.params.country || 'US', offset)
    res.json(out)
  } catch (err) {
    console.error('trending/more error:', err)
    res.json({ tracks: [], hasMore: false })
  }
})

// ============================================================
// TRENDING BY GENRE � official SoundCloud charts per genre
// (mirrors the "Trending by genre" rail: Trap, Pop, Hip-Hop�).
// `kind=trending` = New & Hot. Cached 1h, pre-warmed hourly.
// ============================================================
const genreMem = new Map<string, { exp: number; val: any }>()

/** Genre tracks, best source first with top-up:
 *  1. the discover page's own system set (exact discover track ids),
 *  2. official charts (`kind=trending` = New & Hot),
 *  3. year-aware keyword search fallback.
 *  Layers FILL each other up to TARGET (deduped): a partial discover set
 *  (e.g. 4 of 30 playable) no longer short-circuits the whole rail � this
 *  was the "playlist incomplete" bug (early return on any non-empty part).
 *  Shared by the endpoint and the hourly warmer. */
const GENRE_TARGET = 40
async function getGenreTracks(meta: { slug: string; name: string }): Promise<{ tracks: any[]; source: string }> {
  const toApi = (t: { id: number; title: string; artist: string; thumbnail: string; duration: number; permalink: string; createdAt?: number; playbackCount?: number; likesCount?: number }) => ({
    videoId: `sc_${t.id}`,
    title: t.title,
    artist: t.artist,
    thumbnail: t.thumbnail,
    duration: t.duration,
    permalink: t.permalink,
    createdAt: t.createdAt || 0,
    playbackCount: t.playbackCount || 0,
    likesCount: t.likesCount || 0,
  })
  const seen = new Set<string>()
  const tracks: any[] = []
  const sources: string[] = []
  // Layers have different shapes: discover-set/charts yield ScTrack ({id}),
  // search yields Track ({videoId: 'sc_<id>'}). Normalize to a numeric id �
  // without this every search track collapsed to key 'sc_undefined' and only
  // the first one survived (the "genre shows a single broken track" bug).
  const add = (list: any[]) => {
    for (const t of list) {
      const numId = Number((t as any)?.id ?? String((t as any)?.videoId || '').replace(/^sc_/, '')) || 0
      if (!numId) continue
      const key = `sc_${numId}`
      if (seen.has(key)) continue
      seen.add(key)
      tracks.push(toApi({ ...(t as any), id: numId }))
      if (tracks.length >= GENRE_TARGET) break
    }
  }
  const setSlug = getGenre(meta.slug)?.set
  if (setSlug && tracks.length < GENRE_TARGET) {
    try {
      const dl = await scSystemPlaylistTracks(`https://soundcloud.com/discover/sets/trending-by-genre:${setSlug}`, GENRE_TARGET)
      if (dl.length) { add(dl); sources.push('discover-set') }
    } catch { /* fall through to charts */ }
  }

  const chartsSlug = getGenre(meta.slug)?.charts
  if (chartsSlug && tracks.length < GENRE_TARGET) {
    try {
      const items = await scCharts('trending', chartsSlug, undefined, GENRE_TARGET)
      const fresh = items.map((i) => i.track).filter((t) => !t.snippet)
      if (fresh.length) { add(fresh); sources.push('soundcloud-chart') }
    } catch { /* fall through to search */ }
  }

  if (tracks.length < GENRE_TARGET) {
    const q = await searchMusic(`${meta.name} ${CURRENT_YEAR}`).catch(() => ({ tracks: [] as any[] }))
    if (q.tracks?.length) { add(q.tracks as any); sources.push('soundcloud-search-fresh') }
  }
  if (tracks.length < GENRE_TARGET) {
    const q2 = await searchMusic(meta.name).catch(() => ({ tracks: [] as any[] }))
    if (q2.tracks?.length) { add(q2.tracks as any); sources.push('soundcloud-search') }
  }
  console.log(`[genre] ${meta.slug} -> ${sources.join('+') || 'none'} (${tracks.length} tracks)`)
  return { tracks, source: sources.join('+') || 'none' }
}

// Debug: shows every stage of discover-set resolution so a mismatch with
// the discover page can be pinpointed (resolve -> playlist -> served).
// Open: /playlist/api/music/debug/discover/electronic
api.get('/music/debug/discover/:slug', async (req, res) => {
  try {
    const setSlug = String(req.params.slug || '').toLowerCase().replace(/[^a-z-]/g, '')
    const url = `https://soundcloud.com/discover/sets/trending-by-genre:${setSlug}`
    const r = await scResolveUrl(url).catch(() => null)
    const pid = r?.kind === 'playlist' && r.playlist ? (r.playlist as any).id : null
    let playlistTrackCount: number | null = null
    let playableTracks = 0
    if (pid) {
      const full = await scPlaylistById(String(pid)).catch(() => null)
      if (full) {
        playlistTrackCount = full.playlist.trackCount
        playableTracks = full.tracks.length
      }
    }
    const meta = getGenre(setSlug) || { slug: setSlug, name: setSlug, hue: 265 }
    const g = await getGenreTracks(meta as any).catch(() => ({ tracks: [], source: 'error' }))
    res.json({
      url,
      resolved: r ? { kind: r.kind, id: pid, title: (r.playlist as any)?.title || (r.track as any)?.title || null } : null,
      playlistTrackCount,
      playableTracks,
      served: { source: (g as any).source, returned: (g as any).tracks?.length || 0 },
    })
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'debug_failed' })
  }
});

api.get('/music/genre/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase().replace(/[^a-z-]/g, '')
    const meta = getGenre(slug)
    if (!meta) return res.status(404).json({ error: 'unknown_genre' })
    const fresh = String(req.query?.fresh || '') === '1'
    const key = `sc:genre:v4:${slug}`
    if (!fresh) {
      const hit = genreMem.get(key)
      if (hit && hit.exp > Date.now()) return res.json({ ...hit.val, cached: true })
      const cached = await dbGetCache(key)
      if (cached) {
        boundedMemSet(genreMem, key, { exp: Date.now() + 300 * 1000, val: cached })
        return res.json({ ...cached, cached: true })
      }
    }
    const { tracks, source } = await getGenreTracks(meta)
    if (tracks.length) prefetchStreams(tracks)
    // Each genre trend IS a playlist (like the discover sets): stable id,
    // name, track count, and cover = first track's artwork.
    const out = {
      genre: meta,
      playlist: {
        id: `genre:${slug}`,
        name: `${meta.name} Trending`,
        artwork: tracks[0]?.thumbnail || null,
        tracksCount: tracks.length,
        permalink: '',
      },
      tracks,
      source,
      updatedAt: Date.now(),
    }
    console.log(`[genre] ${slug} -> ${source} (${tracks.length} tracks)`)
    if (tracks.length) {
      await dbSetCache(key, out, 3600)
      await dbSetStale(key, out)
      boundedMemSet(genreMem, key, { exp: Date.now() + 300 * 1000, val: out })
    }
    res.json(out)
  } catch (err) {
    console.error('genre error:', err)
    const slug = String(req.params.slug || '').toLowerCase().replace(/[^a-z-]/g, '')
    const stale = slug ? await dbGetStale(`sc:genre:v4:${slug}`) : null
    if (stale) return res.json({ ...stale, stale: true })
    res.json({ genre: getGenre(slug) || null, tracks: [], source: 'none' })
  }
})

api.get('/music/search', async (req, res) => {
  try {
    const q = String(req.query.q || '')
    if (!q.trim()) return res.json({ tracks: [], source: 'none' })
    const out = await searchMusic(q)
    res.json(out)
  } catch (err) {
    console.error('search error:', err)
    res.json({ tracks: [], source: 'none', offline: true })
  }
})

api.get('/music/resolve/:videoId', async (req, res) => {
  try {
    const videoId = String(req.params.videoId || '')
    const q = String(req.query.q || '')
    const fresh = String(req.query?.fresh || '') === '1'
    const out = await resolveStreams(videoId, q, fresh)
    if (!out) return res.status(404).json({ error: 'no_stream' })
    res.json(out)
  } catch (err) {
    console.error('resolve error:', err)
    res.status(500).json({ error: 'resolve_failed' })
  }
})

api.get('/music/instances', async (_req, res) => {
  // Await a mint so this endpoint is a REAL probe (cold boot reports the
  // live pool instead of ok:false), which is what the e2e early-warning
  // check and any monitor rely on.
  try { await getClientId() } catch { /* status still reports */ }
  res.json(instanceStatus())
})

// Featured packs = REAL SoundCloud playlists, discovered live via playlist search.
// Only the seed queries are local; the playlists themselves (and their tracks)
// come fresh from SoundCloud and refresh hourly from cache.
// `?fresh=1` bypasses the cache for a manual refresh from the client.
const CURRENT_YEAR = new Date().getFullYear()
const PACK_SEEDS = [
  { seed: `top hits ${CURRENT_YEAR}`, category: 'charts' },
  { seed: `pop hits ${CURRENT_YEAR}`, category: 'genre' },
  { seed: `hip hop rap ${CURRENT_YEAR}`, category: 'genre' },
  { seed: `electronic edm house ${CURRENT_YEAR}`, category: 'genre' },
  { seed: `lofi chill beats ${CURRENT_YEAR}`, category: 'mood' },
  { seed: `rock hits ${CURRENT_YEAR}`, category: 'genre' },
  { seed: `persian music ${CURRENT_YEAR}`, category: 'region' },
  { seed: `k-pop ${CURRENT_YEAR}`, category: 'region' },
  { seed: `afrobeats amapiano ${CURRENT_YEAR}`, category: 'region' },
  { seed: `workout phonk ${CURRENT_YEAR}`, category: 'mood' },
]

interface FeaturedPack {
  id: string
  name: string
  emoji: string
  category: string
  description: string
  tracksCount: number
  artwork: string | null
  permalink: string
  updatedAt: number
}

const FEATURED_CACHE_KEY = 'sc:featured:v2'
const FEATURED_TTL_SEC = 3600
// In-process hot copy: featured has no mem layer in music.ts, so without
// this every request with a cold/empty DB would pay the full 10-search
// fan-out. Memory holds 5 min, DB holds the full hour.
let featMem: { exp: number; val: FeaturedPack[]; at: number } | null = null

/** Live fetch of all featured packs (10 parallel SoundCloud searches).
 *  Slow by nature (~seconds) � never called on a user request directly
 *  when the cache is warm; the background warmer (below) keeps it fresh. */
async function fetchFeaturedPacks(): Promise<FeaturedPack[]> {
  const seen = new Set<string>()
  const now = Date.now()
  // Two halves of 5: a 10-way burst plus user traffic reliably trips
  // SoundCloud throttling and empties every list (see getTrendingPlaylists).
  const runSeed = async ({ seed, category }: { seed: string; category: string }) => {
    try {
      const lists = await scSearchPlaylists(seed, 6)
      return { seed, category, lists }
    } catch { return { seed, category, lists: [] as Awaited<ReturnType<typeof scSearchPlaylists>> } }
  }
  const promises: Awaited<ReturnType<typeof runSeed>>[] = []
  for (let i = 0; i < PACK_SEEDS.length; i += 5) {
    const batch = await Promise.all(PACK_SEEDS.slice(i, i + 5).map(runSeed))
    promises.push(...batch)
  }
  const scored: { pl: any; category: string; score: number }[] = []
  for (const { category, lists } of await Promise.all(promises)) {
    for (const pl of lists) {
      const id = String(pl.id)
      if (!id || seen.has(id)) continue
      seen.add(id)
      const ageDays = pl.createdAt > 0 ? Math.max(0, (now - pl.createdAt) / 86400000) : 365
      const modDays = pl.lastModified > 0 ? Math.max(0, (now - pl.lastModified) / 86400000) : ageDays
      const engagement = Math.log10(1 + (pl.likesCount || 0)) * 3 + Math.log10(1 + (pl.repostsCount || 0)) * 2
      const sizeScore = Math.min(3, Math.log10(1 + (pl.trackCount || 0)))
      const fresh = Math.max(0, 1 - Math.min(ageDays, modDays) / 365)
      scored.push({ pl, category, score: engagement + sizeScore + fresh * 5 + (modDays < 90 ? 2 : 0) })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  const packs: FeaturedPack[] = scored.slice(0, 20).map(({ pl, category }) => ({
    id: String(pl.id),
    name: pl.title,
    emoji: '??',
    category,
    description: pl.description || `${category} picks ${CURRENT_YEAR}`,
    tracksCount: pl.trackCount,
    artwork: pl.artworkUrl || null,
    permalink: pl.permalink,
    updatedAt: pl.lastModified || pl.createdAt || now,
  }))
  await backfillArtwork(packs)
  return packs
}

// Cover backfill: many SoundCloud sets have NO custom artwork
// (their artwork_url is null upstream) � that is why some cards showed
// no cover. Borrow the first track's artwork so cards almost always
// have an image. Bounded (max 8 sets, 4 at a time), fault-isolated,
// and it runs inside the background warmer so users never wait for it.
async function backfillArtwork(packs: FeaturedPack[]) {
  const missing = packs.filter((p) => !p.artwork).slice(0, 8)
  for (let i = 0; i < missing.length; i += 4) {
    await Promise.all(
      missing.slice(i, i + 4).map(async (p) => {
        try {
          const full = await scPlaylistById(p.id)
          const art = full?.tracks?.[0]?.thumbnail || null
          if (art) p.artwork = art
        } catch { /* keep gradient fallback */ }
      })
    )
  }
}

function rememberFeatured(packs: FeaturedPack[]) {
  featMem = { exp: Date.now() + 300 * 1000, val: packs, at: Date.now() }
}

/** Single source for featured packs: hot mem ? DB ? live fetch.
 *  Used by /music/featured AND the /home aggregate.
 *  Stale-while-revalidate: if the live fetch comes back empty (upstream
 *  outage), serve the last known good value instead of an empty rail.
 *  `updatedAt` is the generation time of the served data (never "now"
 *  for cached rows) so clients can trust it. */
async function getFeaturedCached(fresh = false): Promise<{ packs: FeaturedPack[]; updatedAt: number }> {
  const stale = async (): Promise<{ packs: FeaturedPack[]; updatedAt: number } | null> => {
    const v = await dbGetStale(FEATURED_CACHE_KEY)
    if (v && Array.isArray(v) && v.length) {
      return { packs: v, updatedAt: Date.now() - FEATURED_TTL_SEC * 1000 }
    }
    try {
      const { cacheGet } = await import('./server/db')
      const row = await cacheGet(FEATURED_CACHE_KEY)
      if (row?.value && Array.isArray(row.value) && row.value.length) {
        const at = row.expiresAt ? row.expiresAt - FEATURED_TTL_SEC * 1000 : Date.now()
        return { packs: row.value, updatedAt: at }
      }
    } catch { /* ignore */ }
    return null
  }
  if (!fresh) {
    if (featMem && featMem.exp > Date.now()) return { packs: featMem.val, updatedAt: featMem.at }
    const cached = await dbGetCache(FEATURED_CACHE_KEY)
    if (cached) {
      rememberFeatured(cached)
      const s = await stale()
      return { packs: cached, updatedAt: s?.updatedAt || Date.now() }
    }
  }
  const packs = await fetchFeaturedPacks().catch(() => [] as FeaturedPack[])
  if (packs.length) {
    await dbSetCache(FEATURED_CACHE_KEY, packs, FEATURED_TTL_SEC)
    await dbSetStale(FEATURED_CACHE_KEY, packs)
    rememberFeatured(packs)
    return { packs, updatedAt: Date.now() }
  }
  if (featMem?.val?.length) return { packs: featMem.val, updatedAt: featMem.at }
  return (await stale()) || { packs: [], updatedAt: Date.now() }
}

api.get('/music/featured', async (req, res) => {
  try {
    const fresh = String(req.query?.fresh || '') === '1'
    const { packs, updatedAt } = await getFeaturedCached(fresh)
    res.json({ playlists: packs, updatedAt })
  } catch (err) {
    console.error('featured error:', err)
    res.json({ playlists: [] })
  }
})

// Fresh trending playlists per country (year-aware, scored fresh-first).
// Powers the "Trending playlists" rail; `?fresh=1` forces a live re-fetch.
api.get('/music/trending/playlists/:country', async (req, res) => {
  try {
    const fresh = String(req.query?.fresh || '') === '1'
    const out = await getTrendingPlaylists(req.params.country || 'US', fresh)
    res.json(out)
  } catch (err) {
    console.error('trending-playlists error:', err)
    res.json({ playlists: [], source: 'none', updatedAt: Date.now() })
  }
})

const PACK_TTL_SEC = 3600
// First paint shows this many tracks; the rest streams in via ?offset=.
const PACK_PAGE_DEFAULT = 30
const PACK_PAGE_MAX = 50
// Upstream pages walked per request (50 ids each) � bounds cold-open latency
// while still filling several client pages per round trip.
const PACK_PAGES_PER_CALL = 4
// Per-track refetches allowed per request, on top of the served window �
// slack for snippet-drops so the window is actually full.
const PACK_ENRICH_SLACK = 40
// Cache-row caps (a row holds the shared progressive list, not one page).
const PACK_MAX_ORDER = 1000
const PACK_MAX_TRACKS = 500
// Hot mem copy so repeat pack opens don't even touch the DB.
const packMem = new Map<string, { exp: number; val: any }>()

function toPackTrack(t: any) {
  return {
    videoId: `sc_${t.id}`,
    title: t.title,
    artist: t.artist,
    thumbnail: t.thumbnail,
    duration: t.duration,
    permalink: t.permalink,
  }
}

function buildPackKnown(entry: any): { order: number[]; tracks: Map<number, any> } {
  const known = new Map<number, any>()
  for (const t of entry.tracks || []) known.set(t.id, t)
  for (const id of entry.blocked || []) {
    if (!known.has(id)) {
      known.set(id, { id, title: '', artist: '', thumbnail: '', duration: 0, permalink: '', snippet: true, createdAt: 0, playbackCount: 0, likesCount: 0, repostsCount: 0 })
    }
  }
  return { order: entry.order || [], tracks: known }
}

function mergePackResult(r: any) {
  const playableIds = new Set((r.tracks as any[]).map((t) => t.id))
  const orderSet = new Set<number>()
  const order: number[] = []
  for (const id of r.order as number[]) {
    if (!orderSet.has(id)) { orderSet.add(id); order.push(id) }
    if (order.length >= PACK_MAX_ORDER) break
  }
  const tracks = (r.tracks as any[]).filter((t) => orderSet.has(t.id)).slice(0, PACK_MAX_TRACKS)
  const blocked = (r.resolved as number[]).filter((id) => !playableIds.has(id) && orderSet.has(id))
  const total = r.playlist.trackCount || tracks.length
  return {
    pack: {
      id: String(r.playlist.id),
      name: r.playlist.title,
      emoji: '??',
      category: 'playlist',
      description: r.playlist.description,
      tracksCount: total,
      artwork: r.playlist.artworkUrl,
      permalink: r.playlist.permalink,
    },
    order,
    tracks,
    blocked,
    nextHref: r.nextHref,
    complete: r.complete,
    total,
    updatedAt: Date.now(),
  }
}

async function savePackEntry(key: string, entry: any) {
  await dbSetCache(key, entry, PACK_TTL_SEC)
  await dbSetStale(key, entry)
  boundedMemSet(packMem, key, { exp: Date.now() + 300 * 1000, val: entry })
}

/** Paged pack track list: hot mem ? DB ? progressive live fill.
 *  The cache holds the SHARED cumulative list (id order + resolved playable
 *  tracks + snippet blocklist + upstream cursor); each request slices out
 *  [offset, offset+limit) and only fetches upstream when the cache cannot
 *  fill the window yet. Cold opens resolve just the first page instead of
 *  the whole 200-track tail, so first paint is fast; "More" continues the
 *  cursor where the previous request stopped.
 *  NOTE: no fire-and-forget background fill � sustained fan-out loops
 *  (warmer packs � user packs) get the origin throttled by SoundCloud and
 *  degrade every list. Each request pays at most PACK_PAGES_PER_CALL pages.
 *  Used by /music/charts/:packId AND the hourly warmer. */
async function getPackPage(packId: string, offset: number, limit: number, fresh = false): Promise<any | null> {
  const key = `sc:pack:v5:${packId}`
  let entry: any = null
  if (!fresh) {
    const hit = packMem.get(key)
    if (hit && hit.exp > Date.now()) entry = hit.val
    else {
      entry = await dbGetCache(key)
      if (entry) boundedMemSet(packMem, key, { exp: Date.now() + 300 * 1000, val: entry })
    }
  }
  const need = offset + limit
  if (!entry || (!entry.complete && (entry.tracks?.length || 0) < need)) {
    const r = await scPlaylistById(packId, undefined, {
      maxPages: PACK_PAGES_PER_CALL,
      resumeHref: entry?.nextHref ?? null,
      known: entry ? buildPackKnown(entry) : undefined,
      enrichLimit: need + PACK_ENRICH_SLACK,
    }).catch(() => null)
    if (!r && !entry) return dbGetStale(key)
    if (r) {
      entry = mergePackResult(r)
      await savePackEntry(key, entry)
    }
  }
  if (!entry) return null
  const tracks: any[] = entry.tracks || []
  const total: number = entry.total || tracks.length
  const slice = tracks.slice(offset, offset + limit)
  if (offset === 0 && slice.length) prefetchStreams(slice.map(toPackTrack))
  return {
    pack: entry.pack,
    tracks: slice.map(toPackTrack),
    total,
    returned: slice.length,
    hasMore: offset + limit < tracks.length || !entry.complete,
    partial: total > 0 && tracks.length < total && !!entry.complete,
    source: 'soundcloud-playlist',
    updatedAt: entry.updatedAt || Date.now(),
  }
}

api.get('/music/charts/:packId', async (req, res) => {
  try {
    const raw = String(req.params.packId || '')
    const packId = raw.replace(/[^0-9]/g, '')
    // Allow genre slugs (e.g. /music/charts/lofi) to resolve to the genre
    // rail so the same endpoint serves both featured packs and genre packs.
    if (!/^\\d{4,}$/.test(packId)) {
      const meta = getGenre(raw.toLowerCase())
      if (!meta) return res.status(404).json({ error: 'not_found' })
      const { tracks, source } = await getGenreTracks(meta)
      return res.json({ pack: { id: `genre:${meta.slug}`, name: `${meta.name} Trending`, tracksCount: tracks.length }, tracks, source, updatedAt: Date.now() })
    }
    const fresh = String(req.query?.fresh || '') === '1'
    const limit = Math.min(PACK_PAGE_MAX, Math.max(1, parseInt(String(req.query?.limit || PACK_PAGE_DEFAULT), 10) || PACK_PAGE_DEFAULT))
    const offset = Math.max(0, parseInt(String(req.query?.offset || '0'), 10) || 0)
    const out = await getPackPage(packId, offset, limit, fresh)
    if (!out) return res.status(404).json({ error: 'not_found' })
    res.json(out)
  } catch (err) {
    console.error('charts error:', err)
    const packId = String(req.params.packId || '').replace(/[^0-9]/g, '')
    const stale = /^\d{4,}$/.test(packId) ? await dbGetStale(`sc:pack:v5:${packId}`) : null
    if (stale) {
      const offset = Math.max(0, parseInt(String(req.query?.offset || '0'), 10) || 0)
      const limit = Math.min(PACK_PAGE_MAX, Math.max(1, parseInt(String(req.query?.limit || PACK_PAGE_DEFAULT), 10) || PACK_PAGE_DEFAULT))
      const tracks: any[] = stale.tracks || []
      return res.json({ ...stale, tracks: tracks.slice(offset, offset + limit).map(toPackTrack), stale: true })
    }
    res.json({ pack: null, tracks: [], source: 'none' })
  }
})

// SoundCloud playlist discovery (search playlists by keyword)
api.get('/music/sc/playlists', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    if (!q) return res.json({ playlists: [] })
    const key = `sc:plsearch:${q.toLowerCase().slice(0, 120)}`
    const cached = await dbGetCache(key)
    if (cached) return res.json(cached)
    const lists = await scSearchPlaylists(q, 18)
    const out = { playlists: lists }
    await dbSetCache(key, out, 3600)
    res.json(out)
  } catch {
    res.json({ playlists: [] })
  }
})

// SoundCloud playlist resolve (by permalink URL or numeric id)
api.get('/music/soundcloud/playlist', async (req, res) => {
  try {
    const url = String(req.query.url || '').trim()
    const id = String(req.query.id || '').trim()
    const debug = String(req.query.debug || '') === '1'
    const stats: any = {}
    let result: { playlist: any; tracks: any[] } | null = null
    if (id && /^\d+$/.test(id)) {
      result = await scPlaylistById(id, debug ? stats : undefined)
    } else if (soundcloudIsUrl(url)) {
      const r = await scResolveUrl(url)
      if (r?.kind === 'playlist' && r.playlist) {
        result = await scPlaylistById(r.playlist.id, debug ? stats : undefined)
      }
    }
    if (!result) return res.status(404).json({ error: 'playlist_not_found' })
    const mappedTracks = result.tracks.map((t: any) => ({
      videoId: `sc_${t.id}`,
      title: t.title,
      artist: t.artist,
      thumbnail: t.thumbnail,
      duration: t.duration,
      permalink: t.permalink,
    }))
    prefetchStreams(mappedTracks)
    res.json({
      playlist: result.playlist,
      tracks: debug ? undefined : mappedTracks,
      count: result.tracks.length,
      ...(debug ? { debug: stats, sample: mappedTracks.slice(0, 3) } : {}),
    })
  } catch {
    res.status(500).json({ error: 'server_error' })
  }
})

/** Country detection shared by /geo and /home: CDN header first,
// then Accept-Language guess (e.g. "fa-IR" -> IR), then US. */
function detectCountry(req: any) {
  const cf = req.headers['cf-ipcountry'] ? String(req.headers['cf-ipcountry']).toUpperCase() : null
  let code = cf
  if (!code || !COUNTRIES.some((c) => c.code === code)) {
    const al = String(req.headers['accept-language'] || '')
    const m = al.match(/-([A-Za-z]{2})\b/)
    const guess = m ? m[1].toUpperCase() : null
    code = guess && COUNTRIES.some((c) => c.code === guess) ? guess : 'US'
  }
  return COUNTRIES.find((c) => c.code === code) || COUNTRIES.find((c) => c.code === 'US')!
}

api.get('/geo', (req, res) => {
  const forwarded = req.headers['x-forwarded-for']
  const clientIp = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || ''
  const countryInfo = detectCountry(req)
  res.json({ ip: clientIp, country: countryInfo.code, countryName: countryInfo.name, flag: countryInfo.flag, hue: countryInfo.hue, region: countryInfo.region })
})

// ============================================================
// HOME AGGREGATE � the whole home screen in ONE request
// ============================================================
// The app shell (index.html) is already static and instant; what made
// home feel slow was 3-4 separate API round trips (geo + trending +
// featured + community). /home answers all of them at once, entirely
// from warm caches (the hourly warmer keeps trending + featured hot),
// so home data arrives in milliseconds. `?country=XX` pins a chart,
// `?fresh=1` forces a live re-fetch.
const homeMem = new Map<string, { exp: number; val: any }>()
const HOME_MEM_TTL_MS = 120 * 1000

let commMem: { exp: number; val: any[] } | null = null
async function getCommunityCached(limit = 12): Promise<any[]> {
  if (commMem && commMem.exp > Date.now()) return commMem.val
  const { getPublicPlaylists } = await import('./server/db')
  const rows = (await getPublicPlaylists(undefined, limit)) || []
  commMem = { exp: Date.now() + HOME_MEM_TTL_MS, val: rows }
  return rows
}

api.get('/home', async (req, res) => {
  try {
    const fresh = String(req.query?.fresh || '') === '1'
    const asked = String(req.query?.country || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
    const country = (asked && COUNTRIES.find((c) => c.code === asked)) || detectCountry(req)
    const key = `home:${country.code}`
    if (!fresh) {
      const hit = homeMem.get(key)
      if (hit && hit.exp > Date.now()) return res.json({ ...hit.val, cached: true })
    }
    const [trending, feat, community, trendingPlaylists] = await Promise.all([
      getTrending(country.code, fresh).catch(() => ({ tracks: [], fallback: true })),
      getFeaturedCached(fresh).catch((): { packs: FeaturedPack[]; updatedAt: number } => ({ packs: [], updatedAt: Date.now() })),
      getCommunityCached(12).catch((): any[] => []),
      getTrendingPlaylists(country.code, fresh).catch(() => ({ playlists: [], source: 'none', updatedAt: Date.now() })),
    ])
    const featured = feat.packs
    // Genre tile covers: first-track artwork from the (already warm) genre
    // caches � cache reads only, never a live fetch, so /home stays instant.
    const genres = await Promise.all(
      GENRES.map(async (g) => {
        try {
          const hit = genreMem.get(`sc:genre:v4:${g.slug}`)
          const cached = hit && hit.exp > Date.now() ? hit.val : await dbGetCache(`sc:genre:v4:${g.slug}`)
          return {
            slug: g.slug,
            name: g.name,
            hue: g.hue,
            artwork: cached?.tracks?.[0]?.thumbnail || null,
            tracksCount: cached?.tracks?.length || 0,
          }
        } catch {
          return { slug: g.slug, name: g.name, hue: g.hue, artwork: null, tracksCount: 0 }
        }
      })
    )
    const out = {
      country: { code: country.code, name: country.name, flag: country.flag, hue: country.hue, region: country.region },
      trending: { tracks: (trending as any).tracks || [], fallback: !!(trending as any).fallback, source: (trending as any).source || null, updatedAt: (trending as any).updatedAt || Date.now() },
      featured,
      trendingPlaylists: (trendingPlaylists as any).playlists || [],
      trendingPlaylistsFallback: !!(trendingPlaylists as any).fallback,
      community,
      genres,
    }
    boundedMemSet(homeMem, key, { exp: Date.now() + HOME_MEM_TTL_MS, val: out })
    res.json(out)
  } catch (err) {
    console.error('home error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

// ?? Artist page ?????????????????????????????????????????????????????????????
async function artistAvatar(trackId: number): Promise<string> {
  try {
    const j = await scTrackJsonById(trackId)
    if (j?.user?.avatar_url) return j.user.avatar_url.replace('-large', '-t500x500')
  } catch { /* keep fallback */ }
  return ''
}

api.get('/music/artist/:name', async (req, res) => {
  try {
    // Express already URL-decodes params; decodeURIComponent again would
    // throw on a literal '%' and turn into a 500. Decode defensively.
    let name: string
    try { name = decodeURIComponent(req.params.name) } catch { name = req.params.name }
    const key = `sc:artist:${name.toLowerCase().slice(0, 120)}`
    const cached = await dbGetCache(key)
    if (cached) return res.json(cached)

    // Search for tracks by this artist (drop 30s preview snippets)
    const tracks = (await scSearchTracks(`artist:${name}`, 50)).filter((t) => !t.snippet)

    if (!tracks.length) {
      // Fallback: search without artist prefix
      const fallbackTracks = (await scSearchTracks(name, 50)).filter((t) => !t.snippet)
      if (!fallbackTracks.length) {
        return res.status(404).json({ error: 'artist_not_found' })
      }

      const avatar = await artistAvatar(fallbackTracks[0].id)
      const artistInfo = {
        name,
        avatar,
        tracks: fallbackTracks.map((t) => ({
          videoId: `sc_${t.id}`,
          title: t.title,
          artist: t.artist || name,
          thumbnail: t.thumbnail,
          duration: t.duration,
          permalink: t.permalink,
        })),
      }
      await dbSetCache(key, artistInfo, 3600)
      return res.json(artistInfo)
    }

    const avatar = await artistAvatar(tracks[0].id)
    const artistInfo = {
      name,
      avatar,
      tracks: tracks.map((t) => ({
        videoId: `sc_${t.id}`,
        title: t.title,
        artist: t.artist || name,
        thumbnail: t.thumbnail,
        duration: t.duration,
        permalink: t.permalink,
      })),
    }

    await dbSetCache(key, artistInfo, 3600)
    res.json(artistInfo)
  } catch (error: any) {
    console.warn('[artist] error:', error?.message)
    if (!res.headersSent) res.status(500).json({ error: error.message || 'Failed to fetch artist' })
  }
})

api.post('/playlists', authMiddleware, async (req: any, res) => {
  try {
    const { name, description, country, isPublic, coverGradient, coverEmoji } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'missing_name' })
    const { createPlaylist, getPlaylistById } = await import('./server/db')
    const id = await createPlaylist(req.userId, { name: String(name).trim().slice(0, 100), description: description ? String(description).slice(0, 500) : null, country: country || null, isPublic: isPublic !== false, coverGradient: coverGradient || null, coverEmoji: coverEmoji || null })
    res.json({ playlist: await getPlaylistById(id) })
  } catch (err) {
    console.error('create playlist error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

api.patch('/playlists/:id', authMiddleware, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id)
    const { name, description, country, isPublic, coverGradient, coverEmoji } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'missing_name' })
    const { updatePlaylist, getPlaylistById } = await import('./server/db')
    const playlist = await getPlaylistById(id)
    if (!playlist) return res.status(404).json({ error: 'not_found' })
    if (playlist.user_id !== req.userId) return res.status(403).json({ error: 'forbidden' })
    await updatePlaylist(id, req.userId, { name: String(name).trim().slice(0, 100), description: description ? String(description).slice(0, 500) : null, country: country || null, isPublic: isPublic !== false, coverGradient: coverGradient || null, coverEmoji: coverEmoji || null })
    res.json({ playlist: await getPlaylistById(id) })
  } catch (err) {
    console.error('update playlist error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

api.get('/playlists/mine', authMiddleware, async (req: any, res) => {
  try {
    const { getUserPlaylists } = await import('./server/db')
    res.json({ playlists: await getUserPlaylists(req.userId) })
  } catch {
    res.status(500).json({ error: 'server_error' })
  }
})

api.get('/playlists/public', async (req, res) => {
  try {
    const country = (req.query.country as string) || undefined
    const limit = parseInt((req.query.limit as string) || '30', 10)
    const { getPublicPlaylists } = await import('./server/db')
    res.json({ playlists: await getPublicPlaylists(country, limit) })
  } catch {
    res.status(500).json({ error: 'server_error' })
  }
})

api.get('/playlists/:id', async (req, res) => {
  try {
    const { getPlaylistById, getPlaylistSongs } = await import('./server/db')
    const id = parseInt(req.params.id)
    const playlist = await getPlaylistById(id)
    if (!playlist) return res.status(404).json({ error: 'not_found' })
    if (!playlist.is_public) {
      const header = req.headers.authorization
      if (!header) return res.status(403).json({ error: 'forbidden' })
      try {
        const payload = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET) as any
        if (payload.userId !== playlist.user_id) return res.status(403).json({ error: 'forbidden' })
      } catch {
        return res.status(403).json({ error: 'forbidden' })
      }
    }
    const songs = await getPlaylistSongs(id)
    res.json({ playlist, songs })
    // pre-warm streams for the first songs (fast start when the user hits Play)
    prefetchStreams(songs)
  } catch {
    res.status(500).json({ error: 'server_error' })
  }
})

api.delete('/playlists/:id', authMiddleware, async (req: any, res) => {
  try {
    const { deletePlaylist } = await import('./server/db')
    await deletePlaylist(parseInt(req.params.id), req.userId)
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'server_error' })
  }
})

api.post('/playlists/:id/songs', authMiddleware, async (req: any, res) => {
  try {
    const playlistId = parseInt(req.params.id)
    const { getPlaylistById, addSongToPlaylist } = await import('./server/db')
    const playlist = await getPlaylistById(playlistId)
    if (!playlist || playlist.user_id !== req.userId) return res.status(403).json({ error: 'forbidden' })
    const t = req.body || {}
    if (!t.title) return res.status(400).json({ error: 'missing_track' })
    const result = await addSongToPlaylist(playlistId, { videoId: t.videoId, trackId: t.videoId && t.videoId.startsWith('dz_') ? Number(t.videoId.slice(3)) : undefined, title: String(t.title).slice(0, 300), artist: String(t.artist || 'Unknown').slice(0, 300), thumbnail: t.thumbnail || t.cover, duration: t.duration || 0, directUrl: t.directUrl })
    res.json(result)
  } catch (err) {
    console.error('add song error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

api.delete('/playlists/:id/songs/:songId', authMiddleware, async (req: any, res) => {
  try {
    const playlistId = parseInt(req.params.id)
    const { getPlaylistById, removeSongFromPlaylist } = await import('./server/db')
    const playlist = await getPlaylistById(playlistId)
    if (!playlist || playlist.user_id !== req.userId) return res.status(403).json({ error: 'forbidden' })
    await removeSongFromPlaylist(playlistId, parseInt(req.params.songId))
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'server_error' })
  }
})

api.post('/playlists/:id/reorder', authMiddleware, async (req: any, res) => {
  try {
    const playlistId = parseInt(req.params.id)
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : []
    const { getPlaylistById, reorderSongs } = await import('./server/db')
    const playlist = await getPlaylistById(playlistId)
    if (!playlist || playlist.user_id !== req.userId) return res.status(403).json({ error: 'forbidden' })
    await reorderSongs(playlistId, ids)
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'server_error' })
  }
})

api.post('/playlists/from-chart', authMiddleware, async (req: any, res) => {
  try {
    const { name, country, tracks, coverGradient, coverEmoji } = req.body || {}
    if (!name || !Array.isArray(tracks) || !tracks.length) return res.status(400).json({ error: 'missing_fields' })
    const { createPlaylist, addSongToPlaylist, getPlaylistById, getPlaylistSongs } = await import('./server/db')
    const id = await createPlaylist(req.userId, { name: String(name).trim().slice(0, 100), description: `Saved from the ${String(country || 'Global').toUpperCase()} chart`, country: country || null, isPublic: true, coverGradient: coverGradient || null, coverEmoji: coverEmoji || null })
    for (const t of tracks.slice(0, 50)) {
      if (!t?.title) continue
      await addSongToPlaylist(id, { videoId: t.videoId, title: String(t.title).slice(0, 300), artist: String(t.artist || 'Unknown').slice(0, 300), thumbnail: t.thumbnail, duration: t.duration || 0, directUrl: t.directUrl })
    }
    res.json({ playlist: await getPlaylistById(id), songs: await getPlaylistSongs(id) })
  } catch (err) {
    console.error('from-chart error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

// Import a SoundCloud playlist/set into the user's library
api.post('/playlists/import', authMiddleware, async (req: any, res) => {
  try {
    const url = String(req.body?.url || '').trim()
    if (!soundcloudIsUrl(url)) return res.status(400).json({ error: 'bad_url', detail: 'Provide a soundcloud.com playlist link' })
    const r = await scResolveUrl(url)
    if (r?.kind === 'track' && r.track) {
      return res.status(400).json({ error: 'is_track', track: { videoId: `sc_${r.track.id}`, title: r.track.title, artist: r.track.artist, thumbnail: r.track.thumbnail, duration: r.track.duration, snippet: r.track.snippet, permalink: r.track.permalink } })
    }
    if (r?.kind !== 'playlist' || !r.playlist) return res.status(404).json({ error: 'playlist_not_found' })

    const full = await scPlaylistById(r.playlist.id)
    if (!full?.tracks?.length) return res.status(404).json({ error: 'playlist_empty' })

    const { createPlaylist, addSongToPlaylist, getPlaylistById, getPlaylistSongs } = await import('./server/db')
    const id = await createPlaylist(req.userId, {
      name: full.playlist.title.slice(0, 100),
      description: (full.playlist.description || 'Imported from SoundCloud').slice(0, 500),
      isPublic: true,
      coverGradient: null,
      coverEmoji: '☁️',
      externalUrl: full.playlist.permalink || url,
    } as any)
    let added = 0
    for (const t of full.tracks.slice(0, 200)) {
      if (!t?.id) continue
      await addSongToPlaylist(id, {
        videoId: `sc_${t.id}`,
        title: String(t.title).slice(0, 300),
        artist: String(t.artist).slice(0, 300),
        thumbnail: t.thumbnail,
        duration: t.duration || 0,
        source: 'sc',
      })
      added++
    }
    res.json({ playlist: await getPlaylistById(id), added, total: full.tracks.length, songs: await getPlaylistSongs(id) })
  } catch (err) {
    console.error('sc import error:', err)
    res.status(500).json({ error: 'server_error' })
  }
})

// ============================================================
// SOUND CLOUD — playback engine (progressive mp3 + HLS proxy)
// ============================================================

function scAllowed(u: string): boolean {
  try {
    const host = new URL(u).hostname.toLowerCase()
    return SC_ALLOWED_HOSTS.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))
  } catch {
    return false
  }
}

// ------------------------------------------------------------
// Safe upstream piping for the audio proxies.
//
// The old code fetched with `AbortSignal.timeout(30000)` and piped the body
// with zero error handlers. Two fatal consequences:
//   1) the 30s abort fires MID-STREAM (browsers read media lazily �
//      backpressure keeps a track download open far longer than 30s), which
//      errors the web body stream;
//   2) `Readable.fromWeb(body)` then emitted 'error' with no listener ?
//      unhandled 'error' event ? the Node PROCESS died ? the whole app
//      (player + API) went down for the user ("any button kills the app").
// Now: the timeout only guards the connect/headers phase (cleared as soon as
// headers arrive, so the body is never aborted mid-download), every stream
// error is caught and torn down, and an idle watchdog drops stalled bodies.
// Uninterrupted full-track streaming is preserved; the process stays alive.
// ------------------------------------------------------------
const CONNECT_TIMEOUT_MS = 20000
const BODY_IDLE_TIMEOUT_MS = 30000

async function fetchUpstream(url: string, headers: Record<string, string>, tag: string): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), CONNECT_TIMEOUT_MS)
  try {
    return await fetch(url, { headers, signal: ac.signal, redirect: 'follow' })
  } catch (e: any) {
    // Direct connect failed (blocked origin / network hiccup): retry the
    // same request through the netopen channel when one is configured, so
    // audio segments keep flowing even if the media host gets blocked too.
    const viaNet = await netopenFetch(url, { headers })
    if (viaNet) return viaNet
    console.warn(`[${tag}] connect failed:`, e?.message || e)
    throw e
  } finally {
    clearTimeout(timer) // headers arrived � the body stream must never be aborted
  }
}

function pipeUpstreamToRes(upstream: Response, req: any, res: any, tag: string) {
  if (!upstream.body) {
    res.end()
    return
  }
  const reader = Readable.fromWeb(upstream.body as any)
  let idle: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    console.warn(`[${tag}] body idle ${BODY_IDLE_TIMEOUT_MS / 1000}s � dropping stream`)
    reader.destroy()
  }, BODY_IDLE_TIMEOUT_MS)
  reader.on('data', () => { if (idle) idle.refresh() })
  const stopIdle = () => { if (idle) { clearTimeout(idle); idle = null } }
  reader.on('error', (err: any) => {
    stopIdle()
    console.warn(`[${tag}] upstream body error:`, err?.message || err)
    if (!res.writableEnded) res.destroy()
  })
  res.on('error', (err: any) => {
    stopIdle()
    console.warn(`[${tag}] client response error:`, err?.message || err)
    reader.destroy()
  })
  res.on('close', () => { if (!res.writableEnded) reader.destroy() })
  req.on('close', () => { if (!res.writableEnded) reader.destroy() })
  reader.pipe(res)
}

// HLS playlist proxy — resolves the track, fetches the signed m3u8 and rewrites
// every URI through our own proxy so playback works from any origin, no CORS,
// no IP lock, no expiry issues during a session.
api.get('/sc/stream/:id/playlist.m3u8', async (req, res) => {
  try {
    const scId = extractScId(req.params.id)
    if (!scId) return res.status(400).json({ error: 'bad_id' })
    let streams = await scStreamsById(scId)
    let target = streams.hls
    if (!target) {
      invalidateScStreams(scId)
      streams = await scStreamsById(scId)
      target = streams.hls
    }
    if (!target) return res.status(404).json({ error: 'no_hls' })

    // Validate the signed URL is still usable; re-mint once if expired.
    try {
      const chk = await fetch(target, { method: 'HEAD', headers: { 'User-Agent': SC_UA }, signal: AbortSignal.timeout(15000) })
      if (!chk.ok) {
        invalidateScStreams(scId)
        streams = await scStreamsById(scId)
        target = streams.hls
        if (!target) return res.status(404).json({ error: 'no_hls' })
      }
    } catch { /* network hiccup: try fetch anyway */ }

    // Fetch the signed m3u8 (direct, falling back to the netopen channel when
    // the pod cannot reach the CDN) and rewrite every URI through our own
    // byte proxy so playback never touches the origin directly.
    let upstream: Response
    try {
      upstream = await fetchUpstream(target as string, { 'User-Agent': SC_UA }, 'sc-hls')
    } catch (e: any) {
      console.warn('[sc-hls] connect failed:', e?.message)
      return res.status(502).json({ error: 'upstream_error' })
    }
    if (!upstream.ok) {
      invalidateScStreams(scId)
      streams = await scStreamsById(scId)
      target = streams.hls
      if (!target) return res.status(404).json({ error: 'no_hls' })
      try {
        upstream = await fetchUpstream(target as string, { 'User-Agent': SC_UA }, 'sc-hls')
      } catch (e: any) {
        console.warn('[sc-hls] connect failed:', e?.message)
        return res.status(502).json({ error: 'upstream_error' })
      }
      if (!upstream.ok) return res.status(502).json({ error: 'upstream_error' })
    }
    const m3u8Text = await upstream.text()
    const proxyUrl = (u: string) => {
      let absolute = u
      try { absolute = new URL(u, target as string).toString() } catch { /* keep */ }
      return `${BASE}/api/sc/proxy?u=${encodeURIComponent(absolute)}`
    }
    const rewritten = m3u8Text.split(/\r?\n/).map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${proxyUrl(uri)}"`)
      }
      return proxyUrl(trimmed)
    }).join('\n')

    res.setHeader('access-control-allow-origin', '*')
    res.type('application/vnd.apple.mpegurl')
    res.send(rewritten)
  } catch (e: any) {
    console.warn('[sc-hls] error:', e?.message)
    if (!res.headersSent) res.status(502).json({ error: 'upstream_error' })
  }
})

// Stable full-track mp3 endpoint � mints a FRESH signed CDN url (10-min cache)
// and STREAMS the bytes through us with Range/seek support. The client only
// ever talks to our origin (no slow second DNS+TLS to the CDN, no expiry 403).
api.get('/sc/stream/:id/audio.mp3', async (req, res) => {
  try {
    const scId = extractScId(req.params.id)
    if (!scId) return res.status(400).json({ error: 'bad_id' })
    let streams = await scStreamsById(scId)
    if (!streams.progressive && !streams.hls) return res.status(404).json({ error: 'no_stream' })
    if (!streams.progressive) return res.redirect(302, `${BASE}/api/sc/stream/${scId}/playlist.m3u8`)

    let target: string | null = streams.progressive
    // Validate the signed URL; re-mint once if expired.
    try {
      const chk = await fetch(target as string, { method: 'HEAD', headers: { 'User-Agent': SC_UA }, signal: AbortSignal.timeout(15000) })
      if (!chk.ok) {
        invalidateScStreams(scId)
        streams = await scStreamsById(scId)
        target = streams.progressive
        if (!target) {
          if (streams.hls) return res.redirect(302, `${BASE}/api/sc/stream/${scId}/playlist.m3u8`)
          return res.status(404).json({ error: 'no_stream' })
        }
      }
    } catch { /* network hiccup: try stream anyway */ }

    if (!target) {
      if (streams.hls) return res.redirect(302, `${BASE}/api/sc/stream/${scId}/playlist.m3u8`)
      return res.status(404).json({ error: 'no_stream' })
    }

    // Stream the mp3 bytes through our origin (Range passthrough) so the
    // browser never talks to the CDN directly - tunnel-aware, no IP lock.
    const headers: Record<string, string> = { 'User-Agent': SC_UA }
    if (req.headers.range) headers.Range = String(req.headers.range)
    let upstream: Response
    try {
      upstream = await fetchUpstream(target as string, headers, 'sc-audio')
    } catch (e: any) {
      console.warn('[sc-audio] connect failed:', e?.message)
      return res.status(502).json({ error: 'upstream_error' })
    }
    res.status(upstream.status)
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges'] as const) {
      const v = upstream.headers.get(h)
      if (v) res.setHeader(h, v)
    }
    res.setHeader('access-control-allow-origin', '*')
    pipeUpstreamToRes(upstream, req, res, 'sc-audio')
  } catch (e: any) {
    console.warn('[sc-audio] error:', e?.message)
    if (!res.headersSent) res.status(502).json({ error: 'upstream_error' })
  }
})

// Byte proxy for HLS segments/init (allowlisted SoundCloud hosts only)
api.get('/sc/proxy', async (req, res) => {
  const u = String(req.query.u || '')
  if (!u || !scAllowed(u)) return res.status(400).json({ error: 'bad_url' })
  try {
    const headers: Record<string, string> = { 'User-Agent': SC_UA }
    if (req.headers.range) headers.Range = String(req.headers.range)
    const upstream = await fetchUpstream(u, headers, 'sc-proxy')
    res.status(upstream.status)
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges'] as const) {
      const v = upstream.headers.get(h)
      if (v) res.setHeader(h, v)
    }
    res.setHeader('access-control-allow-origin', '*')
    pipeUpstreamToRes(upstream, req, res, 'sc-proxy')
  } catch (e: any) {
    console.warn('[sc-proxy] error:', e?.message)
    if (!res.headersSent) res.status(502).json({ error: 'upstream_error' })
  }
})

// Direct full-length mp3 (progressive transcoding) - stable endpoint redirect
api.get('/sc/progressive/:id', async (req, res) => {
  try {
    const scId = extractScId(req.params.id)
    if (!scId) return res.status(400).json({ error: 'bad_id' })
    res.redirect(`${BASE}/api/sc/stream/${scId}/audio.mp3`)
  } catch {
    res.status(502).json({ error: 'upstream_error' })
  }
})


api.get('/soundcloud/stream/:trackId', async (req, res) => {
  try {
    const scId = extractScId(req.params.trackId)
    if (!scId) return res.status(400).json({ error: 'bad_id' })
    res.redirect(`${BASE}/api/sc/stream/${scId}/audio.mp3`)
  } catch (err: any) {
    console.warn(`[soundcloud] error:`, err?.message)
    res.status(500).json({ error: 'soundcloud_error' })
  }
})

api.get('/soundcloud/info/:trackId', async (req, res) => {
  try {
    const scId = extractScId(req.params.trackId)
    if (!scId) return res.status(400).json({ error: 'bad_id' })
    const track = await scTrackById(scId)
    if (!track) return res.status(404).json({ error: 'not_found' })
    res.json(track)
  } catch {
    res.status(500).json({ error: 'server_error' })
  }
})

// ============================================================
// AUDIO ENDPOINT - SoundCloud playback (full-length, seekable)
// ============================================================
api.get('/audio/:videoId', async (req, res) => {
  const videoId = String(req.params.videoId || '')
  const q = String(req.query.q || '')

  // SoundCloud: sc_<id>, numeric id, or full permalink -> redirect to a playable stream
  const scId = extractScId(videoId)
  if (scId) {
    try {
      const streams = await scStreamsById(scId)
      if (streams.progressive) return res.redirect(`${BASE}/api/sc/stream/${scId}/audio.mp3`)
      if (streams.hls) return res.redirect(`${BASE}/api/sc/stream/${scId}/playlist.m3u8`)
    } catch (e: any) {
      console.warn(`[audio] soundcloud failed:`, e?.message)
    }
    return res.status(404).json({ error: 'no_stream' })
  }

  const decoded = decodeURIComponent(videoId)
  if (soundcloudIsUrl(decoded)) {
    try {
      const r = await scResolveUrl(decoded)
      if (r?.kind === 'track' && r.track) {
        const streams = await scStreamsById(r.track.id)
        if (streams.progressive) return res.redirect(`${BASE}/api/sc/stream/${r.track.id}/audio.mp3`)
        if (streams.hls) return res.redirect(`${BASE}/api/sc/stream/${r.track.id}/playlist.m3u8`)
      }
    } catch (e: any) {
      console.warn(`[audio] soundcloud failed:`, e?.message)
    }
    return res.status(404).json({ error: 'no_stream' })
  }

  // Legacy ids (non-SoundCloud entries from old saved playlists):
  // remap to SoundCloud by title+artist (?q=) and redirect to the best stream.
  if (q.trim()) {
    try {
      const out = await resolveStreams(videoId, q)
      const best = out?.streams?.[0]
      if (best) return res.redirect(best.url)
    } catch (e: any) {
      console.warn(`[audio] remap failed:`, e?.message)
    }
  }

  return res.status(404).json({ error: 'no_stream', detail: 'Playback moved to SoundCloud - pass ?q=title artist for legacy ids' })
})

// dual-mount: /api/* (direct) and /playlist/api/* (through portal gateway)
app.use('/api', api)
app.use(`${BASE}/api`, api)
app.use(`${LEGACY_BASE}/api`, api)
// Unknown /api/* paths must answer JSON (never the SPA shell): without this
// a typo'd endpoint returns index.html with 200 and the client mis-parses it.
app.use(['/api', `${BASE}/api`, `${LEGACY_BASE}/api`], (_req, res) => {
  if (!res.headersSent) res.status(404).json({ error: 'not_found' })
})

const distPath = path.join(process.cwd(), 'dist')
// Perf: hashed assets are content-addressed ? immutable 1y (both direct and
// prefixed paths, like the dual static mounts below).
app.use('/assets', express.static(path.join(distPath, 'assets'), { maxAge: '1y', immutable: true }))
app.use(`${BASE}/assets`, express.static(path.join(distPath, 'assets'), { maxAge: '1y', immutable: true }))
app.use(`${LEGACY_BASE}/assets`, express.static(path.join(distPath, 'assets'), { maxAge: '1y', immutable: true }))
app.use(`${BASE}`, express.static(distPath))
app.use(`${LEGACY_BASE}`, express.static(distPath))
app.use(express.static(distPath))

app.get(['/robots.txt', `${BASE}/robots.txt`, `${LEGACY_BASE}/robots.txt`], (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: https://bidbes.com/music-atlas/sitemap.xml\nDisallow: /api/audio/\n`)
})

app.get(['/sitemap.xml', `${BASE}/sitemap.xml`, `${LEGACY_BASE}/sitemap.xml`], (_req, res) => {
  const host = 'https://bidbes.com/music-atlas'
  // NOTE: /auth (login wall) and /library (account-gated) are deliberately
  // excluded � thin/protected URLs waste crawl budget. The app uses hash
  // routing (#/country/..), so country/genre locs resolve to the SPA shell;
  // a history-router migration (pathname routing + per-route heads, like
  // signal) is the real fix for deep-URL indexability � tracked separately.
  const staticUrls = ['', '/about', '/terms', '/explore', '/search'].map((p) => `<url><loc>${host}${p}</loc><changefreq>daily</changefreq><priority>${p === '' ? '1.0' : '0.6'}</priority></url>`)
  const countryUrls = COUNTRIES.map((c) => `<url><loc>${host}/country/${c.code}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`)
  const genreUrls = GENRES.map((g) => `<url><loc>${host}/genre/${g.slug}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>`)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${staticUrls.join('\n')}\n${countryUrls.join('\n')}\n${genreUrls.join('\n')}\n</urlset>`
  res.type('application/xml').send(xml)
})

app.get(['/llms.txt', `${BASE}/llms.txt`], (_req, res) => {
  res.type('text/plain').send(`# Music Atlas (AEO & AI Search Knowledge)\n\n## Overview\nMusic Atlas is a free, global music discovery and streaming platform powered by SoundCloud. Search millions of tracks, browse per-country charts, and import SoundCloud playlists - all with full-length playback and no subscription.\n\n## Key Capabilities\n- Full-length SoundCloud audio streaming (progressive mp3 + HLS) without paywalls.\n- SoundCloud Integration: paste any soundcloud.com track or playlist link to play or import it.\n- Genre packs and discovery charts (Top, Pop, Hip-Hop, Electronic, Lofi, Persian, K-Pop, Afrobeats).\n- Geographic coverage: trending music for all ISO 3166-1 countries.\n- Personal cloud playlist creator and library manager.\n\n## API & Endpoints\n- Search: GET /api/music/search?q={query_or_soundcloud_url}\n- Trending by Country: GET /api/music/trending/{countryCode}\n- Featured Packs: GET /api/music/featured | GET /api/music/charts/{packId}\n- SoundCloud Playlist Resolve: GET /api/music/soundcloud/playlist?url={permalink}\n- SoundCloud Playlist Search: GET /api/music/sc/playlists?q={query}\n- Stream (track): GET /api/audio/{sc_id} | HLS: GET /api/sc/stream/{sc_id}/playlist.m3u8\n- Geo-Personalization: GET /api/geo\n`)
})

// Standalone crawlable legal/info pages (SEO/GEO/AEO) � real HTML files from
// the dist root so crawlers get fully-formed documents (never the SPA shell).
app.get(['/about', '/terms', `${BASE}/about`, `${BASE}/terms`], (req, res) => {
  const page = req.path.endsWith('/terms') || req.path === '/terms' ? 'terms' : 'about'
  const file = path.join(process.cwd(), 'dist', `${page}.html`)
  if (fs.existsSync(file)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    return res.sendFile(file)
  }
  res.status(404).send('Not found')
})

app.get(['/.well-known/ai-plugin.json', `${BASE}/.well-known/ai-plugin.json`], (_req, res) => {
  res.json({ schema_version: 'v1', name_for_model: 'music_atlas', name_for_human: 'Music Atlas', description_for_model: 'Search, discover and stream full-length SoundCloud tracks, per-country charts, genre packs, and import SoundCloud playlists.', description_for_human: 'Explore and stream the music of every nation free.', auth: { type: 'none' }, api: { type: 'openapi', url: '/api-docs' }, contact_email: 'support@tuneatlas.app', legal_info_url: 'https://bidbes.com/music-atlas/terms' })
})

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) res.status(404).send('Not found')
  })
})

// ============================================================
// CACHE WARMER � featured packs + top country charts stay ready
// ============================================================
// The featured endpoint fans out to 10 SoundCloud searches (~seconds).
// Without warming, the first user after a cache expiry stares at the
// skeleton while the server fetches. The warmer refreshes everything in
// the background on boot + every hour, so users always hit warm cache.
// It never throws, never overlaps itself, and never blocks listen().
const WARM_COUNTRIES = ['US', 'CN', 'IN', 'IR', 'ES', 'BR', 'MX', 'JP', 'TR', 'DE', 'GB', 'FR', 'IT', 'KR']
const WARM_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
const WARM_GAP_MS = 1500 // politeness gap between upstream calls

let warming = false
async function warmCaches(tag: string) {
  if (warming) return
  warming = true
  try {
    const packs = await fetchFeaturedPacks()
    if (packs.length) {
      await dbSetCache(FEATURED_CACHE_KEY, packs, FEATURED_TTL_SEC)
      rememberFeatured(packs)
    }
    console.log(`[warm:${tag}] featured ok (${packs.length} packs)`)
    // Pre-resolve the first two pages of the first packs shown on home,
    // so opening a pack is instant (no per-pack live fetch on tap).
    // `fresh` = true: bypass caches so the hourly cycle truly refreshes
    // (otherwise the warmer would just re-serve the stale entry).
    // Bounded to 10 to keep the hourly cycle polite to upstream.
    for (const p of packs.slice(0, 10)) {
      try {
        await getPackPage(p.id, 0, PACK_PAGE_DEFAULT * 2, true)
      } catch (e: any) {
        console.warn(`[warm:${tag}] pack ${p.id}:`, e?.message || e)
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    // Trending-by-genre rails (single cheap call each, discover-set + search fallback included).
    for (const g of GENRES) {
      try {
        const { tracks, source } = await getGenreTracks(g)
        if (tracks.length) {
          const out = {
            genre: g,
            playlist: {
              id: `genre:${g.slug}`,
              name: `${g.name} Trending`,
              artwork: tracks[0]?.thumbnail || null,
              tracksCount: tracks.length,
              permalink: '',
            },
            tracks,
            source,
            updatedAt: Date.now(),
          }
          await dbSetCache(`sc:genre:v4:${g.slug}`, out, 3600)
          await dbSetStale(`sc:genre:v4:${g.slug}`, out)
          boundedMemSet(genreMem, `sc:genre:v4:${g.slug}`, { exp: Date.now() + 300 * 1000, val: out })
        }
      } catch (e: any) {
        console.warn(`[warm:${tag}] genre ${g.slug}:`, e?.message || e)
      }
      await new Promise((r) => setTimeout(r, 800))
    }
    for (const cc of WARM_COUNTRIES) {
      try {
        await getTrending(cc, true) // bypass cache ? re-fetch + re-cache
      } catch (e: any) {
        console.warn(`[warm:${tag}] trending ${cc}:`, e?.message || e)
      }
      try {
        await getTrendingPlaylists(cc, true)
      } catch (e: any) {
        console.warn(`[warm:${tag}] trendpl ${cc}:`, e?.message || e)
      }
      await new Promise((r) => setTimeout(r, WARM_GAP_MS))
    }
    console.log(`[warm:${tag}] done`)
  } catch (e: any) {
    console.warn(`[warm:${tag}] failed:`, e?.message || e)
  } finally {
    warming = false
  }
}

setTimeout(() => warmCaches('boot'), 5000)
const warmTimer = setInterval(() => warmCaches('hourly'), WARM_INTERVAL_MS)
if (typeof (warmTimer as any).unref === 'function') (warmTimer as any).unref()

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[music-atlas] running on port ${PORT}`)
})


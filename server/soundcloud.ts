// SoundCloud engine â€” api-v2 based (keyless, client_id only).
// Track metadata, search, playlists, and full-length playback (progressive
// mp3 + HLS aac_160k) with no third-party instances and no API keys.
import { cacheGet, cacheSet, cacheDel } from './db'
import { scFetch } from './scRelay'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const API = 'https://api-v2.soundcloud.com'

// ---------------- client_id pool (self-healing) ----------------
// SoundCloud rotates/reorders its JS bundles and retires client_ids without
// notice (outage Sep 2026: the id moved to the last 2.8MB chunk while we
// scanned only the first 8 scripts, so EVERY api call returned null and all
// charts went empty). This module therefore treats every id as expendable:
//   - a POOL of probe-validated ids is kept (env + scraped + fallbacks),
//   - api calls use the pool head; any 401 marks that head DEAD and the next
//     validated id is promoted instantly — no restart, no deploy, no gap,
//   - dead ids stay quarantined (1h) so a re-scrape can't resurrect them,
//   - a background warmer tops the pool up every 6h while ids still work,
//   - SC_CLIENT_ID env is a manual override (ops hot-fix without deploy).
let clientIdMemo: { id: string; until: number } | null = null
let clientIdPromise: Promise<string | null> | null = null
let rotationPromise: Promise<string | null> | null = null
let clientIdMeta: { source: string; at: number } | null = null
let warmerStarted = false

/** Validated working ids, head = active. */
let pool: string[] = []
/** Quarantined ids (id -> timestamp when eligible again). */
const dead = new Map<string, number>()

const CLIENT_ID_TTL_MS = 24 * 3600_000
const CLIENT_ID_REFRESH_MS = 6 * 3600_000
const DEAD_TTL_MS = 1 * 3600_000
const POOL_MAX = 5
const POOL_CACHE_KEY = 'sc:client_id_pool'
const CLIENT_ID_PAGES = [
  'https://soundcloud.com/',
  'https://soundcloud.com/discover',
]
const CLIENT_ID_PATTERNS = [
  /client_id\s*[=:]\s*["']([a-zA-Z0-9]{20,64})["']/g,
  /clientId\s*[=:]\s*["']([a-zA-Z0-9]{20,64})["']/g,
  /clientID\s*[=:]\s*["']([a-zA-Z0-9]{20,64})["']/g,
  /"client_id"\s*:\s*"([a-zA-Z0-9]{20,64})"/g,
]
// Last-resort seeds: probe-validated before joining the pool, so a stale
// entry simply fails the probe instead of poisoning anything.
const FALLBACK_CLIENT_IDS = ['Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo']

function envClientId(): string | null {
  const v = (process.env.SC_CLIENT_ID || process.env.SOUNDCLOUD_CLIENT_ID || '').trim()
  return /^[a-zA-Z0-9]{20,64}$/.test(v) ? v : null
}

/** A candidate is only real if api-v2 answers 2xx with it. */
async function probeClientId(id: string): Promise<boolean> {
  try {
    // scFetch: direct connect first, relay pool when the pod's network
    // cannot reach api-v2 (Iranian SNI block, Nov 2026).
    const res = await scFetch(`${API}/search/tracks?q=top&limit=1&client_id=${id}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    return !!res && res.ok
  } catch {
    return false
  }
}

function isDead(id: string): boolean {
  const until = dead.get(id)
  if (!until) return false
  if (until <= Date.now()) { dead.delete(id); return false }
  return true
}

/** Quarantine a 401'd id so neither the pool nor a re-scrape reuses it. */
function markDead(id: string) {
  if (!id) return
  dead.set(id, Date.now() + DEAD_TTL_MS)
  pool = pool.filter((x) => x !== id)
}

function persistPool() {
  cacheSet(POOL_CACHE_KEY, pool, CLIENT_ID_TTL_MS / 1000).catch(() => {})
  if (pool[0]) cacheSet('sc:client_id', pool[0], CLIENT_ID_TTL_MS / 1000).catch(() => {})
}

/** Probe ids and admit the working ones into the pool (bounded). */
async function validateIntoPool(ids: string[]): Promise<void> {
  const fresh = ids.filter((id) => id && !isDead(id) && !pool.includes(id))
  for (let i = 0; i < fresh.length && pool.length < POOL_MAX; i += 3) {
    const results = await Promise.all(
      fresh.slice(i, i + 3).map(async (c) => ((await probeClientId(c)) ? c : null))
    )
    for (const hit of results) {
      if (hit && !isDead(hit) && !pool.includes(hit) && pool.length < POOL_MAX) pool.push(hit)
    }
  }
  if (pool.length) persistPool()
}

/** Scrape every script of every page source, collect all distinct candidates. */
async function collectCandidates(): Promise<string[]> {
  const found = new Set<string>()
  for (const page of CLIENT_ID_PAGES) {
    let scripts: string[] = []
    try {
      // The page HTML itself rides the relay when soundcloud.com is blocked;
      // the script bundles it lists live on a-v2.sndcdn.com which the pod
      // reaches DIRECTLY, so those stay fast.
      const res = await scFetch(page, { headers: { 'User-Agent': UA } })
      if (!res || !res.ok) continue
      const html = await res.text()
      scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m: RegExpMatchArray) => m[1])
    } catch { continue }
    // Bounded: 4 concurrent asset downloads; bundle order can't be trusted,
    // so every script of every page is scanned for pool depth.
    for (let i = 0; i < scripts.length; i += 4) {
      const texts = await Promise.all(
        scripts.slice(i, i + 4).map(async (src) => {
          try {
            const sr = await fetch(src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
            if (!sr.ok) return ''
            return await sr.text()
          } catch { return '' }
        })
      )
      for (const js of texts) {
        if (!js) continue
        for (const pat of CLIENT_ID_PATTERNS) {
          pat.lastIndex = 0
          let m: RegExpExecArray | null
          let n = 0
          while ((m = pat.exec(js)) && n++ < 20) found.add(m[1])
        }
        if (found.size > 50) break
      }
      if (found.size > 50) break
    }
  }
  return [...found]
}

/** Fill the pool from every source (env -> scrape -> fallbacks). */
async function topUpPool(): Promise<string | null> {
  const env = envClientId()
  if (env) await validateIntoPool([env])
  const candidates = await collectCandidates()
  await validateIntoPool(candidates)
  await validateIntoPool(FALLBACK_CLIENT_IDS)
  return pool[0] || null
}

function useHead(source: string): string | null {
  const head = pool[0] || null
  if (head) {
    clientIdMemo = { id: head, until: Date.now() + CLIENT_ID_TTL_MS }
    clientIdMeta = { source, at: Date.now() }
    persistPool()
  }
  return head
}

/** Background warmer: top the pool up while the head still works. */
function ensureWarmer() {
  if (warmerStarted) return
  warmerStarted = true
  const t = setInterval(async () => {
    try {
      const before = pool.length
      await topUpPool()
      if (pool.length > before) console.log(`[soundcloud] pool topped up (${pool.length} ids)`)
      useHead(clientIdMeta?.source || 'warmer')
    } catch (e: any) {
      console.warn('[soundcloud] background refresh failed:', e?.message || e)
    }
  }, CLIENT_ID_REFRESH_MS)
  if (typeof (t as any).unref === 'function') (t as any).unref()
}

/** Back-compat shim: validated mint, null only when all sources fail. */
async function fetchClientIdFromAssets(): Promise<string | null> {
  await topUpPool()
  return useHead('scrape')
}

export async function getClientId(): Promise<string | null> {
  // Fast path: working head.
  if (clientIdMemo && clientIdMemo.until > Date.now() && pool.includes(clientIdMemo.id)) {
    return clientIdMemo.id
  }

  // If already fetching, reuse the same promise (dedup concurrent requests)
  if (clientIdPromise) return clientIdPromise

  clientIdPromise = (async () => {
    // Ops escape hatch first: a restart with SC_CLIENT_ID set takes effect
    // immediately, even when the cache still holds other ids.
    const env = envClientId()
    if (env && !isDead(env)) {
      pool = [env, ...pool.filter((x) => x !== env)]
      if (await probeClientId(env)) {
        ensureWarmer()
        return useHead('env')
      }
      markDead(env)
    }
    try {
      // Rebuild from the persisted pool (every entry re-validated — a dead
      // id saved earlier fails its probe and is skipped, never served).
      const row = await cacheGet(POOL_CACHE_KEY)
      const saved = Array.isArray(row?.value) ? row.value.filter((x: any) => typeof x === 'string') : []
      const legacy = await cacheGet('sc:client_id')
      const legacyId = typeof legacy?.value === 'string' ? legacy.value : legacy?.value?.id
      if (typeof legacyId === 'string') saved.unshift(legacyId)
      await validateIntoPool(saved)
      if (pool[0]) {
        ensureWarmer()
        // Heal forward in the background without disturbing the head.
        topUpPool().then(() => useHead(clientIdMeta?.source || 'pool')).catch(() => {})
        return useHead('pool')
      }
    } catch { /* db optional */ }

    // Cold start: fill from every live source, all probe-validated.
    await topUpPool()
    ensureWarmer()
    return useHead('mint')
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

/**
 * Kill the failed id and promote the next validated one — the core of the
 * pool: a retired client_id heals itself on the very request that discovers
 * it, with zero downtime and zero operator action.
 * Serialized so a 401 storm mints/rotates exactly once.
 */
export async function rotateClientId(failedId?: string): Promise<string | null> {
  if (failedId) markDead(failedId)
  if (clientIdMemo && failedId && clientIdMemo.id === failedId) clientIdMemo = null
  if (rotationPromise) return rotationPromise
  rotationPromise = (async () => {
    // Promote the next pool member (probe it — cheap, limit=1).
    while (pool.length) {
      const next = pool[0]
      if (await probeClientId(next)) {
        console.log('[soundcloud] client_id rotated to pooled id')
        return useHead('rotate')
      }
      markDead(next)
    }
    // Pool exhausted: scrape fresh.
    await topUpPool()
    if (pool[0]) {
      console.log('[soundcloud] client_id re-minted after pool exhaustion')
      return useHead('scrape')
    }
    try { await cacheDel('sc:client_id'); await cacheDel(POOL_CACHE_KEY) } catch { /* ignore */ }
    return null
  })()
  try {
    return await rotationPromise
  } finally {
    rotationPromise = null
  }
}

/** Drop the memo without quarantine (kept for back-compat callers). */
export async function invalidateClientId(): Promise<void> {
  clientIdMemo = null
  clientIdMeta = null
  clientIdPromise = null
  try { await cacheDel('sc:client_id') } catch { /* ignore */ }
}

/** Observability for /api/music/instances: source + age + pool depth. */
export function clientIdStatus(): { ok: boolean; source: string | null; ageH: number | null; pool: number; dead: number } {
  const ok = !!clientIdMemo && clientIdMemo.until > Date.now()
  return {
    ok,
    source: ok ? clientIdMeta?.source || 'cache' : null,
    ageH: ok && clientIdMeta ? Math.round(((Date.now() - clientIdMeta.at) / 3600_000) * 10) / 10 : null,
    pool: pool.length,
    dead: dead.size,
  }
}

async function scApi<T = any>(path: string, params: Record<string, string | number | undefined> = {}, retried = false): Promise<T | null> {
  const cid = await getClientId()
  if (!cid) return null
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) qs.set(k, String(v))
  qs.set('client_id', cid)
  try {
    // scFetch: direct first, relay pool when the pod cannot reach api-v2.
    const res = await scFetch(`${API}${path}?${qs.toString()}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (!res) return null
    // Dead/retired client_id → quarantine it, promote the next pooled id,
    // and retry ONCE with a working one. Zero downtime, zero operator action.
    if (res.status === 401 && !retried) {
      const next = await rotateClientId(cid)
      if (!next) return null
      return scApi<T>(path, params, true)
    }
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

// ---------------- types ----------------
export interface ScTrack {
  id: number
  title: string
  artist: string
  duration: number
  thumbnail: string
  permalink: string
  snippet: boolean
  /** Freshness / popularity signals (0 when upstream omits them). */
  createdAt: number
  playbackCount: number
  likesCount: number
  repostsCount: number
}

export interface ScPlaylist {
  id: number
  title: string
  description: string
  trackCount: number
  artworkUrl: string
  permalink: string
  /** Freshness / popularity signals (0 when upstream omits them). */
  createdAt: number
  lastModified: number
  likesCount: number
  repostsCount: number
}

interface Transcoding { format?: { protocol?: string; mime_type?: string }; url?: string }
export interface ScTrackJson {
  id?: number
  title?: string
  duration?: number
  full_duration?: number
  policy?: string
  artwork_url?: string
  permalink_url?: string
  created_at?: string
  last_modified?: string
  playback_count?: number
  likes_count?: number
  reposts_count?: number
  user?: { username?: string; avatar_url?: string }
  media?: { transcodings?: Transcoding[] }
  tracks?: ScTrackJson[]
}
interface ScPlaylistJson {
  id?: number
  title?: string
  description?: string
  track_count?: number
  artwork_url?: string
  permalink_url?: string
  created_at?: string
  last_modified?: string
  likes_count?: number
  reposts_count?: number
  tracks?: ScTrackJson[]
}

// SoundCloud policy values observed in the wild: ALLOW (free full-length),
// MONETIZE (label/monetized full-length with working transcodings — this is
// now the DEFAULT for most tracks, Oct 2026), SNIPPET (30s preview), BLOCK.
// An allowlist (`!== 'ALLOW'`) silently dropped every MONETIZE track and
// emptied all country charts — so this is a BLOCKLIST: only explicit preview
// policies count, plus the duration-ratio check which catches real 30s
// previews regardless of what policy string upstream invents next.
const SNIPPET_POLICIES = new Set(['SNIPPET', 'BLOCK', 'BLOCKED', 'DENY', 'DENIED', 'RESTRICTED', 'PREVIEW'])

export function mapTrack(t: ScTrackJson): ScTrack {
  const full = t.full_duration || t.duration || 0
  const short = t.duration || 0
  return {
    id: Number(t.id) || 0,
    title: (t.title || 'Unknown').trim(),
    artist: (t.user?.username || 'Unknown artist').trim(),
    duration: Math.round(short / 1000) || Math.round(full / 1000),
    thumbnail: (t.artwork_url || t.user?.avatar_url || '').replace('-large', '-t500x500'),
    permalink: t.permalink_url || '',
    snippet: (!!t.policy && SNIPPET_POLICIES.has(String(t.policy).toUpperCase())) || (full > 0 && short > 0 && short < full * 0.9),
    createdAt: t.created_at ? Date.parse(t.created_at) || 0 : 0,
    playbackCount: Number(t.playback_count) || 0,
    likesCount: Number(t.likes_count) || 0,
    repostsCount: Number(t.reposts_count) || 0,
  }
}

export function mapPlaylist(p: ScPlaylistJson): ScPlaylist {
  return {
    id: Number(p.id) || 0,
    title: (p.title || 'Untitled set').trim(),
    description: (p.description || '').slice(0, 400),
    trackCount: Number(p.track_count) || (p.tracks?.length ?? 0),
    artworkUrl: (p.artwork_url || '').replace('-large', '-t500x500'),
    permalink: p.permalink_url || '',
    createdAt: p.created_at ? Date.parse(p.created_at) || 0 : 0,
    lastModified: p.last_modified ? Date.parse(p.last_modified) || 0 : 0,
    likesCount: Number(p.likes_count) || 0,
    repostsCount: Number(p.reposts_count) || 0,
  }
}

// ---------------- resolve / lookup ----------------
export async function scResolveUrl(url: string): Promise<{ kind: 'track' | 'playlist'; track?: ScTrack; playlist?: ScPlaylist; trackJson?: ScTrackJson; playlistJson?: ScPlaylistJson } | null> {
  if (!soundcloudIsUrl(url)) return null
  const j = await scApi<any>('/resolve', { url })
  if (!j?.id) return null
  // System playlists (discover sets) come back as kind:'system-playlist'
  // with the full track-id list embedded — treat them as playlists.
  if (j.kind === 'playlist' || j.kind === 'system-playlist' || Array.isArray(j.tracks)) {
    return { kind: 'playlist', playlist: mapPlaylist(j), playlistJson: j }
  }
  return { kind: 'track', track: mapTrack(j), trackJson: j }
}

export async function scTrackJsonById(id: number | string): Promise<ScTrackJson | null> {
  const j = await scApi<ScTrackJson>(`/tracks/${id}`)
  return j?.id ? j : null
}

export async function scTrackById(id: number | string): Promise<ScTrack | null> {
  const j = await scTrackJsonById(id)
  return j ? mapTrack(j) : null
}

export interface PlaylistFetchOpts {
  /** max track-subresource pages fetched in this call (default 20 = full list) */
  maxPages?: number
  /** resume cursor from a previous call — paging continues from here */
  resumeHref?: string | null
  /** already-resolved state from cache: id order + enriched tracks.
   *  Known ids are never re-fetched in this call. */
  known?: { order: number[]; tracks: Map<number, ScTrack> }
  /** cap on per-track refetch calls in this call (default: no cap).
   *  Lets a pack page serve its first N tracks fast without resolving
   *  the whole 200-track tail. */
  enrichLimit?: number
}

export interface PlaylistFetchResult {
  playlist: ScPlaylist
  /** playable (full-length) tracks in playlist order */
  tracks: ScTrack[]
  /** raw id order discovered so far (deduped, includes unresolved tail) */
  order: number[]
  /** ids with trustworthy data (full embeds + refetched + known) */
  resolved: number[]
  /** cursor for the next page, null when upstream is exhausted */
  nextHref: string | null
  /** true when every upstream page has been walked */
  complete: boolean
}

export async function scPlaylistById(id: number | string, stats?: any, opts?: PlaylistFetchOpts): Promise<PlaylistFetchResult | null> {
  const j = await scApi<ScPlaylistJson>(`/playlists/${id}`)
  if (!j?.id) return null
  const playlist = mapPlaylist(j)

  // SoundCloud embeds only the first ~5 tracks fully; the rest come back as
  // bare {id} refs, and some tracks arrive as 30s previews (snippets). Every
  // ref/snippet candidate gets re-fetched fresh so we can drop previews and
  // keep only full-length tracks.
  const order: number[] = opts?.known ? [...opts.known.order] : []
  const byId = new Map<number, ScTrack>(opts?.known?.tracks)
  const resolved = new Set<number>(opts?.known ? [...opts.known.tracks.keys()] : [])
  const recheckIds = new Set<number>()

  const absorb = (t: ScTrackJson) => {
    if (!t?.id) return
    if (!byId.has(t.id)) order.push(t.id)
    const full = !!(t.title && t.user?.username)
    const mt = mapTrack(t)
    if (full || !byId.has(t.id)) byId.set(t.id, mt)
    if (full) resolved.add(t.id)
    // id-only ref, or a 30s snippet preview -> re-fetch fresh to decide
    // (known ids already carry trustworthy data and are skipped)
    else if (!resolved.has(t.id)) recheckIds.add(t.id)
  }

  for (const t of j.tracks || []) absorb(t)
  if (stats) stats.embedded = order.length

  // Paginate the tracks sub-resource with a REAL signed client_id (never an
  // empty ?client_id= — that 401s and silently yields a truncated playlist).
  let nextHref: string | null = opts?.resumeHref || `${API}/playlists/${id}/tracks?limit=50`
  let pages = 0
  const maxPages = opts?.maxPages ?? 20
  while (nextHref && pages < maxPages) {
    pages++
    const pageHref: string = nextHref
    try {
      const cid = await getClientId()
      if (!cid) { if (stats && !stats.pageBreak) stats.pageBreak = 'no-client-id'; break }
      const buildUrl = (c: string) => (pageHref.includes('client_id=') ? pageHref : `${pageHref}&client_id=${c}`)
      let res = await scFetch(buildUrl(cid), { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      // Same pool rotation as scApi: quarantine + promote, then give up on paging.
      if (res && res.status === 401) {
        const cid2 = await rotateClientId(cid)
        if (!cid2) { if (stats && !stats.pageBreak) stats.pageBreak = 'no-client-id-retry'; break }
        res = await scFetch(buildUrl(cid2), { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      }
      if (!res || !res.ok) { if (stats && !stats.pageBreak) stats.pageBreak = `http-${res ? res.status : 'down'}-page-${pages}`; break }
      const data: any = await res.json()
      // Shape tolerance: this sub-resource usually returns {collection, next_href},
      // but some api-v2 responses come back as a bare array (no next_href).
      // Assuming only {collection} silently truncated every big set to ~6 tracks.
      const collection: ScTrackJson[] = Array.isArray(data?.collection)
        ? data.collection
        : Array.isArray(data)
          ? data
          : []
      for (const t of collection) absorb(t)
      if (stats) { stats.pages = pages; (stats.perPage = stats.perPage || []).push(collection.length) }
      nextHref = typeof data?.next_href === 'string' && data.next_href ? data.next_href : null
      if (!nextHref || collection.length === 0) { if (stats && !stats.pageBreak) stats.pageBreak = nextHref ? 'empty-page' : 'no-next-href'; break }
    } catch { if (stats && !stats.pageBreak) stats.pageBreak = `exception-page-${pages}`; break }
  }
  if (stats && !stats.pageBreak) stats.pageBreak = pages >= maxPages ? `page-budget-${maxPages}` : 'loop-end'

  // Enrich refs/snippets against fresh track json (full_length may unlock).
  // enrichLimit caps per-track fetches so a pack page can serve its first N
  // tracks fast: the recheck set is absorb-ordered (≈ playlist order), so the
  // head of the list is always resolved first. Ids beyond the budget stay
  // unresolved and are simply not served yet (never as 'Unknown' rows).
  const recheck = [...recheckIds]
  const enrichBudget = opts?.enrichLimit ?? recheck.length
  const todo = recheck.slice(0, Math.max(0, enrichBudget))
  if (stats) { stats.recheck = recheck.length; stats.enrichBudget = enrichBudget }
  for (let i = 0; i < todo.length; i += 8) {
    const batch = todo.slice(i, i + 8)
    const results = await Promise.all(batch.map((tid) => scTrackJsonById(tid)))
    for (const fresh of results) {
      if (fresh?.id) {
        const idx = order.indexOf(fresh.id)
        if (idx >= 0) { byId.set(fresh.id, mapTrack(fresh)); resolved.add(fresh.id); if (stats) stats.refetchOk = (stats.refetchOk || 0) + 1 }
      }
    }
  }

  // Keep only resolved full-length playable tracks — never 30s preview
  // snippets and never unresolved id-refs (no 'Unknown' placeholder rows).
  const tracks = order.filter((tid) => resolved.has(tid)).map((tid) => byId.get(tid)!).filter((t) => t && !t.snippet)
  if (stats) { stats.candidates = order.length; stats.snippetDropped = order.length - tracks.length; stats.final = tracks.length }
  const complete = !nextHref
  return { playlist, tracks, order, resolved: [...resolved], nextHref, complete }
}

// ---------------- official charts ----------------
// NOTE (Oct 2026): upstream retired `kind=top` (404 on every genre/region)
// and region-scoped charts (404 even with kind=trending). Only
// `kind=trending` + all-music (or no genre) answers 200. CHART_REGIONS is
// kept so region charts auto-heal if SoundCloud restores them — until then
// those calls 404 fast and the engine falls through to country search.
// Regions with a real SoundCloud chart (verified against the charts API).
export const CHART_REGIONS = new Set(['US', 'GB', 'AU', 'CA', 'FR', 'DE', 'IE', 'NL', 'NZ'])

export interface ScChartItem {
  track: ScTrack
  score: number
}

/** Official SoundCloud chart (New & Hot), optionally per region.
 *  Response: { collection: [{ track: <full track>, score }], ... } */
export async function scCharts(
  kind: 'top' | 'trending' = 'trending',
  genreSlug = 'all-music',
  region?: string,
  limit = 40,
  offset = 0
): Promise<ScChartItem[]> {
  const params: Record<string, string | number | undefined> = {
    kind,
    genre: `soundcloud:genres:${genreSlug}`,
    limit,
    offset,
    linked_partitioning: 1,
  }
  if (region) params.region = `soundcloud:regions:${region.toLowerCase()}`
  const j = await scApi<{ collection?: { track?: ScTrackJson; score?: number }[] }>('/charts', params)
  return (j?.collection || [])
    .filter((i) => i?.track?.id)
    .map((i) => ({ track: mapTrack(i.track!), score: i.score || 0 }))
}

// ---------------- discover system sets ----------------
// soundcloud.com/discover/sets/trending-by-genre:<set> resolves via
// /resolve to kind:'system-playlist' (URN id, NOT numeric) with the exact
// track-id list embedded — in discover order. The old code fed that URN
// into /playlists/:id (numeric path) which 404d, so every discover set
// silently fell through to search. This reads the embedded ids instead.
export async function scSystemPlaylistTracks(pageUrl: string, limit = 40): Promise<ScTrack[]> {
  const r = await scResolveUrl(pageUrl).catch(() => null)
  const refs: unknown = (r as any)?.playlistJson?.tracks
  const ids = [...new Set(
    (Array.isArray(refs) ? refs : [])
      .map((t: any) => Number(t?.id))
      .filter((n: number) => n > 0)
  )].slice(0, limit)
  const out: ScTrack[] = []
  const failed: number[] = []
  for (let i = 0; i < ids.length; i += 6) {
    const batch = await Promise.all(ids.slice(i, i + 6).map((id) => scTrackJsonById(id).catch(() => null)))
    batch.forEach((j, k) => {
      if (!j?.id) { failed.push(ids[i + k]); return }
      const t = mapTrack(j)
      if (!t.snippet) out.push(t)
    })
  }
  // One retry for transient misses — without this a single throttled batch
  // silently shrinks a 30-track set down to a handful.
  if (failed.length && out.length < limit) {
    await new Promise((r) => setTimeout(r, 500))
    for (let i = 0; i < failed.length; i += 6) {
      const batch = await Promise.all(failed.slice(i, i + 6).map((id) => scTrackJsonById(id).catch(() => null)))
      for (const j of batch) {
        if (!j?.id || out.length >= limit) continue
        const t = mapTrack(j)
        if (!t.snippet && !out.some((x) => x.id === t.id)) out.push(t)
      }
    }
  }
  return out
}

// ---------------- search ----------------
export async function scSearchTracks(query: string, limit = 30, offset = 0): Promise<ScTrack[]> {
  const j = await scApi<{ collection?: ScTrackJson[] }>('/search/tracks', { q: query, limit, offset })
  return (j?.collection || []).filter((t) => t?.id).map(mapTrack)
}

export async function scSearchPlaylists(query: string, limit = 16): Promise<ScPlaylist[]> {
  const j = await scApi<{ collection?: ScPlaylistJson[] }>('/search/playlists', { q: query, limit })
  return (j?.collection || []).filter((p) => p?.id).map(mapPlaylist)
}

// ---------------- playback ----------------
export interface ScStreams {
  /** direct full-length 128k mp3 (signed CDN url, valid ~2h) */
  progressive: string | null
  /** HLS m3u8 (aac 160k or mp3 128k, signed CDN url, valid ~2h) */
  hls: string | null
}

async function mediaUrl(transcodingUrl: string, retried = false): Promise<string | null> {
  const cid = await getClientId()
  if (!cid) return null
  try {
    const res = await scFetch(`${transcodingUrl}?client_id=${cid}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    // Signed-url mint with a retired id → rotate the pool and retry once so
    // playback doesn't die on a single bad id.
    if (!res) return null
    if (res.status === 401 && !retried) {
      const next = await rotateClientId(cid)
      if (!next) return null
      return mediaUrl(transcodingUrl, true)
    }
    if (!res.ok) return null
    const j = await res.json()
    return j?.url || null
  } catch {
    return null
  }
}

export async function scStreamsFromJson(trackJson: ScTrackJson): Promise<ScStreams> {
  const out: ScStreams = { progressive: null, hls: null }
  const list = trackJson?.media?.transcodings || []
  // 1) progressive mp3 (native <audio>, fastest + seekable)
  const prog = list.find((t) => t.format?.protocol === 'progressive' && (t.format?.mime_type || '').includes('mpeg'))
  // 2) HLS: aac 160k first (highest quality), then mp3 128k
  const hlsAac = list.find((t) => t.format?.protocol === 'hls' && (t.format?.mime_type || '').includes('mp4a'))
  const hlsMp3 = list.find((t) => t.format?.protocol === 'hls' && (t.format?.mime_type || '').includes('mpeg'))
  // mint all signed URLs in parallel (minimizes first-play latency)
  const [progUrl, aacUrl, mp3Url] = await Promise.all([
    prog?.url ? mediaUrl(prog.url) : Promise.resolve(null),
    hlsAac?.url ? mediaUrl(hlsAac.url) : Promise.resolve(null),
    hlsMp3?.url ? mediaUrl(hlsMp3.url) : Promise.resolve(null),
  ])
  if (progUrl) out.progressive = progUrl
  out.hls = aacUrl || mp3Url
  return out
}

// Signed CDN URLs stay valid ~1h. Cache mints for 10 minutes so repeated
// plays and seeks are instant and never serve an expired signature.
const STREAM_TTL = 10 * 60 * 1000
// streamCache was unbounded (evict-on-read only). Cap with oldest-first
// eviction; hot track IDs just overwrite. Tune with MEM_CACHE_CAP.
const STREAM_CACHE_CAP = Math.max(50, parseInt(process.env.MEM_CACHE_CAP || '300', 10))
const streamCache = new Map<string, { exp: number; val: ScStreams }>()
// in-flight dedup: concurrent resolve/play/prefetch share ONE mint
const inflight = new Map<string, Promise<ScStreams>>()

export async function scStreamsById(id: number | string): Promise<ScStreams> {
  const key = String(id)
  const hit = streamCache.get(key)
  if (hit && hit.exp > Date.now()) return hit.val
  const existing = inflight.get(key)
  if (existing) return existing
  const job = (async (): Promise<ScStreams> => {
    const j = await scTrackJsonById(key)
    if (!j) return lastKnownStreams(key)
    let streams = await scStreamsFromJson(j)
    // transient network failure -> one retry (empty result only)
    if (!streams.progressive && !streams.hls) {
      await new Promise((r) => setTimeout(r, 400))
      streams = await scStreamsFromJson(j)
    }
    if (streams.progressive || streams.hls) {
      if (!streamCache.has(key) && streamCache.size >= STREAM_CACHE_CAP) {
        const first = streamCache.keys().next()
        if (!first.done) streamCache.delete(first.value)
      }
      streamCache.set(key, { exp: Date.now() + STREAM_TTL, val: streams })
      // persist as last-good fallback (signed urls stay valid ~1h)
      cacheSet(`sc:signed:${key}`, streams, 3600).catch(() => {})
      return streams
    }
    return lastKnownStreams(key)
  })()
  inflight.set(key, job)
  try {
    return await job
  } finally {
    inflight.delete(key)
  }
}

export function invalidateScStreams(id: number | string) {
  streamCache.delete(String(id))
}

/** When api-v2 is unreachable, fall back to the last known good signed urls. */
async function lastKnownStreams(key: string): Promise<ScStreams> {
  try {
    const { cacheGet } = await import('./db')
    const row = await cacheGet(`sc:signed:${key}`)
    const val = row?.value
    if (val && (val.progressive || val.hls)) return val as ScStreams
  } catch { /* db optional */ }
  return { progressive: null, hls: null }
}

// ---------------- compat helpers ----------------
export function soundcloudIsUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(soundcloud\.com|snd\.sc)\//.test(url)
}

/** 'sc_123' | '123' | url-encoded variants -> numeric track id, else null */
export function extractScId(raw: string): string | null {
  const s = decodeURIComponent(String(raw)).trim()
  if (/^sc_(\d+)$/.test(s)) return s.slice(3)
  if (/^\d{6,}$/.test(s)) return s
  return null
}


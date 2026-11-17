// Music Atlas music engine — SoundCloud-first, full-length playback, ZERO API keys.
// Search / trending / resolve all run on SoundCloud api-v2 (client_id only).
// Legacy ids (yt/sp/dz) from old playlists are remapped via SoundCloud search.
import { cacheGet, cacheSet, cacheGetStale, cacheSetStale } from './db'
import { COUNTRIES, nativeCountryName } from '../src/data/countries'
import {
  scSearchTracks,
  scCharts,
  CHART_REGIONS,
  scTrackJsonById,
  scStreamsFromJson,
  scStreamsById,
  scResolveUrl,
  soundcloudIsUrl,
  extractScId,
  clientIdStatus,
  type ScTrack,
  type ScTrackJson,
} from './soundcloud'
import { netopenStatus } from './scRelay'

export interface StreamCandidate {
  url: string
  mime: string
  bitrate: number
  label: string
}

export interface ResolveResult {
  videoId: string
  title: string
  artist: string
  duration: number
  thumbnail?: string
  permalink?: string
  streams: StreamCandidate[]
  instance: string
}

export interface Track {
  videoId: string
  title: string
  artist: string
  thumbnail: string
  duration: number
  permalink?: string
  createdAt?: number
  playbackCount?: number
  likesCount?: number
}

const HLS_PROXY = '/music-atlas/api/sc/stream/'

function scTrackToTrack(t: ScTrack): Track {
  return {
    videoId: `sc_${t.id}`,
    title: t.title,
    artist: t.artist,
    thumbnail: t.thumbnail,
    duration: t.duration,
    permalink: t.permalink,
    createdAt: t.createdAt || 0,
    playbackCount: t.playbackCount || 0,
    likesCount: t.likesCount || 0,
  }
}

/** Rank fresh-first: recent releases with real engagement float up. */
function rankFreshTracks(list: ScTrack[], now = Date.now()): ScTrack[] {
  const seen = new Set<number>()
  return list
    .filter((t) => {
      if (!t?.id || t.snippet || seen.has(t.id)) return false
      seen.add(t.id)
      return true
    })
    .map((t) => {
      const ageDays = t.createdAt > 0 ? Math.max(0, (now - t.createdAt) / 86400000) : 365
      const engagement = Math.log10(1 + (t.playbackCount || 0)) * 2 + Math.log10(1 + (t.likesCount || 0)) * 3 + Math.log10(1 + (t.repostsCount || 0))
      const fresh = Math.max(0, 1 - ageDays / 365)
      const score = engagement * (0.5 + fresh) + (ageDays < 60 ? 2 : 0)
      return { t, score }
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t)
}

/** Fire-and-forget stream pre-warm so the first play starts instantly
 *  (mints + caches signed CDN urls for the top results while the user browses). */
export function prefetchStreams(tracks: Track[], n = 8) {
  for (const t of tracks.slice(0, n)) {
    const m = /^sc_(\d+)$/.exec(t.videoId || '')
    if (m) scStreamsById(m[1]).catch(() => {})
  }
}

// ---------------- cache helpers ----------------
const mem = new Map<string, { exp: number; val: any }>()
function memGet(key: string) {
  const e = mem.get(key)
  if (e && e.exp > Date.now()) return e.val
  if (e) mem.delete(key)
  return null
}
// mem is keyed by raw user queries (sc:search:*) and was unbounded (expiry
// only on read). Cap entries with oldest-first eviction. Tune with MEM_CACHE_CAP.
const MEM_CAP = Math.max(50, parseInt(process.env.MEM_CACHE_CAP || '300', 10))
function memSet(key: string, val: any, ttlSec: number) {
  if (!mem.has(key) && mem.size >= MEM_CAP) {
    const first = mem.keys().next()
    if (!first.done) mem.delete(first.value)
  }
  mem.set(key, { exp: Date.now() + ttlSec * 1000, val })
}
async function dbGet(key: string): Promise<any> {
  const m = memGet(key)
  if (m !== null && m !== undefined) return m
  try {
    const row = await cacheGet(key)
    if (row && (!row.expiresAt || row.expiresAt > Date.now())) return row.value
  } catch { /* db optional */ }
  return null
}
async function dbSet(key: string, val: any, ttlSec: number) {
  memSet(key, val, Math.min(ttlSec, 300))
  try { await cacheSet(key, val, ttlSec) } catch { /* db optional */ }
}

// ---------------- search ----------------
export async function searchMusic(qRaw: string): Promise<{ tracks: Track[]; source: string }> {
  const q = qRaw.trim()
  if (!q) return { tracks: [], source: 'none' }

  // SoundCloud link pasted into search → resolve it directly
  if (soundcloudIsUrl(q)) {
    const key = `sc:urlmeta:${q.slice(0, 200)}`
    const cached = await dbGet(key)
    if (cached) return cached
    const r = await scResolveUrl(q)
    if (r?.kind === 'track' && r.track) {
      const out = { tracks: [scTrackToTrack(r.track)], source: 'soundcloud-url' }
      await dbSet(key, out, 3600)
      return out
    }
    if (r?.kind === 'playlist') {
      const out = { tracks: [], source: 'soundcloud-playlist' }
      await dbSet(key, out, 1800)
      return out
    }
    return { tracks: [], source: 'none' }
  }

  const key = `sc:search:${q.toLowerCase().slice(0, 120)}`
  const cached = await dbGet(key)
  if (cached) return cached

  const sc = await scSearchTracks(q, 30)
  if (sc.length) {
    const tracks = sc.map(scTrackToTrack)
    prefetchStreams(tracks)
    const out = { tracks, source: 'soundcloud' }
    await dbSet(key, out, 3600)
    return out
  }
  return { tracks: [], source: 'none' }
}

// ---------------- trending (per country) ----------------
// Year is dynamic so "top hits" queries never go stale in January.
const CURRENT_YEAR = new Date().getFullYear()
const COUNTRY_QUERIES: Record<string, string> = {
  US: `top hits ${CURRENT_YEAR}`, GB: 'uk top hits', CA: 'canada hits', AU: 'australia hits',
  DE: 'deutsche hits', FR: 'french hits', NL: 'dutch hits', ES: 'reggaeton hits',
  IT: 'italo dance hits', TR: 'turkish pop', RU: 'russian pop hits', PL: 'polish hits',
  SE: 'swedish hits', BR: 'brazilian funk', MX: 'latin hits', AR: 'cumbia hits',
  KR: 'k-pop', JP: 'j-pop hits', IN: 'bollywood hits', ID: 'indonesian hits',
  PH: 'opm hits', NG: 'afrobeats', ZA: 'amapiano', EG: 'arabic hits',
  SA: 'arabic hits', AE: 'arabic hits', IR: 'persian music', PK: 'pakistani hits',
  VN: 'vietnamese hits', TH: 'thai hits', GR: 'greek hits', PT: 'portuguese hits',
  UA: 'ukrainian hits', IL: 'israeli hits', CO: 'reggaeton', CL: 'latin hits',
  // Countries missing above used to share one generic query (identical lists
  // for ~200 flags). Cover the rest explicitly; anything still missing falls
  // back to a name-based query built from the COUNTRIES dataset below.
  AF: 'afghan music dari pashto', IQ: 'iraqi music', SY: 'syrian dabke music',
  LB: 'lebanese hits', JO: 'jordanian dabke', YE: 'yemeni oud music', OM: 'omani music',
  QA: 'khaliji hits', KW: 'khaliji hits', BH: 'khaliji hits',
  KZ: 'kazakh hits', UZ: 'uzbek hits', AZ: 'azerbaijan mugham pop', AM: 'armenian hits',
  GE: 'georgian hits', TJ: 'tajik hits', TM: 'turkmen hits', KG: 'kyrgyz hits',
  MY: 'malaysian hits', SG: 'singapore hits', BD: 'bangla gaan', LK: 'sri lankan hits',
  NP: 'nepali hits', MM: 'myanmar hits', KH: 'khmer hits', LA: 'lao mor lam',
  MN: 'mongolian hits', TW: 'mandopop hits', HK: 'cantopop hits', CN: 'mandopop hits',
  KP: 'korean folk', PE: 'peruvian cumbia', VE: 'venezuelan hits', EC: 'ecuadorian pasillo',
  BO: 'bolivian morenada', PY: 'paraguayan guarania', UY: 'uruguayan candombe',
  CU: 'cuban timba', DO: 'dominican dembow', PR: 'reggaeton puerto rico', JM: 'dancehall jamaica',
  CR: 'costa rica hits', PA: 'panamanian plena', GT: 'guatemalan marimba', HN: 'honduran punta',
  SV: 'salvadoran cumbia', NI: 'nicaraguan palo de mayo', HT: 'haitian konpa', TT: 'soca trinidad',
  DZ: 'algerian rai', MA: 'moroccan chaabi', TN: 'tunisian mezoued', LY: 'libyan hits',
  SD: 'sudanese hits', ET: 'ethiopian hits', KE: 'kenyan gengetone', TZ: 'bongo flava',
  UG: 'ugandan hits', RW: 'rwandan hits', GH: 'ghanaian hiplife', SN: 'senegalese mbalax',
  ML: 'malian desert blues', CI: 'ivorian coupé-décalé', CM: 'cameroonian makossa',
  CD: 'congolese rumba', CG: 'congolese rumba', ZM: 'zambian kalindula', ZW: 'zimbabwean sungura',
  BW: 'botswana hits', NA: 'namibian hits', MZ: 'mozambican marrabenta', MG: 'malagasy hits',
  MU: 'mauritian sega', SC: 'seychelles sega', CV: 'cape verdean morna',
  NO: 'norwegian hits', DK: 'danish hits', FI: 'finnish hits', IS: 'icelandic hits',
  IE: 'irish hits', BE: 'belgian hits', CH: 'swiss hits', AT: 'austrian hits',
  CZ: 'czech hits', SK: 'slovak hits', HU: 'hungarian mulatos', RO: 'romanian manele',
  BG: 'bulgarian chalga', RS: 'serbian turbofolk', HR: 'croatian hits', BA: 'bosnian sevdah',
  AL: 'albanian tallava', MK: 'macedonian oro', ME: 'montenegrin hits', SI: 'slovenian hits',
  EE: 'estonian hits', LV: 'latvian hits', LT: 'lithuanian hits', BY: 'belarusian hits',
  MD: 'moldovan hits', CY: 'cypriot hits', MT: 'maltese hits', LU: 'luxembourg hits',
  NZ: 'new zealand hits', FJ: 'fijian hits', PG: 'papua new guinea hits', WS: 'samoan hits',
  TO: 'tongan hits', VU: 'vanuatu hits', SB: 'solomon hits', PF: 'tahitian hits',
  NC: 'new caledonian kaneka', GU: 'chamorro hits',
}

/** Year-aware, country-specific search queries: the English music query AND
 *  the country's own name in its own language (e.g. "persian music" +
 *  "ایران 2026"). SoundCloud titles/tags are very often in the local script,
 *  so the native query discovers tracks the English ones never match.
 *  Countries without an explicit entry get English + native name-based
 *  queries from the dataset so no two flags ever share one generic query.
 *  NOTE: the generic `top hits YEAR` query is deliberately NOT here — it is
 *  only a last-resort fill layer (appended after, never ranked above) so its
 *  spam mixes can't drown the country's own music. */
function countryQueries(cc: string): string[] {
  const direct = COUNTRY_QUERIES[cc]
  const name = COUNTRIES.find((c) => c.code === cc)?.name || ''
  const native = nativeCountryName(cc)
  const out = direct
    ? [direct, `${direct} ${CURRENT_YEAR}`]
    : [name ? `${name.toLowerCase()} hits` : '', name ? `${name.toLowerCase()} music ${CURRENT_YEAR}` : '']
  // Full English country name (e.g. "tajikistan"): the short direct query
  // (e.g. "tajik hits") is exactly the phrase spam mixes use in their titles,
  // while the full name is what genuinely local tracks mention — and what a
  // manual search types. Without this the flag page can fill with unrelated
  // mixes even though searching the country name works fine.
  if (direct && name) out.push(name.toLowerCase())
  if (native && native.toLowerCase() !== name.toLowerCase()) {
    out.splice(direct ? 2 : 1, 0, `${native} ${CURRENT_YEAR}`)
  }
  return [...new Set(out.map((q) => q.trim()).filter(Boolean))].slice(0, 4)
}

/** Generic words that carry no country signal (query leftovers, years). */
const QUERY_STOPWORDS = new Set(['top', 'hits', 'hit', 'music', 'songs', 'song', 'best', 'new', 'latest', 'playlist', 'mix', 'charts', 'chart', 'hits'])

function queryTokens(queries: string[]): string[] {
  const toks = new Set<string>()
  for (const q of queries) {
    // Unicode-aware split: native-script tokens (ایران, 日本, …) must survive
    // so the relevance partition can boost tracks mentioning them.
    for (const w of q.toLowerCase().split(/[^\p{L}\p{N}+-]+/u)) {
      if (!w || QUERY_STOPWORDS.has(w) || /^\d+$/.test(w) || w.length < 2) continue
      toks.add(w)
    }
  }
  return [...toks]
}

/** Stable relevance partition: tracks whose title/artist actually mentions a
 *  country-query term keep their relative order up front; generic spam
 *  ("Top Hits Spotify Indonesia" under JP) sinks below. No tokens (e.g. the
 *  US generic query) = no-op, engagement order preserved.
 *  Matching is word-prefix, NOT substring: the old `includes` counted
 *  "Majik"/"Tajir77"/"Tarik" as a mention of "tajik" and floated unrelated
 *  spam above the country's own music. A query term must prefix-match a
 *  whole title word ("tajik" matches "tajiki"/"tajikistan", never "majik"). */
function relevancePartition(list: ScTrack[], tokens: string[]): ScTrack[] {
  if (!tokens.length) return list
  const hit: ScTrack[] = []
  const rest: ScTrack[] = []
  for (const t of list) {
    const words = `${t.title || ''} ${t.artist || ''}`.toLowerCase().split(/[^\p{L}\p{N}+-]+/u).filter(Boolean)
    if (tokens.some((tok) => words.some((w) => w.startsWith(tok)))) hit.push(t)
    else rest.push(t)
  }
  return [...hit, ...rest]
}

/** Merge track lists, de-duplicated by id, snippets dropped, capped at `cap`. */
function mergeTracks(into: ScTrack[], seen: Set<number>, lists: ScTrack[][], cap: number): ScTrack[] {
  for (const list of lists) {
    for (const t of list) {
      if (!t?.id || t.snippet || seen.has(t.id)) continue
      seen.add(t.id)
      into.push(t)
      if (into.length >= cap) return into
    }
  }
  return into
}

const TRENDING_TARGET = 40
// Below this many country-specific tracks the list leans on global fill and
// the client is told (fallback:true) so it can show the "global hits" banner.
const TRENDING_MIN_COUNTRY = 12

export async function getTrending(country: string, bypassCache = false, stats?: any): Promise<{ tracks: Track[]; fallback: boolean; source: string }> {
  const cc = (country || 'US').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'US'
  // v5: full English name query added + word-prefix relevance (substring
  // matching floated "Majik"/"Tajir"-style spam above real local tracks).
  const key = `sc:trending:v5:${cc}`
  if (!bypassCache) {
    const cached = await dbGet(key)
    if (cached) { if (stats) { stats.servedFrom = 'cache'; stats.final = cached.tracks?.length || 0 } return cached }
  }

  // Layered top-up (deduped, capped at TARGET) — replaces the old
  // first-non-empty-wins chain where the global chart short-circuited every
  // country search and all flags returned the identical global Top 40:
  //  - chart regions: official region chart first, country search fills up
  //  - elsewhere: country-specific search first, global chart fills up
  // A thin country layer (or a pure global/generic list) sets fallback:true.
  const seen = new Set<number>()
  const merged: ScTrack[] = []
  const sources: string[] = []
  const queries = countryQueries(cc)

  const add = (list: ScTrack[], tag: string) => {
    const before = merged.length
    mergeTracks(merged, seen, [list], TRENDING_TARGET)
    if (merged.length > before) sources.push(tag)
  }

  if (CHART_REGIONS.has(cc)) {
    try {
      const items = await scCharts('trending', 'all-music', cc, TRENDING_TARGET)
      if (stats) stats.chartItems = items.length
      const fresh = items.map((i) => i.track).filter((t) => !t.snippet)
      if (fresh.length) add(fresh, 'soundcloud-chart')
    } catch { /* fall through to search */ }
  }

  if (merged.length < TRENDING_TARGET) {
    const settled = await Promise.all(queries.map((q) => scSearchTracks(q, 30).catch(() => [] as ScTrack[])))
    if (stats) stats.perQuery = settled.map((a) => a.length)
    // Engagement ranking floats farm-played spam ("Top Hits Indonesia" under
    // JP) above the country's own tracks — partition by query-term relevance
    // first so the country's music leads.
    const ranked = relevancePartition(rankFreshTracks(settled.flat()), queryTokens(queries)).slice(0, TRENDING_TARGET)
    if (stats) stats.afterRank = ranked.length
    if (ranked.length) add(ranked, 'soundcloud-search-fresh')
  }

  // Everything above this line is country-specific (region chart and/or
  // country queries). What the global/generic layers add afterwards is fill.
  const countryCount = merged.length

  // Global chart as fill (never the sole primary for a missing region).
  if (merged.length < TRENDING_TARGET) {
    try {
      const items = await scCharts('trending', 'all-music', undefined, TRENDING_TARGET)
      if (stats) stats.globalItems = items.length
      const fresh = items.map((i) => i.track).filter((t) => !t.snippet && !seen.has(t.id))
      if (fresh.length) add(fresh, 'soundcloud-chart-global')
    } catch { /* keep what we have */ }
  }

  // Last resort: generic search top-up so the rail is rarely empty.
  if (merged.length < TRENDING_MIN_COUNTRY) {
    const extra = await scSearchTracks(`top hits ${CURRENT_YEAR}`, TRENDING_TARGET).catch(() => [] as ScTrack[])
    if (stats) stats.genericItems = extra.length
    const ranked = rankFreshTracks(extra).filter((t) => !seen.has(t.id)).slice(0, TRENDING_TARGET - merged.length)
    if (ranked.length) add(ranked, 'soundcloud-search-generic')
  }
  if (stats) { stats.servedFrom = 'live'; stats.countryCount = countryCount; stats.final = merged.slice(0, TRENDING_TARGET).length }

  const sc = merged.slice(0, TRENDING_TARGET)
  const source = sources.join('+') || 'none'
  // Thin country layer = the list leans on global/generic fill -> the client
  // shows its "showing global hits" banner. A full country layer means the
  // music is the country's own, even when the official chart is dead.
  const fallback = countryCount < TRENDING_MIN_COUNTRY
  console.log(`[trending] ${cc} -> ${source} (${sc.length} tracks, country:${countryCount}${fallback ? ', fallback' : ''})`)
  const out = { tracks: sc.map(scTrackToTrack), fallback, source, updatedAt: Date.now() }
  if (sc.length) {
    prefetchStreams(out.tracks)
    // 1-hour TTL: matches the hourly server warmer, so every chart
    // (home page included) is at most one hour old.
    await dbSet(key, out, 3600)
    // Long-lived stale copy: served when every live source fails.
    await cacheSetStale(key, out)
  } else {
    const stale = await cacheGetStale(key)
    if (stale?.tracks?.length) {
      console.log(`[trending] ${cc} -> stale fallback (${stale.tracks.length} tracks)`)
      if (stats) { stats.servedFrom = 'stale'; stats.final = stale.tracks.length }
      return { ...stale, stale: true }
    }
  }
  return out
}

const MORE_PAGE = 20

/** Next page of a country chart for the "More" button.
 *  Country search first (offset into the ranked pool, same queries as the
 *  main list so More continues the country's own music), official charts
 *  with offset for chart regions, global chart only as a last resort —
 *  never the primary, so More can no longer return the same global page
 *  for every flag. */
export async function getTrendingMore(country: string, offset: number): Promise<{ tracks: Track[]; hasMore: boolean; source: string }> {
  const cc = (country || 'US').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'US'
  const off = Math.max(0, Math.floor(offset) || 0)
  const key = `sc:trendingmore:v5:${cc}:${off}`
  const cached = await dbGet(key)
  if (cached) return cached

  let sc: ScTrack[] = []
  let source = 'none'
  // Chart regions keep chart order for paging (Top 50 caps at ~50).
  if (CHART_REGIONS.has(cc)) {
    try {
      const items = await scCharts('trending', 'all-music', cc, MORE_PAGE, off)
      sc = items.map((i) => i.track).filter((t) => !t.snippet)
      if (sc.length) source = 'soundcloud-chart'
    } catch { sc = [] }
  }
  // Country-specific search pool, sliced at the requested offset.
  if (!sc.length) {
    const queries = countryQueries(cc)
    const settled = await Promise.all(queries.map((q) => scSearchTracks(q, MORE_PAGE + off + 10, 0).catch(() => [] as ScTrack[])))
    sc = relevancePartition(rankFreshTracks(settled.flat()), queryTokens(queries)).slice(off, off + MORE_PAGE)
    if (sc.length) source = 'soundcloud-search-fresh'
  }
  if (!sc.length) {
    try {
      const items = await scCharts('trending', 'all-music', undefined, MORE_PAGE, off)
      sc = items.map((i) => i.track).filter((t) => !t.snippet)
      if (sc.length) source = 'soundcloud-chart-global'
    } catch { sc = [] }
  }
  const out = { tracks: sc.map(scTrackToTrack), hasMore: sc.length >= MORE_PAGE, source, updatedAt: Date.now() }
  if (sc.length) {
    prefetchStreams(out.tracks)
    await dbSet(key, out, 3600)
  }
  return out
}

// ---------------- trending playlists (fresh discovery) ----------------
// Fresh playlist discovery per country: year-aware multi-query fan-out over
// SoundCloud playlist search, scored by recency + engagement + size so the
// rail is actually "به‌روز", not whatever search returns first.
export interface TrendingPlaylist {
  id: string
  name: string
  category: string
  description: string
  tracksCount: number
  artwork: string | null
  permalink: string
  updatedAt: number
}

export async function getTrendingPlaylists(country: string, bypassCache = false): Promise<{ playlists: TrendingPlaylist[]; source: string; updatedAt: number }> {
  const { scSearchPlaylists } = await import('./soundcloud')
  const cc = (country || 'US').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'US'
  // v2: full-English-name + native playlist queries added.
  const key = `sc:trendpl:v2:${cc}`
  if (!bypassCache) {
    const cached = await dbGet(key)
    if (cached?.playlists?.length) return cached
  }
  const base = COUNTRY_QUERIES[cc] || countryQueries(cc)[0] || 'top hits'
  const queries = [`${base} ${CURRENT_YEAR}`, `${base} playlist`, `top hits ${CURRENT_YEAR} playlist`, `${base}`].filter((v, i, a) => a.indexOf(v) === i)
  // Native-language playlist query (e.g. "ایران playlist"): local-script
  // sets are invisible to the English queries.
  const native = nativeCountryName(cc)
  if (native && !queries.some((q) => q.includes(native))) {
    queries.splice(2, 0, `${native} playlist`)
  }
  // Full English country name (e.g. "tajikistan playlist"): the short base
  // query (e.g. "tajik hits") is exactly what spam sets use in their titles,
  // while genuinely local sets mention the full name — same rule as the
  // track chart above, applied to every flag's playlist rail.
  const fullName = COUNTRIES.find((c) => c.code === cc)?.name.toLowerCase() || ''
  if (fullName && !queries.some((q) => q.includes(fullName))) {
    queries.splice(3, 0, `${fullName} playlist`)
  }
  // Batched fan-out (3 at a time): 6+ concurrent playlist searches plus the
  // warmer's own fan-out plus enrich batches push SoundCloud into 429s and
  // the WHOLE set comes back empty — observed live (single query: 18 Tajik
  // sets; 6-way fan-out at the same second: 0). Two halves cost ~1s extra
  // and survive contention. Same for the single retry below.
  const fanOut = async (): Promise<Awaited<ReturnType<typeof scSearchPlaylists>>[]> => {
    const out: Awaited<ReturnType<typeof scSearchPlaylists>>[] = []
    for (let i = 0; i < queries.length; i += 3) {
      const batch = await Promise.all(queries.slice(i, i + 3).map((q) => scSearchPlaylists(q, 12).catch(() => [])))
      out.push(...batch)
    }
    return out
  }
  // On a TOTAL miss (transient upstream throttle under load — partial misses
  // are fine) wait and retry once before falling back to stale, so a passing
  // throttle doesn't pin an old row on the flag page.
  let settled = await fanOut()
  if (!settled.some((a) => a.length)) {
    await new Promise((r) => setTimeout(r, 2500))
    settled = await fanOut()
  }
  const seen = new Set<string>()
  const now = Date.now()
  const scored = []
  for (const arr of settled) {
    for (const pl of arr) {
      const id = String(pl.id)
      if (!id || seen.has(id)) continue
      seen.add(id)
      const ageDays = pl.createdAt > 0 ? Math.max(0, (now - pl.createdAt) / 86400000) : 365
      const modDays = pl.lastModified > 0 ? Math.max(0, (now - pl.lastModified) / 86400000) : ageDays
      const engagement = Math.log10(1 + (pl.likesCount || 0)) * 3 + Math.log10(1 + (pl.repostsCount || 0)) * 2
      const sizeScore = Math.min(3, Math.log10(1 + (pl.trackCount || 0)))
      const fresh = Math.max(0, 1 - Math.min(ageDays, modDays) / 365)
      const score = engagement + sizeScore + fresh * 5 + (modDays < 90 ? 2 : 0)
      scored.push({ pl, score })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  // Relevance first (same rule as the track chart): sets whose title or
  // description actually mentions a country-query term (word-prefix match —
  // "tajik" matches "tajikistan", never "majik") lead the rail, generic
  // mega-sets only fill the remainder. When the relevant shelf is thin
  // (SoundCloud simply has no local sets for small countries — e.g.
  // "tajikistan playlist" returns 2 untitled shells), the rail still serves
  // 12 but is flagged fallback:true so the client labels it honestly
  // ("no local sets — showing global picks") instead of dressing global
  // sets up as "Fresh sets for Tajikistan". Serving hit-only here would
  // collapse to an empty list and fall through to the stale cache, which
  // serves the old generic row anyway. No tokens (generic base query) =
  // old behavior, global rail, fallback:false.
  const plTokens = queryTokens([...queries, fullName, native || ''])
  let ranked = scored
  let fallback = false
  if (plTokens.length) {
    const hit: typeof scored = []
    const rest: typeof scored = []
    for (const s of scored) {
      const words = `${s.pl.title || ''} ${s.pl.description || ''}`.toLowerCase().split(/[^\p{L}\p{N}+-]+/u).filter(Boolean)
      if (plTokens.some((tok) => words.some((w) => w.startsWith(tok)))) hit.push(s)
      else rest.push(s)
    }
    ranked = [...hit, ...rest]
    // Below this many relevant sets the rail leans on generic fill and the
    // client is told (fallback:true), mirroring the track chart's banner.
    const MIN_RELEVANT_PLAYLISTS = 4
    fallback = hit.length < MIN_RELEVANT_PLAYLISTS
  }
  const playlists: TrendingPlaylist[] = ranked.slice(0, 12).map(({ pl }) => ({
    id: String(pl.id),
    name: pl.title,
    category: base,
    description: pl.description || `${base} picks ${CURRENT_YEAR}`,
    tracksCount: pl.trackCount,
    artwork: pl.artworkUrl || null,
    permalink: pl.permalink,
    updatedAt: pl.lastModified || pl.createdAt || now,
  }))
  const out = { playlists, fallback, source: 'soundcloud-playlist-search-fresh', updatedAt: now }
  if (playlists.length) {
    await dbSet(key, out, 3600)
    await cacheSetStale(key, out)
  } else {
    const stale = await cacheGetStale(key)
    if (stale?.playlists?.length) return { ...stale, stale: true }
  }
  return out
}

// ---------------- resolve (the playback core) ----------------
async function resolveSc(scId: string, origId: string, viaRemap = false, bypassCache = false): Promise<ResolveResult | null> {
  // v3 cache key: candidates are STABLE proxy endpoints (no signed URLs cached);
  // v2->v3 bump also invalidates entries that advertised phantom HLS candidates.
  const key = `sc:resolve:v3:${scId}`
  if (!bypassCache) {
    const cached = await dbGet(key)
    if (cached) return { ...cached, videoId: cached.videoId || origId }
  }

  const j: ScTrackJson | null = await scTrackJsonById(scId)
  if (!j?.id) return null
  const streams = await scStreamsFromJson(j)
  const t = {
    title: (j.title || 'Unknown').trim(),
    artist: (j.user?.username || 'Unknown artist').trim(),
    duration: Math.round((j.duration || 0) / 1000),
    thumbnail: (j.artwork_url || j.user?.avatar_url || '').replace('-large', '-t500x500'),
    permalink: j.permalink_url || '',
  }
  const list: StreamCandidate[] = []
  if (streams.progressive) {
    // stable endpoint -> always mints a FRESH signed CDN url (never 403/expired)
    list.push({ url: `/music-atlas/api/sc/stream/${scId}/audio.mp3`, mime: 'audio/mpeg', bitrate: 128000, label: 'soundcloud-progressive' })
  }
  // Only advertise the HLS proxy when a signed m3u8 actually minted —
  // snippet/region-locked tracks expose no transcodings and the proxy
  // would answer 404 no_hls, wasting the player's first candidate slot.
  if (streams.hls) {
    list.push({ url: `${HLS_PROXY}${scId}/playlist.m3u8`, mime: 'application/vnd.apple.mpegurl', bitrate: 160000, label: 'soundcloud-hls' })
  }

  // No mintable stream at all (removed, go+ only or region-locked) —
  // report unplayable so the client skips to its next candidate/track.
  if (!list.length) return null

  const out: ResolveResult = {
    videoId: origId.startsWith('sc_') ? origId : `sc_${scId}`,
    ...t,
    streams: list,
    instance: viaRemap ? 'soundcloud-remap' : 'soundcloud',
  }
  await dbSet(key, out, 1800)
  return out
}

/**
 * Resolve any historical id to playable streams.
 * - `sc_<id>` / `<numeric id>` → SoundCloud track
 * - anything else (legacy yt / sp_ / dz_ ids) → remap by searching
 *   SoundCloud with `q` (title + artist) and play the top result.
 */
export async function resolveStreams(videoId: string, q = '', fresh = false): Promise<ResolveResult | null> {
  const scId = extractScId(videoId)
  if (scId) return resolveSc(scId, videoId.startsWith('sc_') ? videoId : `sc_${scId}`, false, fresh)

  const query = (q || '').trim() || ''
  if (!query) return null
  const key = `sc:remap:${query.toLowerCase().slice(0, 120)}`
  if (!fresh) {
    const cached = await dbGet(key)
    if (cached) return cached
  }

  const hits = await scSearchTracks(query, 5)
  const top = hits[0]
  if (!top) return null
  const out = await resolveSc(String(top.id), `sc_${top.id}`, true)
  if (out) await dbSet(key, out, 1800)
  return out
}

// ---------------- ops / status ----------------
export function instanceStatus() {
  return {
    soundcloud: { engine: 'api-v2', ...clientIdStatus(), netopen: netopenStatus() },
  }
}



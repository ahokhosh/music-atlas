// Music Atlas — SoundCloud-first end-to-end test suite
const BASE = 'http://localhost:3000'
const PBASE = `${BASE}/playlist/api`
let pass = 0, fail = 0
const failures = []

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ''}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`) }
}

async function j(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(60000) })
  let body = null
  try { body = await res.json() } catch { /* not json */ }
  return { status: res.status, body, res }
}

console.log('\n━━━ 1. Health ━━━')
{
  const r = await j(`${BASE}/api/health`)
  check('health ok', r.status === 200 && r.body?.ok === true, `db=${r.body?.db}`)
  // Early warning for the Sep-2026 outage class: a dead/expired client_id
  // must fail loudly here instead of surfacing later as empty charts.
  const i = await j(`${PBASE}/music/instances`)
  check('soundcloud engine live', i.status === 200 && i.body?.soundcloud?.ok === true, `source=${i.body?.soundcloud?.source} ageH=${i.body?.soundcloud?.ageH}`)
}

console.log('\n━━━ 2. Search (SoundCloud) ━━━')
let firstScId = null
{
  const r = await j(`${PBASE}/music/search?q=${encodeURIComponent('deep house energy')}`)
  const tracks = r.body?.tracks || []
  check('search returns tracks', r.status === 200 && tracks.length > 0, `count=${tracks.length} source=${r.body?.source}`)
  const sc = tracks.find((t) => /^sc_\d+$/.test(t.videoId))
  check('tracks are SoundCloud ids', !!sc)
  if (sc) {
    firstScId = sc.videoId
    check('track metadata complete', !!sc.title && !!sc.artist && !!sc.thumbnail && sc.duration > 0, `${sc.artist} — ${sc.title} (${sc.duration}s)`)
  }
}

console.log('\n━━━ 3. Resolve (playback core) ━━━')
let progressiveUrl = null, hlsProxy = null
{
  const r = await j(`${PBASE}/music/resolve/${firstScId}?fresh=1`)
  const streams = r.body?.streams || []
  check('resolve returns streams', r.status === 200 && streams.length > 0, `instance=${r.body?.instance} candidates=${streams.map((s) => s.label).join(',')}`)
  progressiveUrl = streams.find((s) => s.label === 'soundcloud-progressive')?.url || null
  hlsProxy = streams.find((s) => s.label === 'soundcloud-hls')?.url || null
  check('progressive mp3 candidate', !!progressiveUrl)
  check('HLS proxy candidate', !!hlsProxy && hlsProxy.includes('/api/sc/stream/'))
  check('metadata in resolve', !!r.body?.title && r.body?.duration > 0, `${r.body?.title}`)
}

console.log('\n━━━ 4. Audio endpoint (streaming chain) ━━━')
{
  const res = await fetch(`${BASE}/api/audio/${firstScId}`, { redirect: 'manual', signal: AbortSignal.timeout(60000) })
  const loc = res.headers.get('location') || ''
  check('audio 302 to stable stream', res.status === 302 && loc.includes('/audio.mp3'), loc.slice(0, 90))
  const target = loc.startsWith('http') ? loc : `${BASE}${loc}`
  const seg = await fetch(target, { headers: { Range: 'bytes=0-499999' }, signal: AbortSignal.timeout(60000) })
  const buf = Buffer.from(await seg.arrayBuffer())
  check('mp3 streams through our origin', (seg.status === 200 || seg.status === 206) && buf.length > 100000, `${buf.length} bytes, type=${seg.headers.get('content-type')}, status=${seg.status}`)
  check('mp3 magic bytes', buf.length > 3 && (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33 || buf[0] === 0xff), `first=${buf[0].toString(16)}${buf[1].toString(16)}`)
}

console.log('\n━━━ 5. HLS proxy chain ━━━')
{
  const m3u8Path = hlsProxy?.startsWith('http') ? hlsProxy : `${BASE}${hlsProxy}`
  const res = await fetch(m3u8Path, { signal: AbortSignal.timeout(60000) })
  const text = await res.text()
  check('m3u8 fetched through proxy', res.status === 200 && text.includes('#EXTM3U'), `${text.length} bytes`)
  check('URIs rewritten to our proxy', text.includes('/api/sc/proxy?u='))
  const firstSeg = text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'))
  check('segment line present', !!firstSeg)
  if (firstSeg) {
    const segUrl = firstSeg.startsWith('http') ? firstSeg : `${BASE}${firstSeg}`
    const seg = await fetch(segUrl, { headers: { Range: 'bytes=0-199999' }, signal: AbortSignal.timeout(60000) })
    const buf = Buffer.from(await seg.arrayBuffer())
    check('segment streams through proxy', (seg.status === 200 || seg.status === 206) && buf.length > 10000, `${buf.length} bytes, type=${seg.headers.get('content-type')}`)
  }
  // init segment too
  const mapLine = text.split('\n').find((l) => l.includes('#EXT-X-MAP'))
  if (mapLine) {
    const m = mapLine.match(/URI="([^"]+)"/)
    if (m) {
      const initUrl = m[1].startsWith('http') ? m[1] : `${BASE}${m[1]}`
      const init = await fetch(initUrl, { signal: AbortSignal.timeout(60000) })
      check('init segment fetchable', init.status === 200, `type=${init.headers.get('content-type')}`)
    }
  }
}

console.log('\n━━━ 6. Trending + Featured + Charts ━━━')
{
  const r = await j(`${PBASE}/music/trending/US`)
  check('trending US works', r.status === 200 && (r.body?.tracks || []).length > 0, `count=${r.body?.tracks?.length}`)
  check('trending uses SoundCloud', /^sc_\d+$/.test(r.body?.tracks?.[0]?.videoId || ''))
  const f = await j(`${PBASE}/music/featured`)
  check('featured packs list', f.status === 200 && (f.body?.playlists || []).length >= 5, `count=${f.body?.playlists?.length}`)
  const c = await j(`${PBASE}/music/charts/lofi`)
  check('genre pack plays', c.status === 200 && (c.body?.tracks || []).length > 0, `count=${c.body?.tracks?.length}`)
  const ir = await j(`${PBASE}/music/trending/IR`)
  check('trending IR (persian)', ir.status === 200 && (ir.body?.tracks || []).length > 0, `count=${ir.body?.tracks?.length}`)
}

console.log('\n━━━ 7. SoundCloud playlists discovery + resolve ━━━')
let plUrl = null
{
  const s = await j(`${PBASE}/music/sc/playlists?q=${encodeURIComponent('lofi chill')}`)
  check('playlist search works', s.status === 200 && (s.body?.playlists || []).length > 0, `count=${s.body?.playlists?.length}`)
  const small = (s.body?.playlists || []).slice().sort((a, b) => a.trackCount - b.trackCount)[0]
  if (small) {
    plUrl = small.permalink
    const r = await j(`${PBASE}/music/soundcloud/playlist?url=${encodeURIComponent(plUrl)}`)
    check('playlist resolved with tracks', r.status === 200 && (r.body?.tracks || []).length > 0, `"${r.body?.playlist?.title}" tracks=${r.body?.count}`)
    check('playlist tracks are sc ids', /^sc_\d+$/.test(r.body?.tracks?.[0]?.videoId || ''))
  }
}

console.log('\n━━━ 8. Auth + playlist import (DB round-trip) ━━━')
{
  const stamp = Date.now()
  const reg = await j(`${PBASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `sc_tester_${stamp}`, email: `sc_tester_${stamp}@tuneatlas.test`, password: 'Test1234!', country: 'US' }),
  })
  check('register works', reg.status === 200 && !!reg.body?.token, reg.body?.error || '')
  const token = reg.body?.token
  if (token && plUrl) {
    const imp = await j(`${PBASE}/playlists/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: plUrl }),
    })
    check('SC playlist imported into DB', imp.status === 200 && (imp.body?.added || 0) > 0, `added=${imp.body?.added}/${imp.body?.total}`)
    const plId = imp.body?.playlist?.id
    const det = await j(`${PBASE}/playlists/${plId}`)
    check('imported playlist readable', det.status === 200 && (det.body?.songs || []).length > 0, `songs=${det.body?.songs?.length}`)
    const first = det.body?.songs?.[0]
    check('stored song uses sc id + source', /^sc_\d+$/.test(first?.videoId || ''), `videoId=${first?.videoId}`)
    const rr = await j(`${PBASE}/music/resolve/${first.videoId}?fresh=1`)
    check('stored song resolves for playback', rr.status === 200 && (rr.body?.streams || []).length > 0)
  }
}

console.log('\n━━━ 9. Legacy id remap ━━━')
{
  const r = await j(`${PBASE}/music/resolve/legacy_legacy1?q=${encodeURIComponent('Shape of You Ed Sheeran')}`, { redirect: 'manual' })
  check('legacy yt id remaps via SoundCloud search', r.status === 200 && (r.body?.streams || []).length > 0 && r.body?.instance === 'soundcloud-remap', `instance=${r.body?.instance} title=${r.body?.title}`)
}

console.log('\n━━━ 10. Track URL passthrough ━━━')
{
  const r = await j(`${PBASE}/music/search?q=${encodeURIComponent('https://soundcloud.com/imael-angel/bad-times-deep-house-energy')}`)
  check('pasted track URL resolves', r.status === 200 && r.body?.tracks?.length === 1 && r.body?.source === 'soundcloud-url', `source=${r.body?.source} title=${r.body?.tracks?.[0]?.title}`)
}

console.log('\n════════════════════════════════')
console.log(`RESULT: ${pass} passed, ${fail} failed`)
if (failures.length) {
  console.log('Failed checks:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}



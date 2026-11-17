// E2E playlist lifecycle smoke test (local server, real DB + SoundCloud)
const BASE = 'http://127.0.0.1:3215'
let ok = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
}
const j = async (path, opts = {}) => {
  try {
    const r = await fetch(BASE + path, { ...opts, redirect: 'manual' })
    let body = null
    try { body = await r.json() } catch { try { body = await r.text() } catch {} }
    return { status: r.status, body, headers: r.headers }
  } catch (e) { return { status: 0, body: null, error: e.message } }
}
const email = `pl_e2e_${Date.now()}@test.local`
let token = null, userId = null, plId = null, scTrackId = null

// boot server with inherited env (PORT=3215 set by caller)
const { spawn } = require('child_process')
const srv = spawn(process.execPath, ['server.cjs'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] })
srv.stdout.on('data', () => {})
srv.stderr.on('data', (d) => process.stderr.write('[srv] ' + d))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  for (let i = 0; i < 20; i++) {
    const h = await j('/api/health')
    if (h.status === 200) break
    await sleep(500)
  }
  const h = await j('/api/health')
  check('health', h.status === 200, JSON.stringify(h.body))

  // 1. signup
  const su = await j('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pl_e2e_' + Date.now(), email, password: 'Passw0rd!' }) })
  check('register', su.status === 200 && su.body?.token, `status=${su.status}`)
  token = su.body?.token; userId = su.body?.user?.id

  // 2. create playlist
  const cp = await j('/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'E2E Check ' + new Date().toISOString().slice(0, 10), description: 'audit', isPublic: true }) })
  check('create playlist', cp.status === 200 && cp.body?.playlist?.id, `status=${cp.status}`)
  plId = cp.body?.playlist?.id

  // 3. search a real track
  const sr = await j('/api/music/search?q=' + encodeURIComponent('shape of you ed sheeran'))
  const first = sr.body?.tracks?.[0]
  check('search works', sr.status === 200 && (sr.body?.tracks?.length || 0) > 0, `source=${sr.body?.source} count=${sr.body?.tracks?.length}`)
  check('search is full-length (no snippets)', (sr.body?.tracks || []).every((t) => !t.snippet))

  // 4. add track to playlist (as the app does)
  const add = await j(`/api/playlists/${plId}/songs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(first) })
  check('add track', add.status === 200 && add.body?.id, `status=${add.status} id=${add.body?.id}`)
  scTrackId = first.videoId

  // 5. duplicate add → duplicate:true (no double rows)
  const add2 = await j(`/api/playlists/${plId}/songs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(first) })
  check('duplicate add rejected', add2.status === 200 && add2.body?.duplicate === true, `duplicate=${add2.body?.duplicate}`)

  const count = (await j(`/api/playlists/${plId}`)).body?.songs?.length
  check('exactly 1 song stored', count === 1, `count=${count}`)

  // 6. playlist detail: song complete + playable
  const det = (await j(`/api/playlists/${plId}`)).body
  const song = det?.songs?.[0]
  check('song fields complete', !!song?.title && !!song?.artist && !!song?.videoId && !!song?.thumbnail, `videoId=${song?.videoId}`)
  check('song id present (remove/reorder need it)', typeof song?.id === 'number')
  const rs = await j(`/api/music/resolve/${song.videoId}?fresh=1`)
  check('stored song resolves', rs.status === 200 && (rs.body?.streams || []).length > 0, `instance=${rs.body?.instance} streams=${(rs.body?.streams || []).map((s) => s.label).join(',')}`)

  // 7. reorder + delete
  const ro = await j(`/api/playlists/${plId}/reorder`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ids: [song.id] }) })
  check('reorder ok', ro.status === 200, `status=${ro.status}`)
  const del = await j(`/api/playlists/${plId}/songs/${song.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  check('delete song ok', del.status === 200)
  const det2 = (await j(`/api/playlists/${plId}`)).body
  check('playlist empty after delete', (det2?.songs?.length || 0) === 0)

  // 8. cleanup: delete playlist + user
  await j(`/api/playlists/${plId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  console.log(`\nRESULT: ${ok} passed, ${fail} failed`)
  srv.kill()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('E2E FAIL:', e); srv.kill(); process.exit(1) })

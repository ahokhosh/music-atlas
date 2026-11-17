// Verify the exact user scenario: POST auth through the 8090 preview proxy
const B = 'http://localhost:8090/playlist/api'
const stamp = Date.now()
const user = { username: `u_${stamp}`, email: `u_${stamp}@t.test`, password: 'pass1234' }

const reg = await fetch(`${B}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user) })
const regj = await reg.json()
console.log('POST /auth/register via 8090:', reg.status, '| token:', !!regj.token, '| err:', regj.error || '')

const login = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: user.password }) })
const lj = await login.json()
console.log('POST /auth/login  via 8090:', login.status, '| token:', !!lj.token, '| err:', lj.error || '')

const mine = await fetch(`${B}/playlists/mine`, { headers: { Authorization: `Bearer ${lj.token}` } })
console.log('GET  /playlists/mine via 8090:', mine.status)

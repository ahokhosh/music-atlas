import { useState } from 'react'
import { useUser } from '../services/UserContext'
import { COUNTRIES } from '../data/countries'

const ERRORS: Record<string, string> = {
  email_taken: 'This email is already registered',
  invalid_credentials: 'Wrong email or password',
  missing_fields: 'Please fill in all fields',
  server_error: 'Server error — try again',
  db_unavailable: 'Account service is offline (database unreachable) — check the server and try again',
}

export default function AuthPage({ nav }: { nav: (p: string) => void }) {
  const { login, register } = useUser()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [country, setCountry] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (mode === 'login') await login(email.trim(), password)
      else await register(username.trim(), email.trim(), password, country || undefined)
      // return to the page the user came from (e.g. an interrupted "add to playlist")
      const next = sessionStorage.getItem('ta_auth_next')
      sessionStorage.removeItem('ta_auth_next')
      nav(next && next.startsWith('/') && !next.startsWith('/auth') ? next : '/')
    } catch (ex: any) {
      setErr(ERRORS[ex?.code] || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="animate-fade-in min-h-[85dvh] flex flex-col justify-center max-w-md mx-auto px-1">
      <div className="text-center mb-8">
        <div
          className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center shadow-2xl mb-4"
          style={{ background: 'linear-gradient(135deg,#8b5cf6,#ec4899)' }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
        </div>
        <h1 className="display text-2xl font-extrabold grad-text">Music Atlas</h1>
        <p className="text-[13px] text-(--text-dim) mt-1">Music of every nation, your playlists, zero limits</p>
      </div>

      <div className="flex gap-1 p-1 rounded-2xl bg-white/4 border border-white/8 mb-6">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            className={`flex-1 py-2.5 rounded-xl text-[13.5px] font-bold transition-all ${mode === m ? 'bg-white text-black' : 'text-white/55'}`}
            onClick={() => setMode(m)}
          >
            {m === 'login' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="card p-5 space-y-4">
        {mode === 'register' && (
          <div>
            <span className="label">Username</span>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. musicfan" maxLength={50} required />
          </div>
        )}
        <div>
          <span className="label">Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
        </div>
        <div>
          <span className="label">Password</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" minLength={6} required />
        </div>
        {mode === 'register' && (
          <div>
            <span className="label">Your country (for the Atlas)</span>
            <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="">🌍 Global</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
              ))}
            </select>
          </div>
        )}

        {err && (
          <p className="text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-3.5 py-2.5">{err}</p>
        )}

        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <button className="text-[12.5px] text-(--muted) hover:text-white mt-5 text-center" onClick={() => nav('/')}>
        ← Continue without account
      </button>
    </div>
  )
}

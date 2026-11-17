import { usePlayer } from '../services/PlayerContext'
import { useUser } from '../services/UserContext'
import { getCountry } from '../data/countries'

export type NavFn = (path: string) => void

interface NavProps {
  route: string
  nav: NavFn
}

const ITEMS = [
  { path: '/', label: 'Home', icon: 'home' },
  { path: '/explore', label: 'Atlas', icon: 'globe' },
  { path: '/search', label: 'Search', icon: 'search' },
  { path: '/library', label: 'Library', icon: 'library' },
]

function Icon({ name, active }: { name: string; active: boolean }) {
  const stroke = active ? 2.4 : 2
  const c = 'currentColor'
  if (name === 'home')
    return <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? c : 'none'} stroke={c} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5L12 3l9 7.5" /><path d="M5 9.5V21h5v-6h4v6h5V9.5" /></svg>
  if (name === 'globe')
    return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={stroke}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" /></svg>
  if (name === 'search')
    return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={stroke} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="14" height="16" rx="2" /><path d="M17 8h2.5a1.5 1.5 0 0 1 1.5 1.5V19a2 2 0 0 1-2 2h-1" /><path d="M7 9h6M7 13h6" /></svg>
}

function isActive(route: string, path: string): boolean {
  if (path === '/') return route === '/'
  return route.startsWith(path)
}

export function BottomNav({ route, nav }: NavProps) {
  const { sheetOpen } = usePlayer()
  if (sheetOpen) return null
  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-[65] glass border-t border-white/8 safe-b"
    >
      <div className="flex justify-around items-stretch h-[var(--nav-h)] max-w-xl mx-auto">
        {ITEMS.map((it) => {
          const active = isActive(route, it.path)
          return (
            <button
              key={it.path}
              onClick={() => nav(it.path)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 transition-colors ${active ? 'text-violet-400' : 'text-white/45'}`}
            >
              <Icon name={it.icon} active={active} />
              <span className="text-[10px] font-semibold">{it.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export function Sidebar({ route, nav }: NavProps) {
  const { user } = useUser()
  const country = getCountry(user?.country)
  return (
    <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-60 flex-col p-4 border-r border-white/6 bg-[#0a0a12]">
      <button className="flex items-center gap-2.5 px-2 py-3 mb-4" onClick={() => nav('/')}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg,#8b5cf6,#ec4899)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
        </div>
        <span className="display text-lg font-extrabold grad-text">Music Atlas</span>
      </button>

      <button className="btn btn-primary w-full mb-5 !justify-start !pl-3.5" onClick={() => nav('/library?new=1')}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        New Playlist
      </button>

      <div className="space-y-1">
        {ITEMS.map((it) => {
          const active = isActive(route, it.path)
          return (
            <button
              key={it.path}
              onClick={() => nav(it.path)}
              className={`w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-[14px] font-semibold transition-all ${active ? 'bg-white/8 text-white' : 'text-white/45 hover:text-white hover:bg-white/4'}`}
            >
              <Icon name={it.icon} active={active} />
              {it.label}
            </button>
          )
        })}
      </div>

      <div className="mt-auto px-2 pb-1">
        {user ? (
          <button className="flex items-center gap-3 w-full p-2 rounded-xl hover:bg-white/5" onClick={() => nav('/library')}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-sm" style={{ background: 'linear-gradient(135deg,#8b5cf6,#ec4899)' }}>
              {user.username[0].toUpperCase()}
            </div>
            <div className="text-left min-w-0">
              <p className="text-[13px] font-semibold truncate">{user.username}</p>
              <p className="text-[11px] text-white/40">{country ? `${country.flag} ${country.name}` : 'Listener'}</p>
            </div>
          </button>
        ) : (
          <button className="btn btn-soft w-full" onClick={() => nav('/auth')}>Sign in</button>
        )}
      </div>
    </aside>
  )
}

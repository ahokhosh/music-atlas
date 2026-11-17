import { useCallback, useEffect, useState } from 'react'
import { UserProvider, useUser } from './services/UserContext'
import { PlayerProvider } from './services/PlayerContext'
import { Sidebar, BottomNav } from './components/Nav'
import MiniPlayer from './components/MiniPlayer'
import NowPlaying from './components/NowPlaying'
import ToastHost, { toast } from './components/Toast'
import AddToPlaylistModal from './components/AddToPlaylistModal'
import HomePage from './pages/HomePage'
import ExplorePage from './pages/ExplorePage'
import CountryPage from './pages/CountryPage'
import SearchPage from './pages/SearchPage'
import LibraryPage from './pages/LibraryPage'
import PlaylistPage from './pages/PlaylistPage'
import AuthPage from './pages/AuthPage'
import PackPage from './pages/PackPage'
import GenrePage from './pages/GenrePage'
import ArtistPage from './pages/ArtistPage'
import type { Track } from './services/api'

interface Route {
  path: string
  segments: string[]
  query: URLSearchParams
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [pathPart, queryPart] = raw.split('?')
  const path = pathPart || '/'
  return { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(queryPart || '') }
}

function AppContent() {
  const [route, setRoute] = useState<Route>(parseHash)
  const [addTrack, setAddTrack] = useState<Track | null>(null)
  const { user } = useUser()

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // resume a pending "add to playlist" intent after sign-in
  useEffect(() => {
    const pending = sessionStorage.getItem('ta_pending_add')
    if (pending && user) {
      sessionStorage.removeItem('ta_pending_add')
      try { setAddTrack(JSON.parse(pending)) } catch { /* ignore */ }
    }
  }, [user])

  const nav = useCallback((to: string) => {
    const target = to.startsWith('/') ? to : `/${to}`
    if (`#${target}` === window.location.hash) return
    window.location.hash = target
  }, [])

  const seg = route.segments

  const page = (() => {
    if (seg[0] === 'auth') return <AuthPage nav={nav} />
    if (seg[0] === 'explore') return <ExplorePage nav={nav} />
    if (seg[0] === 'search') {
      // Key by query so navigating /search?q=X while already on /search
      // (e.g. from recents) resyncs the input instead of showing stale text.
      return <SearchPage key={`search:${route.query.get('q') || ''}`} initialQuery={route.query.get('q') || ''} addPlaylistId={route.query.get('add')} onAdd={setAddTrack} nav={nav} />
    }
    if (seg[0] === 'country' && seg[1]) {
      return <CountryPage code={seg[1].toUpperCase()} nav={nav} onAdd={setAddTrack} />
    }
    if (seg[0] === 'playlist' && seg[1]) {
      const pid = Number(seg[1])
      if (!Number.isFinite(pid) || pid <= 0) {
        return <HomePage nav={nav} onAdd={setAddTrack} />
      }
      return <PlaylistPage id={pid} nav={nav} onAdd={setAddTrack} />
    }
    if (seg[0] === 'pack' && seg[1]) {
      return <PackPage id={seg[1]} nav={nav} onAdd={setAddTrack} />
    }
    if (seg[0] === 'genre' && seg[1]) {
      return <GenrePage slug={seg[1]} nav={nav} onAdd={setAddTrack} />
    }
    if (seg[0] === 'library') {
      return (
        <LibraryPage
          nav={nav}
          openNew={route.query.get('new') === '1'}
          onCloseNew={() => nav('/library')}
        />
      )
    }
    if (seg[0] === 'artist' && seg[1]) {
      return <ArtistPage name={seg[1]} nav={nav} />
    }
    return <HomePage nav={nav} onAdd={setAddTrack} />
  })()

  const hideChrome = seg[0] === 'auth'

  return (
    <div className="min-h-dvh">
      <Sidebar route={route.path} nav={nav} />
      <main className="app-shell">
        <div className={hideChrome ? '' : 'page-pad'}>{page}</div>
      </main>

      {!hideChrome && <BottomNav route={route.path} nav={nav} />}
      <MiniPlayer />
      <NowPlaying />
      <ToastHost />

      <AddToPlaylistModal
        open={!!addTrack}
        track={addTrack}
        onClose={() => setAddTrack(null)}
        onGoLibrary={() => {
          setAddTrack(null)
          nav('/library?new=1')
        }}
        onNeedAuth={() => {
          // keep the intent: after sign-in the modal reopens with the same track
          if (addTrack) sessionStorage.setItem('ta_pending_add', JSON.stringify(addTrack))
          sessionStorage.setItem('ta_auth_next', window.location.hash.replace(/^#/, '') || '/')
          setAddTrack(null)
          toast('Sign in to continue')
          nav('/auth')
        }}
      />
    </div>
  )
}

export default function App() {
  return (
    <UserProvider>
      <PlayerProvider>
        <AppContent />
      </PlayerProvider>
    </UserProvider>
  )
}


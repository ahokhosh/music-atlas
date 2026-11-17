import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api } from './api'

export interface User {
  id: number
  username: string
  email: string
  country: string | null
}

interface UserContextType {
  user: User | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string, country?: string) => Promise<void>
  logout: () => void
}

const UserContext = createContext<UserContextType | null>(null)

export function useUser() {
  const ctx = useContext(UserContext)
  if (!ctx) throw new Error('useUser must be inside UserProvider')
  return ctx
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('ta_token'))
  const [loading, setLoading] = useState(!!localStorage.getItem('ta_token'))

  // restore session
  useEffect(() => {
    if (!localStorage.getItem('ta_token')) return
    api<{ user: User }>('/auth/me')
      .then((d) => setUser(d.user))
      .catch((e: any) => {
        // Only a genuine auth rejection clears the session.
        // Network/5xx hiccups must NOT log the user out.
        if (e?.status === 401 || e?.code === 'invalid_token' || e?.code === 'no_token') {
          localStorage.removeItem('ta_token')
          setToken(null)
          setUser(null)
        }
        // otherwise keep the token; the user stays signed in and can retry
      })
      .finally(() => setLoading(false))
  }, [])

  const finishAuth = (data: { token: string; user: User }) => {
    localStorage.setItem('ta_token', data.token)
    setToken(data.token)
    setUser(data.user)
  }

  const login = async (email: string, password: string) => {
    finishAuth(await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }))
  }

  const register = async (username: string, email: string, password: string, country?: string) => {
    finishAuth(
      await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password, country }),
      })
    )
  }

  const logout = () => {
    localStorage.removeItem('ta_token')
    setToken(null)
    setUser(null)
  }

  return (
    <UserContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </UserContext.Provider>
  )
}


import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, clearSession, getStoredUser, getToken, setSession } from '../lib/api'
import type { User } from '../lib/types'

interface AuthCtx {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  /** Consume the one-time setup code and sign in as the first admin. */
  completeSetup: (input: { code: string; full_name: string; email: string; password: string }) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  login: async () => {},
  completeSetup: async () => {},
  logout: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => clearSession())
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password)
    setSession(r.token, r.user)
    setUser(r.user)
  }, [])

  const logout = useCallback(() => {
    clearSession()
    setUser(null)
  }, [])

  const completeSetup = useCallback(
    async (input: { code: string; full_name: string; email: string; password: string }) => {
      const r = await api.setupComplete(input)
      setSession(r.token, r.user)
      setUser(r.user)
    },
    [],
  )

  return (
    <Ctx.Provider value={{ user, loading, login, completeSetup, logout }}>{children}</Ctx.Provider>
  )
}

export function useAuth() {
  return useContext(Ctx)
}

/** Guard against direct getStoredUser misuse — re-export for convenience */
export function storedUser(): User | null {
  return getStoredUser() as User | null
}

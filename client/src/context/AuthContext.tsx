import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, patch, post, tokenStore, UNAUTHORIZED_EVENT } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';
import { setLanguage } from '../i18n';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: Record<string, unknown>) => Promise<{ user: User; pendingApproval: boolean }>;
  logout: () => void;
  updateProfile: (input: Record<string, unknown>) => Promise<User>;
}
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(!!tokenStore.get());

  const logout = useCallback(() => {
    tokenStore.set(null);
    disconnectSocket();
    setUser(null);
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) return;
    get<{ user: User }>('/auth/me')
      .then((r) => {
        setUser(r.user);
        connectSocket();
      })
      .catch(() => tokenStore.set(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const h = () => logout();
    window.addEventListener(UNAUTHORIZED_EVENT, h);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, h);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await post<{ user: User; token: string }>('/auth/login', { email, password });
    tokenStore.set(r.token);
    setUser(r.user);
    connectSocket();
    void setLanguage(r.user.preferredLanguage);
    return r.user;
  }, []);

  const register = useCallback(async (input: Record<string, unknown>) => {
    const r = await post<{ user: User; token: string | null; pendingApproval: boolean }>('/auth/register', input);
    if (r.token) {
      tokenStore.set(r.token);
      setUser(r.user);
      connectSocket();
    }
    return { user: r.user, pendingApproval: r.pendingApproval };
  }, []);

  const updateProfile = useCallback(async (input: Record<string, unknown>) => {
    const r = await patch<{ user: User }>('/auth/me', input);
    setUser(r.user);
    return r.user;
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout, updateProfile }), [user, loading, login, register, logout, updateProfile]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
};

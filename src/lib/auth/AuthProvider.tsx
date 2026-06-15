'use client';
// src/lib/auth/AuthProvider.tsx
//
// Client-side auth context. Hydrated from the server via initialUser prop
// (set in RootLayout via getServerSession) to avoid first-paint flash.
//
// No proactive refresh interval — auth refresh is reactive, driven by the
// 401-retry in apiFetch. See client.ts for the single-flight guard.

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { User } from '@/lib/api/types';
import * as authApi from '@/lib/api/auth';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** True iff we have a user object in state. (httpOnly cookies are not visible to JS.) */
  isAuthenticated: boolean;
  /** Returns 'ok' or '2fa'; throws on bad creds / network. */
  login(username: string, password: string): Promise<'ok' | '2fa'>;
  /** Completes the 2FA half-step. Throws on bad TOTP or network error. */
  verify2FA(totp_code: string): Promise<void>;
  /** Best-effort: POST /api/auth/logout, then clears local user state. */
  logout(): Promise<void>;
  /** Force a silent /api/auth/refresh. Returns true on success. */
  refresh(): Promise<boolean>;
}

// No-op fallback — returned by useAuth() outside a provider.
// Keeps test harnesses and pages that aren't wrapped simple.
const NO_OP_CONTEXT: AuthContextValue = {
  user: null,
  loading: false,
  isAuthenticated: false,
  login: async () => 'ok',
  verify2FA: async () => { /* no-op */ },
  logout: async () => { /* no-op */ },
  refresh: async () => false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  initialUser,
  children,
}: {
  /** Hydrated from the server in RootLayout — avoids first-paint flash. */
  initialUser: User | null;
  children: ReactNode;
}): React.JSX.Element {
  const [user, setUser] = useState<User | null>(initialUser);
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (username: string, password: string): Promise<'ok' | '2fa'> => {
    setLoading(true);
    try {
      const result = await authApi.login(username, password);
      if (result.kind === 'ok') {
        setUser(result.user);
        return 'ok';
      }
      // 2FA required — partial_token stored in httpOnly st_partial cookie by BFF
      return '2fa';
    } finally {
      setLoading(false);
    }
  }, []);

  const verify2FA = useCallback(async (totp_code: string): Promise<void> => {
    setLoading(true);
    try {
      const result = await authApi.verify2FA(totp_code);
      setUser(result.user);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    // Clear user immediately — UI unblocks before the network call completes
    setUser(null);
    try {
      await authApi.logout();
    } catch {
      // Best-effort: BFF clears cookies even on upstream failure (§2.7.3)
    }
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      await authApi.refresh();
      return true;
    } catch {
      return false;
    }
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    isAuthenticated: user !== null,
    login,
    verify2FA,
    logout,
    refresh,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  // Outside provider — return no-op fallback
  return ctx ?? NO_OP_CONTEXT;
}

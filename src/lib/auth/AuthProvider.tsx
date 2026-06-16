'use client';
// src/lib/auth/AuthProvider.tsx
//
// Client-side auth context. Hydrated from the server via initialUser prop
// (set in RootLayout via getServerSession) to avoid first-paint flash.
//
// No proactive refresh interval — auth refresh is reactive, driven by the
// 401-retry in apiFetch. See client.ts for the single-flight guard.
//
// initialMaybeAuthed: when true, the access token was expired/missing but
// a refresh cookie was present server-side. We mount in loading=true and
// run a single silent refresh→me on mount to populate user without painting
// a logged-out frame. See M2 fix in SPRINT2_FOUNDATION_DESIGN.md §10.

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { User } from '@/lib/api/types';
import * as authApi from '@/lib/api/auth';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** True iff we have a user object in state. (httpOnly cookies are not visible to JS.) */
  isAuthenticated: boolean;
  /**
   * True when we believe the user may be authenticated (refresh cookie present
   * server-side) but haven't confirmed it yet (access token was expired/missing).
   * Consumers can use this alongside loading to distinguish "loading while authed"
   * from "genuinely logged out".
   */
  maybeAuthed: boolean;
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
  maybeAuthed: false,
  login: async () => 'ok',
  verify2FA: async () => { /* no-op */ },
  logout: async () => { /* no-op */ },
  refresh: async () => false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  initialUser,
  initialMaybeAuthed = false,
  children,
}: {
  /** Hydrated from the server in RootLayout — avoids first-paint flash. */
  initialUser: User | null;
  /**
   * When true, the server saw a refresh cookie but no valid access token.
   * The provider starts in loading=true and performs a silent refresh+me
   * on mount so the page never paints logged-out for a returning user.
   */
  initialMaybeAuthed?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const [user, setUser] = useState<User | null>(initialUser);
  // Start loading if we think the user is authed but need to confirm via refresh.
  const [loading, setLoading] = useState(initialMaybeAuthed && !initialUser);
  const [maybeAuthed, setMaybeAuthed] = useState(initialMaybeAuthed && !initialUser);

  // Guard against React 18/19 strict-mode double-invoke of useEffect.
  // client.ts already single-flights /api/auth/refresh, but we also prevent
  // a second mount effect from running the whole refresh+me sequence again.
  const silentRefreshRan = useRef(false);

  useEffect(() => {
    // Only run the silent refresh if we mounted in the "maybeAuthed" loading state.
    if (!initialMaybeAuthed || initialUser || silentRefreshRan.current) return;
    silentRefreshRan.current = true;

    let cancelled = false;

    async function silentRefresh() {
      try {
        await authApi.refresh();
        const data = await authApi.me();
        if (!cancelled) {
          setUser(data.user);
        }
      } catch {
        // Refresh or me() failed — leave user as null (logged out).
        // proxy.ts would have redirected if the refresh token was absent;
        // if it's here and fails, the token expired during the request.
      } finally {
        if (!cancelled) {
          setLoading(false);
          setMaybeAuthed(false);
        }
      }
    }

    void silentRefresh();

    return () => { cancelled = true; };
    // Intentionally empty deps — runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setMaybeAuthed(false);
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
    maybeAuthed,
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

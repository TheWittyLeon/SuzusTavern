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

/**
 * UIR2-TAV-3: distinguishes WHY the user is unauthenticated once we've
 * actually tried and failed, so consumers (useAuthGate) can prompt re-auth
 * instead of hanging in a skeleton or silently rendering a null user.
 *   - 'expired': refresh/me failed for any other reason (401, network, etc.)
 *   - 'rate_limited': refresh/me failed with a 429
 * `null` means "no known auth failure" — covers both "never tried" and
 * "genuinely logged out" (useAuthGate tells those apart via loading/maybeAuthed).
 */
export type AuthError = null | 'expired' | 'rate_limited';

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
  /**
   * Set when a silent refresh/me actually failed (as opposed to never having
   * run, or a genuine logout). Consumers (useAuthGate) use this to show a
   * re-auth prompt instead of an unbounded skeleton or a silent redirect.
   */
  authError: AuthError;
  /** Returns 'ok' or '2fa'; throws on bad creds / network. */
  login(username: string, password: string): Promise<'ok' | '2fa'>;
  /** Completes the 2FA half-step. Throws on bad TOTP or network error. */
  verify2FA(totp_code: string): Promise<void>;
  /** Best-effort: POST /api/auth/logout, then clears local user state. */
  logout(): Promise<void>;
  /** Force a silent /api/auth/refresh. Returns true on success. */
  refresh(): Promise<boolean>;
  /** Re-attempt refresh+me after an authError (e.g. the rate-limited retry CTA). */
  retryAuth(): Promise<void>;
}

// No-op fallback — returned by useAuth() outside a provider.
// Keeps test harnesses and pages that aren't wrapped simple.
const NO_OP_CONTEXT: AuthContextValue = {
  user: null,
  loading: false,
  isAuthenticated: false,
  maybeAuthed: false,
  authError: null,
  login: async () => 'ok',
  verify2FA: async () => { /* no-op */ },
  logout: async () => { /* no-op */ },
  refresh: async () => false,
  retryAuth: async () => { /* no-op */ },
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
  // UIR2-TAV-3: set only on an ACTUAL refresh/me failure — see silentRefresh's
  // catch and retryAuth below. Cleared on any successful auth transition.
  const [authError, setAuthError] = useState<AuthError>(null);

  // Guard against React 18/19 strict-mode double-invoke of useEffect.
  // client.ts already single-flights /api/auth/refresh, but we also prevent
  // a second mount effect from running the whole refresh+me sequence again.
  const silentRefreshRan = useRef(false);
  // In-flight guard for retryAuth (UIR2-TAV-3 / Miko-QA): prevents two calls in
  // the same tick from letting a later failure clobber an earlier success.
  const retryingRef = useRef(false);

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
          setAuthError(null);
        }
      } catch (e) {
        // Refresh or me() failed — leave user as null (logged out), but
        // record WHY so useAuthGate can prompt re-auth instead of hanging in
        // a skeleton forever. proxy.ts would have redirected if the refresh
        // token was absent; if it's here and fails, the token expired (or
        // the refresh endpoint is rate-limiting us) during the request.
        if (!cancelled) {
          setAuthError((e as { status?: number })?.status === 429 ? 'rate_limited' : 'expired');
        }
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
        setAuthError(null);
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
      setAuthError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    // Clear user immediately — UI unblocks before the network call completes
    setUser(null);
    setMaybeAuthed(false);
    // Clear any stale re-auth error so a prior failed retry can't surface a
    // "Try again" prompt on the next protected-page visit (Miko-QA).
    setAuthError(null);
    try {
      await authApi.logout();
    } catch {
      // Best-effort: BFF clears cookies even on upstream failure (§2.7.3)
    }
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      await authApi.refresh();
      setAuthError(null);
      return true;
    } catch {
      return false;
    }
  }, []);

  // UIR2-TAV-3: re-attempt refresh+me after an authError — wired to
  // SessionExpired's 'rate_limited' retry CTA via useAuthGate. Mirrors the
  // mount-time silentRefresh sequence, but is caller-invoked rather than
  // effect-driven. The retryingRef guard prevents a same-tick double invoke
  // from letting a later failure clobber an earlier success's cleared error.
  const retryAuth = useCallback(async (): Promise<void> => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setLoading(true);
    setAuthError(null);
    try {
      await authApi.refresh();
      const data = await authApi.me();
      setUser(data.user);
      setAuthError(null);
      setMaybeAuthed(false);
    } catch (e) {
      setAuthError((e as { status?: number })?.status === 429 ? 'rate_limited' : 'expired');
    } finally {
      retryingRef.current = false;
      setLoading(false);
    }
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    isAuthenticated: user !== null,
    maybeAuthed,
    authError,
    login,
    verify2FA,
    logout,
    refresh,
    retryAuth,
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

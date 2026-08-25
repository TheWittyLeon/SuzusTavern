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
 *   - 'expired': refresh/me genuinely rejected the session (401/403 etc.)
 *   - 'rate_limited': refresh/me failed with a 429
 *   - 'offline': TAV3-OFFLINE-VARIANT — refresh/me failed because the
 *     request itself never got a real answer (network/abort, or a 5xx from
 *     the server) — the client can't tell if the session is still valid.
 *     Distinct from 'expired': that copy asserts a security action ("you've
 *     been signed out") that may not have happened, and its CTA is
 *     sign-in, not retry.
 * `null` means "no known auth failure" — covers both "never tried" and
 * "genuinely logged out" (useAuthGate tells those apart via loading/maybeAuthed).
 */
export type AuthError = null | 'expired' | 'rate_limited' | 'offline';

/**
 * TAV3-OFFLINE-VARIANT: classify a failed refresh/me call's thrown ApiError
 * into an AuthError. `status === 0` is client.ts's own network/abort
 * sentinel (fetch never got an HTTP response at all); `status >= 500` is a
 * genuine server-side failure — neither says anything about whether THIS
 * session is actually still valid, so both get the retry-oriented 'offline'
 * copy rather than 'expired's sign-out assertion. Everything else (401, 403,
 * any other 4xx) is a real rejection of the session — 'expired'.
 *
 * Kage-CR item 9: `code === 'invalid_response'` (client.ts's own guard for a
 * non-JSON/empty 2xx body — TAV-DND-PROXY-JSON-PARSE-500) is checked FIRST
 * and always classifies as 'offline', regardless of its status. That guard
 * always carries a 2xx status (the request itself succeeded; only the body
 * failed to parse), which the status-only rule below would otherwise map to
 * 'expired' — falsely asserting "you've been signed out" for what is really
 * a malformed/empty response body.
 */
function classifyAuthError(e: unknown): AuthError {
  const { status, code } = (e as { status?: number; code?: string }) ?? {};
  if (code === 'invalid_response') return 'offline';
  if (status === 429) return 'rate_limited';
  if (status === 0 || (typeof status === 'number' && status >= 500)) return 'offline';
  return 'expired';
}

/**
 * MAJOR-2 (Tora, interaction review): bound on retryAuth()'s refresh+me
 * round-trip. Without this, a hung TCP connection (no HTTP response, no
 * error, ever) left the caller awaiting `authApi.refresh()`/`authApi.me()`
 * forever — see retryAuth() below for how the timeout is classified.
 */
const RETRY_AUTH_TIMEOUT_MS = 12_000;

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
  /**
   * MAJOR-2 (Tora): true while `retryAuth()` has an attempt in flight.
   * useAuthGate threads this to SessionExpired as `busy` so the SAME CTA
   * stays mounted and focused (never swapped for the generic skeleton)
   * through the whole retry, showing a "Retrying…" state instead.
   */
  retrying: boolean;
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
  retrying: false,
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
  // MAJOR-2 (Tora): true only while retryAuth()'s own attempt is in flight —
  // see retryAuth below for why `authError` itself is deliberately NOT
  // cleared at the start of a retry.
  const [retrying, setRetrying] = useState(false);

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
          setAuthError(classifyAuthError(e));
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
    setRetrying(true);
    // MAJOR-2 (Tora, interaction review): deliberately NOT clearing
    // `authError` here (unlike the old code). useAuthGate checks its
    // authError branches BEFORE the generic loading skeleton, so clearing it
    // the instant a retry starts used to unmount SessionExpired (and its
    // "Try again" CTA, along with whatever had focus) in favour of the bare
    // skeleton for the whole retry — leaving nothing re-clickable if it hung.
    // Leaving `authError` as-is keeps the SAME SessionExpired mounted (and
    // focused) the entire time; `retrying` (below) drives its busy/"Retrying…"
    // presentation instead.
    try {
      // Bound the whole attempt — an unbounded hung connection previously
      // left the user on an indefinite state with nothing to click. Fetch
      // rejects with the signal's abort reason (a TimeoutError-shaped
      // DOMException) on timeout; client.ts's catch normalizes ANY
      // aborted/network fetch failure to ApiError{status: 0} regardless of
      // the exact DOMException name, and classifyAuthError maps status 0 to
      // 'offline' either way — so the CTA reliably reappears (busy state
      // clears) within the bound, no matter which of the two DOMException
      // shapes the runtime throws.
      const signal = AbortSignal.timeout(RETRY_AUTH_TIMEOUT_MS);
      await authApi.refresh(signal);
      const data = await authApi.me(signal);
      setUser(data.user);
      setAuthError(null);
      setMaybeAuthed(false);
    } catch (e) {
      setAuthError(classifyAuthError(e));
    } finally {
      retryingRef.current = false;
      setRetrying(false);
      setLoading(false);
    }
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    isAuthenticated: user !== null,
    maybeAuthed,
    authError,
    retrying,
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

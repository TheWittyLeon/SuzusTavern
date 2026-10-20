/**
 * @jest-environment <rootDir>/src/test-utils/jsdom-with-fetch-env.js
 */
/**
 * TAV-LOGOUT-STAYS-ON-DASHBOARD — sign-out against a SLOW logout response, with the REAL
 * AuthProvider, useAuthGate, TavernShell user menu and src/proxy.ts. Only the browser is modelled:
 *
 *   - a cookie jar the logout response clears (the BFF's Set-Cookie),
 *   - the Next client router: `replace(url)` asks the real proxy what the edge would answer for the
 *     jar as it is NOW, and caches the landed URL per requested URL. The cache is not a guess: on
 *     the dev Tavern (2026-10-20) a `/login` replace after the cookies were gone issued no request
 *     and stayed on /dashboard, because the earlier 307 for the same URL was replayed.
 *
 * The suites that mock useAuth and the router cannot see this: the bug is the ORDER of the gate's
 * redirect, the cookie clear, and the shell's own redirect.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextRequest } from 'next/server';

const mockTrace: { url: string; landed: string; atLogoutDone: boolean }[] = [];
let mockLocation = '/dashboard';
const mockCache = new Map<string, string>();
let mockJar: Record<string, string> = {};
let mockLogoutDone = false;

jest.mock('next/navigation', () => ({
  usePathname: () => mockLocation.split('?')[0],
  useRouter: () => ({
    replace: (url: string) => {
      let landed = mockCache.get(url);
      if (landed === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { proxy } = require('../../proxy') as typeof import('../../proxy');
        const cookie = Object.entries(mockJar).map(([k, v]) => `${k}=${v}`).join('; ');
        const res = proxy(new NextRequest(`http://localhost:3000${url}`, { headers: cookie ? { cookie } : {} }));
        const loc = res.headers.get('location');
        landed = loc ? new URL(loc).pathname + new URL(loc).search : url;
        mockCache.set(url, landed);
      }
      mockTrace.push({ url, landed, atLogoutDone: mockLogoutDone });
      mockLocation = landed;
    },
    push: jest.fn(),
  }),
}));
jest.mock('../../lib/theme/ThemeProvider', () => ({
  useTheme: () => ({ vibe: 'dusk-tavern', setVibe: jest.fn(), density: 'cozy', setDensity: jest.fn() }),
}));

import { AuthProvider } from '../../lib/auth/AuthProvider';
import { useAuthGate } from '../../lib/auth/useAuthGate';
import TavernShell from '../../components/TavernShell';

const b64 = (s: string) => btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (exp: number) => `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify({ sub: '1', exp }))}.sig`;
const USER = { id: 1, username: 'alice', email: null, roles: [] };

function Dashboard() {
  const gate = useAuthGate({ skeleton: <div>skeleton</div>, label: 'Loading' });
  if (gate) return <>{gate}</>;
  return (
    <TavernShell active="dashboard" title="Home">
      <div>dashboard body</div>
    </TavernShell>
  );
}

let finishLogout: () => void;

beforeEach(() => {
  mockTrace.length = 0;
  mockCache.clear();
  mockLocation = '/dashboard';
  mockLogoutDone = false;
  mockJar = { st_access: jwt(Math.floor(Date.now() / 1000) + 3600), st_refresh: 'opaque' };
  global.fetch = jest.fn((path: string, init?: RequestInit) => {
    if (path !== '/api/auth/logout') return Promise.reject(new Error(`unexpected fetch ${path}`));
    return new Promise<Response>((resolve, reject) => {
      // Like a real fetch: an aborted signal rejects the call (and no Set-Cookie ever lands).
      init?.signal?.addEventListener('abort', () => reject(init?.signal?.reason ?? new DOMException('aborted', 'AbortError')));
      finishLogout = () => {
        mockJar = {}; // the BFF's Set-Cookie: expired
        mockLogoutDone = true;
        resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      };
    });
  }) as unknown as typeof fetch;
});

async function signOut() {
  render(
    <AuthProvider initialUser={USER}>
      <Dashboard />
    </AuthProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }));
}

describe('sign out with a slow logout response', () => {
  it('ends on /login, and nothing navigates before the cookies are cleared', async () => {
    await signOut();

    // The user is gone locally, the BFF has not answered: the gate must not have redirected.
    await waitFor(() => expect(screen.queryByText('dashboard body')).not.toBeInTheDocument());
    expect(mockTrace).toEqual([]);

    await act(async () => { finishLogout(); });

    await waitFor(() => expect(mockTrace).toHaveLength(1));
    expect(mockTrace[0].atLogoutDone).toBe(true);
    expect(mockTrace[0].url).toBe('/login?reauth=1'); // answered: no unconfirmed marker
    expect(mockLocation).toMatch(/^\/login/);
  });

  it('still ends on /login when the logout call never answers (client timeout)', async () => {
    jest.useFakeTimers();
    try {
      await signOut();
      await act(async () => { await jest.advanceTimersByTimeAsync(5_001); });
      // Cookies were NOT cleared (no response) — the shell still has to leave the dashboard.
      expect(mockLocation).toMatch(/^\/login/);
      expect(mockLocation).not.toBe('/dashboard');
      // The request never answered: exactly one navigation, carrying the unconfirmed marker.
      expect(mockTrace.map((x) => x.url)).toEqual(['/login?reauth=1&signout=unconfirmed']);
    } finally {
      jest.useRealTimers();
    }
  });
});

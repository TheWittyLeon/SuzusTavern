/**
 * @jest-environment <rootDir>/src/test-utils/jsdom-with-fetch-env.js
 *
 * HUNT1020-20 — after a sign-out whose request FAILED (cookies still live), browser Back restores a
 * protected page; the gate must send the user to the login form, not into a /login -> /dashboard loop.
 */
// HUNT1020-20 — same browser model as src/__tests__/lib/logout-flow.test.tsx
// (real AuthProvider, useAuthGate, TavernShell, proxy.ts; router.replace asks the real proxy and
// caches the landed URL per requested URL, as observed on dev 2026-10-20).
import React, { useSyncExternalStore } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextRequest } from 'next/server';

const mockTrace: { url: string; landed: string }[] = [];
let mockLocation = '/dashboard';
const listeners = new Set<() => void>();
const setLoc = (l: string) => { mockLocation = l; listeners.forEach((f) => f()); };
const mockCache = new Map<string, string>();
let mockJar: Record<string, string> = {};

jest.mock('next/navigation', () => ({
  // Reactive like the real hook (context-driven): the provider re-renders on navigation.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  usePathname: () => require('react').useSyncExternalStore((f: () => void) => { listeners.add(f); return () => listeners.delete(f); }, () => mockLocation).split('?')[0],
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
      mockTrace.push({ url, landed });
      setLoc(landed);
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

function Gated({ name }: { name: string }) {
  const gate = useAuthGate({ skeleton: <div>skeleton</div>, label: 'Loading' });
  if (gate) return <>{gate}</>;
  return <TavernShell active="dashboard" title="Home"><div>{name} body</div></TavernShell>;
}
function App() {
  const loc = useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => mockLocation);
  const path = loc.split('?')[0];
  if (path === '/login') return <div>login page</div>;
  return <Gated key={path} name={path} />;
}

beforeEach(() => {
  mockTrace.length = 0; mockCache.clear(); mockLocation = '/lobby';
  mockJar = { st_access: jwt(Math.floor(Date.now() / 1000) + 600), st_refresh: 'opaque' };
  // The logout request never reaches the BFF (network drop): cookies stay live.
  global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
});

it('unconfirmed sign-out, then browser Back to a protected page: lands on the login form, not a skeleton', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  render(<AuthProvider initialUser={USER}><App /></AuthProvider>);
  fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }));
  await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument());
  expect(mockTrace.map((t) => t.url)).toEqual(['/login?reauth=1&signout=unconfirmed']);

  // Browser Back: the App Router restores /lobby client-side (no proxy round trip).
  await act(async () => { setLoc('/lobby'); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

  expect(mockLocation.split('?')[0]).toBe('/login');
  expect(screen.getByText('login page')).toBeInTheDocument();
  expect(screen.queryByText('skeleton')).not.toBeInTheDocument();
  // The gate's redirect carried the reauth marker (a bare /login would have been 307'd to /dashboard).
  expect(mockTrace[mockTrace.length - 1].url).toBe('/login?reauth=1');
});

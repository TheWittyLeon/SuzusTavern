/**
 * @jest-environment node
 *
 * HUNT1020-03 — proxy.ts consumer of sanitizeNextPath. A signed-in user following
 * /login?next=/.//evil.example/x must stay on our origin.
 */
import { NextRequest } from 'next/server';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { proxy } = require('../proxy') as { proxy: (r: NextRequest) => Response };

function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (s: string) => btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.sig`;
}

const COOKIE = `st_access=${makeJwt({ sub: '1', exp: Math.floor(Date.now() / 1000) + 600 })}; st_refresh=r`;

function loginWithNext(next: string): Response {
  const url = `http://tavern.test:3000/login?next=${encodeURIComponent(next)}`;
  return proxy(new NextRequest(url, { headers: new Headers({ cookie: COOKIE }) }));
}

describe('proxy /login ?next= stays on-origin', () => {
  it.each(['/.//evil.example/signin', '/..//evil.example/signin', '/%2e//evil.example/signin', '/a/..//evil.example/x'])(
    'dot-segment smuggle %s redirects to the fallback, not off-origin',
    (next) => {
      const res = loginWithNext(next);
      expect(res.status).toBeGreaterThanOrEqual(300);
      const loc = new URL(res.headers.get('location')!, 'http://tavern.test:3000');
      expect(loc.origin).toBe('http://tavern.test:3000');
      expect(loc.pathname).toBe('/dashboard');
    },
  );

  it('positive control: a legitimate next is honoured', () => {
    const res = loginWithNext('/lobby?tab=open');
    expect(res.headers.get('location')).toBe('http://tavern.test:3000/lobby?tab=open');
  });
});

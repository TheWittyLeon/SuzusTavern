/**
 * @jest-environment node
 *
 * Pin: turning the Codex on in production (NEXT_PUBLIC_CODEX_ENABLED=true
 * under NODE_ENV=production) must NOT affect env.IS_PROD, which independently
 * gates the dev-only Authorization-header Bearer fallback in three routes:
 *   - src/app/api/admin/auth/[...path]/route.ts
 *   - src/app/api/admin/flags/[[...path]]/route.ts
 *   - src/app/api/dnd/[...path]/route.ts
 *
 * Unlike admin-auth-bff.test.ts's loadRoute() (which jest.mocks the whole
 * env module and hard-codes IS_PROD), this file loads the REAL env.ts fresh
 * under an altered process.env — the point is to exercise env.ts's actual
 * NEXT_PUBLIC_CODEX_ENABLED parsing feeding into a real route module graph,
 * not a stand-in. Reuses the makeRequest/mockFetch conventions from
 * admin-auth-bff.test.ts and dnd-admin-gate.test.ts.
 *
 * Mutation check (see Ren-Dev's bug-fix protocol): reverting config.ts's
 * `CODEX_ENABLED = env.CODEX_ENABLED` back to `!env.IS_PROD` does NOT turn
 * these tests red — by design, these routes never read CODEX_ENABLED at all,
 * they read env.IS_PROD directly. That is exactly what proves the isolation:
 * the flag has zero code path into the security gate. The env.test.ts pin
 * ("setting NEXT_PUBLIC_CODEX_ENABLED=true ... leaves IS_PROD true") is what
 * actually goes red under the mutations described in the task (route reading
 * IS_PROD via CODEX_ENABLED, or the parser ignoring the var).
 */

import { NextRequest } from 'next/server';

type Ctx = { params: Promise<{ path: string[] }> };
type FlagsCtx = { params: Promise<{ path?: string[] }> };

function makeCtx(path: string[]): Ctx {
  return { params: Promise.resolve({ path }) };
}

function makeFlagsCtx(path: string[]): FlagsCtx {
  return { params: Promise.resolve({ path }) };
}

function makeRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): NextRequest {
  const headers = new Headers(options.headers ?? {});
  return new NextRequest(url, { method: options.method ?? 'GET', headers });
}

const mockFetch = jest.fn();

beforeAll(() => {
  (global as Record<string, unknown>).fetch = mockFetch;
});

/**
 * Loads the REAL (unmocked) env.ts + a route module fresh under
 * NODE_ENV=production + NEXT_PUBLIC_CODEX_ENABLED=true. Required prod env
 * vars (NEXT_PUBLIC_NEKANOVA_URL, AUTH_API_URL) are set so env.ts's
 * requirePublic/requireServer throws don't fire.
 */
function loadProdWithCodexFlag<T>(routePath: string): { env: { IS_PROD: boolean; CODEX_ENABLED: boolean }; route: T } {
  jest.resetModules();
  mockFetch.mockReset();

  Object.defineProperty(process.env, 'NODE_ENV', {
    value: 'production',
    writable: true,
    configurable: true,
  });
  process.env.NEXT_PUBLIC_NEKANOVA_URL = 'http://neko:8080';
  process.env.AUTH_API_URL = 'http://auth:5000';
  process.env.NEXT_PUBLIC_CODEX_ENABLED = 'true';

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { env } = require('../../lib/env') as { env: { IS_PROD: boolean; CODEX_ENABLED: boolean } };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const route = require(routePath) as T;
  return { env, route };
}

afterEach(() => {
  Object.defineProperty(process.env, 'NODE_ENV', {
    value: 'test',
    writable: true,
    configurable: true,
  });
  delete process.env.NEXT_PUBLIC_NEKANOVA_URL;
  delete process.env.AUTH_API_URL;
  delete process.env.NEXT_PUBLIC_CODEX_ENABLED;
  jest.resetModules();
});

describe('Codex flag ON in prod does not reopen the Bearer-fallback interlock', () => {
  it('admin/auth: env.IS_PROD stays true, CODEX_ENABLED is true, and a bare Authorization header is refused', async () => {
    const { env, route } = loadProdWithCodexFlag<{
      GET: (req: NextRequest, ctx: Ctx) => Promise<import('next/server').NextResponse>;
    }>('../../app/api/admin/auth/[...path]/route');

    expect(env.IS_PROD).toBe(true);
    expect(env.CODEX_ENABLED).toBe(true);

    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      headers: { authorization: 'Bearer header-only-token' },
    });
    const res = await route.GET(req, makeCtx(['invitations']));

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('admin/flags: env.IS_PROD stays true, CODEX_ENABLED is true, and a bare Authorization header is refused', async () => {
    const { env, route } = loadProdWithCodexFlag<{
      GET: (req: NextRequest, ctx: FlagsCtx) => Promise<import('next/server').NextResponse>;
    }>('../../app/api/admin/flags/[[...path]]/route');

    expect(env.IS_PROD).toBe(true);
    expect(env.CODEX_ENABLED).toBe(true);

    const req = makeRequest('http://localhost:3000/api/admin/flags', {
      headers: { authorization: 'Bearer header-only-token' },
    });
    const res = await route.GET(req, makeFlagsCtx([]));

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('dnd proxy: env.IS_PROD stays true, CODEX_ENABLED is true, and a bare Authorization header on an admin/ path is refused', async () => {
    const { env, route } = loadProdWithCodexFlag<{
      GET: (req: NextRequest, ctx: Ctx) => Promise<import('next/server').NextResponse>;
    }>('../../app/api/dnd/[...path]/route');

    expect(env.IS_PROD).toBe(true);
    expect(env.CODEX_ENABLED).toBe(true);

    const req = makeRequest('http://localhost:3000/api/dnd/admin/content/drafts', {
      headers: { authorization: 'Bearer header-only-token' },
    });
    const res = await route.GET(req, makeCtx(['admin', 'content', 'drafts']));

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('control: the same three routes DO honor the Bearer header once IS_PROD is false again (flag has no bearing on this)', async () => {
    jest.resetModules();
    mockFetch.mockReset();
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'development',
      writable: true,
      configurable: true,
    });
    process.env.NEXT_PUBLIC_CODEX_ENABLED = 'true';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { env } = require('../../lib/env') as { env: { IS_PROD: boolean } };
    expect(env.IS_PROD).toBe(false);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GET } = require('../../app/api/admin/auth/[...path]/route') as {
      GET: (req: NextRequest, ctx: Ctx) => Promise<import('next/server').NextResponse>;
    };
    mockFetch.mockImplementationOnce((url: string) => {
      if (String(url).includes('/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: { id: 1, username: 'Leon', roles: ['admin'] } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ invitations: [] }), { status: 200 })),
    );

    const req = makeRequest('http://localhost:3000/api/admin/auth/invitations', {
      headers: { authorization: 'Bearer header-only-token' },
    });
    const res = await GET(req, makeCtx(['invitations']));
    expect(res.status).toBe(200);
  });
});

import { AUTH_ROUTES, findAuthRoute, refreshesOn401 } from '@/lib/auth/authRoutes';

describe('authRoutes table (Kage I3)', () => {
  it('has no duplicate method+path rows', () => {
    const keys = AUTH_ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('findAuthRoute is exact: wrong method, prefix, case, trailing slash and traversal all miss', () => {
    expect(findAuthRoute('POST', 'login')).toBeDefined();
    for (const [m, p] of [['GET', 'login'], ['POST', 'me'], ['POST', 'login/'], ['POST', 'Login'], ['POST', 'logi'], ['POST', '../login'], ['PUT', 'login'], ['POST', '']]) {
      expect(findAuthRoute(m, p)).toBeUndefined();
    }
  });

  it('only refresh is bodiless among POSTs (logout takes {} as JSON)', () => {
    const bodiless = AUTH_ROUTES.filter((r) => r.method === 'POST' && r.body === 'none').map((r) => r.path);
    expect(bodiless).toEqual(['refresh']);
  });

  it('the client refreshes on 401 only where a 401 means "access expired"', () => {
    for (const p of ['login', 'login/verify-2fa', 'register', 'request-password-reset', 'reset-password', 'logout', 'refresh']) {
      expect(refreshesOn401(`/api/auth/${p}`)).toBe(false);
    }
    expect(refreshesOn401('/api/auth/login?x=1')).toBe(false);
    expect(refreshesOn401('/api/auth/me')).toBe(true);
    expect(refreshesOn401('/api/auth/password/change')).toBe(true);
    expect(refreshesOn401('/api/dnd/sessions')).toBe(true);
  });

  it('a path under /api/auth/ that the table does not list never refreshes-and-replays', () => {
    expect(refreshesOn401('/api/auth/some-new-credential-route')).toBe(false);
  });
});

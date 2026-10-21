/**
 * @jest-environment node
 */
import { createMeCache } from '../../lib/auth/meCache';

jest.mock('server-only', () => ({}));

const user = (id: number) => ({ id, username: `u${id}`, email: null }) as never;

describe('createMeCache (HUNT1020-05)', () => {
  it('returns the user stored for exactly that token, and nobody else', () => {
    const c = createMeCache();
    c.set('token-A', user(1));
    c.set('token-B', user(2));
    expect(c.get('token-A')).toMatchObject({ id: 1 });
    expect(c.get('token-B')).toMatchObject({ id: 2 });
    expect(c.get('token-C')).toBeNull();
    // near-miss tokens (prefix, suffix, case) never collide
    for (const t of ['token-', 'token-AA', 'token-a', ' token-A', 'token-A ']) expect(c.get(t)).toBeNull();
  });

  it('keys by a hash: the raw token is never used as a Map key', () => {
    const spy = jest.spyOn(Map.prototype, 'set');
    const c = createMeCache();
    c.set('super-secret-bearer', user(1));
    const keys = spy.mock.calls.map((a) => String(a[0]));
    spy.mockRestore();
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).not.toContain('super-secret-bearer');
      expect(k).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('expires after the ttl', () => {
    let t = 1_000_000;
    const c = createMeCache({ ttlMs: 60_000, now: () => t });
    c.set('tok', user(1));
    t += 59_999;
    expect(c.get('tok')).not.toBeNull();
    t += 2;
    expect(c.get('tok')).toBeNull();
    expect(c.size).toBe(0);
  });

  it('never outlives the access token own exp', () => {
    let t = 1_000_000_000_000;
    const c = createMeCache({ ttlMs: 60_000, now: () => t });
    c.set('tok', user(1), t / 1000 + 10); // token dies in 10 s
    t += 9_000;
    expect(c.get('tok')).not.toBeNull();
    t += 2_000;
    expect(c.get('tok')).toBeNull();
    // already-expired token is not stored at all
    c.set('dead', user(2), t / 1000 - 1);
    expect(c.size).toBe(0);
  });

  it('evict removes only that token', () => {
    const c = createMeCache();
    c.set('a', user(1));
    c.set('b', user(2));
    c.evict('a');
    c.evict(null);
    c.evict(undefined);
    expect(c.get('a')).toBeNull();
    expect(c.get('b')).not.toBeNull();
  });

  it('is a bounded LRU: oldest untouched entry goes first, a hit refreshes recency', () => {
    const c = createMeCache({ max: 3 });
    c.set('a', user(1));
    c.set('b', user(2));
    c.set('c', user(3));
    c.get('a'); // a is now most recent; b is the LRU
    c.set('d', user(4));
    expect(c.size).toBe(3);
    expect(c.get('b')).toBeNull();
    expect(c.get('a')).not.toBeNull();
    expect(c.get('c')).not.toBeNull();
    expect(c.get('d')).not.toBeNull();
  });

  it('ignores empty tokens and non-object users', () => {
    const c = createMeCache();
    c.set('', user(1));
    c.set('t', null as never);
    expect(c.size).toBe(0);
    expect(c.get('')).toBeNull();
  });
});

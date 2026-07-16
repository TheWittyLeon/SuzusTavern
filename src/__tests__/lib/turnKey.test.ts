/**
 * DDX-20 — turn_key lifecycle (src/lib/turnKey.ts).
 * Client Integration Design §4c: set on turn start -> clear on completion ->
 * clear + mint NEW on retry-after-failed. localStorage is a belt, not the
 * mechanism — a storage failure must never throw.
 */
import { mintTurnKey, saveTurnKey, readTurnKey, clearTurnKey } from '../../lib/turnKey';

describe('mintTurnKey', () => {
  it('returns a UUID v4', () => {
    const key = mintTurnKey();
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('two mints never collide', () => {
    expect(mintTurnKey()).not.toBe(mintTurnKey());
  });

  it('delegates to crypto.randomUUID when it is available (native path)', () => {
    const nativeValue = '11111111-1111-4111-8111-111111111111';
    const spy = jest.spyOn(crypto, 'randomUUID').mockReturnValue(nativeValue);
    expect(mintTurnKey()).toBe(nativeValue);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  describe('F11 regression lock — insecure context (crypto.randomUUID undefined)', () => {
    // crypto.randomUUID() is secure-context-only: it is undefined over plain
    // HTTP to a non-localhost host. The Tavern's prod deployment IS plain
    // HTTP on the LAN, so this path must never throw and must always
    // produce a spec-correct UUIDv4 via the getRandomValues fallback.
    let originalRandomUUID: typeof crypto.randomUUID;

    beforeEach(() => {
      originalRandomUUID = crypto.randomUUID;
      // Simulate an insecure context where the browser never defines this
      // method at all. `randomUUID` lives on the Crypto prototype in
      // Node/jsdom, so a plain `delete` on the instance is a no-op — assign
      // an own property shadowing it with `undefined` instead.
      (crypto as { randomUUID?: unknown }).randomUUID = undefined;
    });

    afterEach(() => {
      crypto.randomUUID = originalRandomUUID;
    });

    it('still returns a valid UUIDv4 and does not throw', () => {
      expect(typeof crypto.randomUUID).toBe('undefined');
      let key = '';
      expect(() => {
        key = mintTurnKey();
      }).not.toThrow();
      expect(key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('two successive fallback mints differ', () => {
      expect(mintTurnKey()).not.toBe(mintTurnKey());
    });
  });
});

describe('save/read/clear round-trip', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('saveTurnKey then readTurnKey returns the same value', () => {
    saveTurnKey('sess-1', 'tk-abc');
    expect(readTurnKey('sess-1')).toBe('tk-abc');
  });

  it('readTurnKey returns null when nothing has been saved', () => {
    expect(readTurnKey('sess-never-saved')).toBeNull();
  });

  it('is scoped per session_id — two sessions never collide', () => {
    saveTurnKey('sess-a', 'tk-a');
    saveTurnKey('sess-b', 'tk-b');
    expect(readTurnKey('sess-a')).toBe('tk-a');
    expect(readTurnKey('sess-b')).toBe('tk-b');
  });

  it('clearTurnKey removes the key — readTurnKey then returns null', () => {
    saveTurnKey('sess-1', 'tk-abc');
    clearTurnKey('sess-1');
    expect(readTurnKey('sess-1')).toBeNull();
  });

  it('retry-after-failed: clear then mint produces a DIFFERENT key from the failed one', () => {
    saveTurnKey('sess-1', 'tk-failed');
    clearTurnKey('sess-1');
    const retryKey = mintTurnKey();
    expect(retryKey).not.toBe('tk-failed');
    saveTurnKey('sess-1', retryKey);
    expect(readTurnKey('sess-1')).toBe(retryKey);
  });

  it('a fresh saveTurnKey call overwrites a previously persisted key for the same session', () => {
    saveTurnKey('sess-1', 'tk-old');
    saveTurnKey('sess-1', 'tk-new');
    expect(readTurnKey('sess-1')).toBe('tk-new');
  });
});

describe('storage-unavailable resilience (belt, not the mechanism)', () => {
  it('saveTurnKey swallows a localStorage.setItem failure — never throws', () => {
    const spy = jest.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => saveTurnKey('sess-1', 'tk-x')).not.toThrow();
    spy.mockRestore();
  });

  it('readTurnKey returns null (not throw) when localStorage.getItem fails', () => {
    const spy = jest.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(readTurnKey('sess-1')).toBeNull();
    spy.mockRestore();
  });

  it('clearTurnKey swallows a localStorage.removeItem failure — never throws', () => {
    const spy = jest.spyOn(window.localStorage.__proto__, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(() => clearTurnKey('sess-1')).not.toThrow();
    spy.mockRestore();
  });
});

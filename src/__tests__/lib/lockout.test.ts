import { lockedMessage } from '@/lib/auth/lockout';

const NOW = Date.parse('2026-10-20T22:30:00Z');

// The naive-UTC reading must not depend on the machine's zone: pin one that is NOT UTC, so reading the
// string as local time (mutant L1: dropping the appended 'Z') changes the answer on any host.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'Asia/Tokyo'; });
afterAll(() => { if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ; });

describe('lockedMessage (HUNT1020-04)', () => {
  it('reads a naive upstream timestamp as UTC, not browser-local', () => {
    // Auth-Python sends datetime.utcnow().isoformat(): no offset.
    expect(lockedMessage('2026-10-20T23:00:00', NOW)).toMatch(/about 30 minutes/);
  });

  it('takes upstream\'s real shape: Python isoformat() with microseconds and no offset', () => {
    expect(lockedMessage('2026-10-20T22:59:30.123456', NOW)).toMatch(/about 30 minutes/);
    expect(lockedMessage('2026-10-20T22:59:59.999999', NOW)).toMatch(/about 30 minutes/);
  });

  it('honours an explicit offset', () => {
    expect(lockedMessage('2026-10-20T23:00:00Z', NOW)).toMatch(/about 30 minutes/);
    expect(lockedMessage('2026-10-21T00:00:00+01:00', NOW)).toMatch(/about 30 minutes/);
  });

  it('singular minute, rounds up', () => {
    expect(lockedMessage('2026-10-20T22:30:20', NOW)).toMatch(/about 1 minute\./);
  });

  it.each([undefined, null, '', 'soon', 42, {}, '2026-10-20T22:00:00', '2030-01-01T00:00:00'])(
    'falls back to honest generic copy for %p (missing, junk, past or absurd)',
    (v) => {
      const msg = lockedMessage(v, NOW);
      expect(msg).toMatch(/locked/);
      expect(msg).toMatch(/little while/);
      expect(msg).not.toMatch(/connection|reach the tavern/i);
    },
  );
});

/**
 * A9d-2 fix round 3 -- `drivesMonsterTurns` against the wire the engine actually sends (Miko's real-wire case, 2026-10-02, now an
 * ordinary test).
 *
 * On the msm path (the production path) `participant_usernames` leaves the DM out, and `GET /participants` lists `dm_username` first and
 * unconditionally, so the Tavern cannot tell a seated pure DM from a table whose DM account is nobody at it. An admin fallback therefore
 * elected every admin's tab beside the DM at any ordinary table (several drivers: the state the DM gate exists to end). The election is
 * the DM's tab and nothing else; an admin who is not the DM does not drive.
 */
import { drivesMonsterTurns } from '@/app/play/[sessionId]/format';
import type { Session } from '@/lib/api/types';

const session = (over: Partial<Session>): Session => ({ session_id: 's1', status: 'active', dm_username: 'GM', ...over }) as Session;

describe('drivesMonsterTurns: the controls', () => {
  it('the DM drives, in either case', () => {
    expect(drivesMonsterTurns(session({}), 'gm')).toBe(true);
    expect(drivesMonsterTurns(session({ dm_username: 'GM' }), 'GM')).toBe(true);
  });
  it('a plain player never drives', () => {
    expect(drivesMonsterTurns(session({ participant_usernames: ['kes'] }), 'kes')).toBe(false);
  });
});

describe('drivesMonsterTurns: the msm wire (the DM is NOT in participant_usernames)', () => {
  it('an admin who is not the DM does NOT drive, whoever is seated; the DM does', () => {
    // exactly what the msm path sends: members with role != 'dm'; the DM, 'GM', is at the table (and is the roster's first entry) but not listed
    const s = session({ dm_username: 'GM', participant_usernames: ['kes', 'sable'] });
    expect(drivesMonsterTurns(s, 'GM')).toBe(true); // the DM's tab drives ...
    expect(drivesMonsterTurns(s, 'Leon')).toBe(false); // ... and the admin visitor's does not
  });
});

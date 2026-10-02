/**
 * A9d-2 fix round QA (Miko, 2026-10-02) -- `drivesMonsterTurns` against the wire the engine actually sends.
 *
 * The N2 admin fallback says an admin's tab drives "when, and only when, `dm_username` is not among the participants" (format.ts), and its
 * cases (`play.monster-turn-driver.test`) seat the DM in `session.participant_usernames`. The engine does not send it that way on the msm
 * path, which is the production path (`msm.campaigns` is the live table): `sessions_msm._campaign_to_session` builds
 * `participant_usernames = [m["username"] for m in members if m.get("role") != "dm"]`, and `tests/test_sessions_msm.py` pins
 * "participant_usernames == []  # dm is not a participant". So `seated` is false at EVERY msm table whose DM is a pure DM, the fallback
 * fires for every admin tab, and an admin visiting someone else's AI-auto table drives monsters alongside the DM (two tabs POSTing
 * /monster-turn; the engine's `guard_dm` admits both). That is the several-drivers-per-table state the DM gate was written to end.
 * The roster the page already holds (`GET /participants`, `_participants_with_bound_characters`) DOES list `dm_username` first.
 *
 * `it.failing` documents the defect and stays green while it exists: when Ren-Dev fixes `seated` to read the roster (or any source that
 * carries the DM), this case turns RED with "expected to fail", which is the cue to delete the `.failing` and keep the case.
 * The controls below are green today and must stay green.
 */
import { drivesMonsterTurns } from '@/app/play/[sessionId]/format';
import type { Session } from '@/lib/api/types';

const session = (over: Partial<Session>): Session => ({ session_id: 's1', status: 'active', dm_username: 'GM', ...over }) as Session;

describe('drivesMonsterTurns: the controls', () => {
  it('the DM drives, in either case', () => {
    expect(drivesMonsterTurns(session({}), 'gm', [])).toBe(true);
    expect(drivesMonsterTurns(session({ dm_username: 'GM' }), 'GM', undefined)).toBe(true);
  });
  it('a plain player never drives', () => {
    expect(drivesMonsterTurns(session({ participant_usernames: ['kes'] }), 'kes', [])).toBe(false);
  });
  it('a Twitch-created table (dm_username is a broadcaster login nobody at the table has): an admin drives', () => {
    expect(drivesMonsterTurns(session({ dm_username: 'thewittyleon', participant_usernames: ['kes'] }), 'Leon', ['admin'])).toBe(true);
  });
});

describe('drivesMonsterTurns: the msm wire (the DM is NOT in participant_usernames)', () => {
  it.failing('an admin at a table whose DM is seated and a different person does NOT drive (the DM does)', () => {
    // exactly what the msm path sends: members with role != 'dm'; the DM, 'GM', is at the table (and is the roster's first entry) but not listed
    const s = session({ dm_username: 'GM', participant_usernames: ['kes', 'sable'] });
    expect(drivesMonsterTurns(s, 'GM', [])).toBe(true); // the DM's tab drives ...
    expect(drivesMonsterTurns(s, 'Leon', ['admin'])).toBe(false); // ... and the admin visitor's does not (it does today: `seated` is false)
  });
});

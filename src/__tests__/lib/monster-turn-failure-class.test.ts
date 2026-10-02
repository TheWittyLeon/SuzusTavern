/**
 * A9d-2 N2 (Kage I-1, I-2, S3) — the monster-turn failure class and the driver election, as pure functions.
 * The page-level cases (POST counts, the line in the action bar) are in play.monster-turn-driver.test.tsx.
 */
import { COMBAT_REFUSAL_REASON_MAP, MONSTER_TURN_REASON_CLASS, monsterTurnFailureClass } from '@/lib/dnd/engineReasons';
import { drivesMonsterTurns, isSessionDm } from '@/app/play/[sessionId]/format';
import type { Session } from '@/lib/api/types';

describe('monsterTurnFailureClass: decided by the class table, never by membership of the player-facing copy map', () => {
  it('the stale reasons are exactly the ones that mean "this is not the monster\'s turn any more"', () => {
    const stale = Object.entries(MONSTER_TURN_REASON_CLASS).filter(([, c]) => c === 'stale').map(([r]) => r).sort();
    expect(stale).toEqual(['combat_over', 'no_active_turn', 'no_combat', 'not_a_monsters_turn', 'not_found']);
  });

  it('every listed reason has copy (the table is a class of reasons the vocabulary knows), and the faults are the engine\'s own', () => {
    for (const reason of Object.keys(MONSTER_TURN_REASON_CLASS)) expect(COMBAT_REFUSAL_REASON_MAP[reason]).toBeTruthy();
    expect(MONSTER_TURN_REASON_CLASS.monster_statblock_unresolved).toBe('fault');
    expect(MONSTER_TURN_REASON_CLASS.db_unavailable).toBe('fault');
    expect(MONSTER_TURN_REASON_CLASS.error).toBe('fault');
  });

  it('a curated reason with NO row is a fault (retried and said), not a terminal refusal: this is what copy-map membership got wrong', () => {
    expect(COMBAT_REFUSAL_REASON_MAP.target_down).toBeTruthy();
    expect(MONSTER_TURN_REASON_CLASS.target_down).toBeUndefined();
    expect(monsterTurnFailureClass(400, 'target_down')).toBe('fault');
    expect(monsterTurnFailureClass(400, 'not_your_turn')).toBe('fault');
  });

  it('an unknown reason and no reason at all are faults; an HTTP 404 is stale whatever the body says', () => {
    expect(monsterTurnFailureClass(500, 'a_reason_the_engine_adds_next_year')).toBe('fault');
    expect(monsterTurnFailureClass(500, undefined)).toBe('fault');
    expect(monsterTurnFailureClass(503, undefined)).toBe('fault');
    expect(monsterTurnFailureClass(0, undefined)).toBe('fault');
    expect(monsterTurnFailureClass(404, undefined)).toBe('stale');
    expect(monsterTurnFailureClass(404, 'db_unavailable')).toBe('stale');
    expect(monsterTurnFailureClass(400, 'not_a_monsters_turn')).toBe('stale');
    expect(monsterTurnFailureClass(undefined, 'combat_over')).toBe('stale');
  });
});

const session = (dm: string | null, participants: string[]): Session => ({
  session_id: 's1', channel: 'c', status: 'active', dm_username: dm as string, participant_usernames: participants, player_count: participants.length,
  active_combat_id: 'combat-1', dm_mode: 'ai', visibility: 'public', content_rating: 'sfw',
});

describe('isSessionDm: one case-insensitive definition (Kage S3)', () => {
  it('matches in either case; a missing side is not the DM', () => {
    expect(isSessionDm(session('Alice', []), 'alice')).toBe(true);
    expect(isSessionDm(session('alice', []), 'ALICE')).toBe(true);
    expect(isSessionDm(session('alice', []), 'bob')).toBe(false);
    expect(isSessionDm(session(null, []), 'alice')).toBe(false);
    expect(isSessionDm(session('alice', []), null)).toBe(false);
    expect(isSessionDm(null, 'alice')).toBe(false);
  });
});

describe('drivesMonsterTurns: the DM drives; an admin drives only when dm_username is not a participant', () => {
  const rows: Array<[string, Session, string | null, string[] | undefined, boolean]> = [
    ['the DM, any case', session('Alice', ['alice']), 'alice', undefined, true],
    ['the DM who is not listed as a participant', session('alice', []), 'alice', undefined, true],
    ['a player at a seated-DM table', session('bob', ['alice', 'bob']), 'alice', undefined, false],
    ['an admin at a seated-DM table (the fallback never applies)', session('bob', ['alice', 'bob']), 'alice', ['admin'], false],
    ['an admin, DM seated in another case', session('Bob', ['alice', 'bob']), 'alice', ['admin'], false],
    ['an admin at a Twitch-created table (dm_username not at it)', session('thewittyleon', ['alice']), 'alice', ['admin'], true],
    ['an admin at a `suzu` table', session('suzu', ['alice']), 'alice', ['user', 'admin'], true],
    ['a non-admin at a table whose DM is nobody at it', session('thewittyleon', ['alice']), 'alice', ['user'], false],
    ['a viewer with no roles', session('thewittyleon', ['alice']), 'alice', undefined, false],
    ['an admin with no username yet', session('thewittyleon', ['alice']), null, ['admin'], false],
    ['no session', session('x', []), 'alice', ['admin'], false],
  ];
  it.each(rows)('%s -> %s', (name, s, user, roles, want) => {
    const sess = name === 'no session' ? null : s;
    expect(drivesMonsterTurns(sess, user, roles)).toBe(want);
  });
});

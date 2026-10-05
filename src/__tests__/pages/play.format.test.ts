/**
 * @jest-environment node
 *
 * TAV-PLAY-SHELL step 5 hook 4 (useScene) moved `isSessionLocked` and
 * `buildReadAloudBlock` from page.tsx into
 * `src/app/play/[sessionId]/format.ts` verbatim. Neither function had a
 * dedicated unit test before or after the move — both were only exercised
 * indirectly through the big `/play` page-level RTL suites (e.g.
 * play.ddx25-session-controls-adversarial.test.tsx for the lock gate,
 * play.opening.test.tsx for the read-aloud block). This file adds the
 * direct, fast, pure-function coverage the move makes cheap to add and
 * does not touch or rewrite any existing test (Miko-QA, TAV-PLAY-SHELL A1
 * QA pass).
 */
import { combatEndedLine, isSessionLocked, buildReadAloudBlock, areTurnsRunning, isFightEnded, isFightHeld, isFightLive } from '../../app/play/[sessionId]/format';
import type { CombatState, GroundingData, Session } from '../../lib/api/types';

function makeSession(status: Session['status']): Session {
  return {
    session_id: 'sess-format-1',
    status,
  } as Session;
}

function makeCombatState(state: CombatState['state']): CombatState {
  return {
    combat_id: 'combat-format-1',
    session_id: 'sess-format-1',
    round: 1,
    state,
    turn_index: 0,
    active_participant_id: null,
    initiative: [],
    participants: [],
  };
}

describe('isSessionLocked', () => {
  it('is false for an active session', () => {
    expect(isSessionLocked(makeSession('active'))).toBe(false);
  });

  it('is true for a paused session', () => {
    expect(isSessionLocked(makeSession('paused'))).toBe(true);
  });

  it('is true for an ended session', () => {
    expect(isSessionLocked(makeSession('ended'))).toBe(true);
  });

  it('is false for null/undefined (no session loaded yet)', () => {
    expect(isSessionLocked(null)).toBe(false);
    expect(isSessionLocked(undefined)).toBe(false);
  });
});

describe('the fight-state predicates (TPK-HOLD W1)', () => {
  // A2 commit 0 (Kage-CR A1b IMPORTANT-2, verbatim): "`isCombatEngaged` is
  // unpinned against the exact `combatIsActive` confusion it exists to
  // prevent ... zero fixtures for the three states the predicates disagree
  // on." One table over EVERY value of the closed type, plus a value the
  // closed type does not list (an engine newer than this build) and null:
  // swapping any predicate body for a neighbour's changes a row.
  //                      [state,                live,  running, held,  ended]
  it.each([
    ['idle',               true,  false,  false, false],
    ['rolling_initiative', true,  false,  false, false],
    ['active',             true,  true,   false, false],
    ['between_turns',      true,  false,  false, false],
    ['held',               true,  false,  true,  false],
    ['ended',              false, false,  false, true],
    // Fail closed: live and frozen, never "ended", never running, never held.
    ['a_state_from_a_newer_engine', true, false, false, false],
  ] as const)("combat state '%s' -> live %s, turns running %s, held %s, ended %s", (state, live, running, held, ended) => {
    const cs = makeCombatState(state as CombatState['state']);
    expect(isFightLive(cs)).toBe(live);
    expect(areTurnsRunning(cs)).toBe(running);
    expect(isFightHeld(cs)).toBe(held);
    expect(isFightEnded(cs)).toBe(ended);
  });

  it('answers false to all four for null / undefined (no fight loaded)', () => {
    for (const cs of [null, undefined]) {
      expect(isFightLive(cs)).toBe(false);
      expect(areTurnsRunning(cs)).toBe(false);
      expect(isFightHeld(cs)).toBe(false);
      expect(isFightEnded(cs)).toBe(false);
    }
  });
});

describe('buildReadAloudBlock', () => {
  it('assembles every present field in the authored order, blank-line-separated', () => {
    const g: GroundingData = {
      adventure_title: 'The Hollow Tide',
      hook: 'A bell tolls beneath the waves.',
      scene_name: 'The Drowned Bell',
      boxed_text: 'Salt air. The bell rings once more.',
      objective: 'Silence the bell before high tide.',
    };
    expect(buildReadAloudBlock(g)).toBe(
      [
        '— The Hollow Tide —',
        'A bell tolls beneath the waves.',
        '\nScene: The Drowned Bell',
        'Salt air. The bell rings once more.',
        '\nObjective: Silence the bell before high tide.',
      ].join('\n'),
    );
  });

  it('omits missing fields rather than leaving a blank line', () => {
    // Discriminates from the "everything present" fixture above with
    // distinct values, and specifically leaves out adventure_title AND
    // objective so the .filter(Boolean) drop of BOTH a leading and a
    // trailing optional field is exercised, not just one.
    const g: GroundingData = {
      scene_name: 'A Nameless Crossing',
      boxed_text: 'The bridge groans underfoot.',
    };
    expect(buildReadAloudBlock(g)).toBe(
      ['\nScene: A Nameless Crossing', 'The bridge groans underfoot.'].join('\n'),
    );
  });

  it('returns an empty string when grounding carries none of the block fields', () => {
    expect(buildReadAloudBlock({} as GroundingData)).toBe('');
  });
});

describe('combatEndedLine: one outcome -> sentence map, the key capitalised as the fallback, the engine\'s own message first', () => {
  it.each([
    ['tpk', 'Combat ended. The party has fallen.'],
    ['victory', 'Combat ended. Victory.'],
    ['retreat', 'Combat ended. Retreat.'],
    ['unresolved', 'Combat ended. Unresolved.'],
    ['noop', 'Combat had already ended.'],
    ['a_tenth_outcome', 'Combat ended. A_tenth_outcome.'],
  ])("outcome '%s' -> %s", (outcome, line) => {
    expect(combatEndedLine(outcome)).toBe(line);
  });
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])("an object-prototype key ('%s') is a key, not a sentence", (key) => {
    expect(combatEndedLine(key)).toBe(`Combat ended. ${key.charAt(0).toUpperCase()}${key.slice(1)}.`);
  });
  it('no outcome at all is Unresolved, as it always was', () => {
    expect(combatEndedLine(undefined)).toBe('Combat ended. Unresolved.');
    expect(combatEndedLine('')).toBe('Combat ended. Unresolved.');
  });
  it('the engine\'s message wins when it sent one, and a blank one does not', () => {
    expect(combatEndedLine('tpk', 'Combat ended. The party has fallen. (engine)')).toBe('Combat ended. The party has fallen. (engine)');
    expect(combatEndedLine('tpk', '   ')).toBe('Combat ended. The party has fallen.');
    expect(combatEndedLine('tpk', null)).toBe('Combat ended. The party has fallen.');
  });
});

describe('a state this build has never heard of is live and frozen, says so once, and an object-prototype key is not a state', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  afterAll(() => warn.mockRestore());
  const odd = (state: string) => makeCombatState(state as CombatState['state']);
  it('reaction_window: live, not running, not held, not ended', () => {
    const cs = odd('reaction_window');
    expect([isFightLive(cs), areTurnsRunning(cs), isFightHeld(cs), isFightEnded(cs)]).toEqual([true, false, false, false]);
  });
  it('the warning names the state and is said once per state', () => {
    warn.mockClear();
    const cs = odd('rising_tide');
    isFightLive(cs); areTurnsRunning(cs); isFightHeld(cs);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/rising_tide/);
  });
  it.each(['constructor', 'toString', '__proto__'])("'%s' is unknown (live, frozen), not a lookup that finds an Object member", (key) => {
    const cs = odd(key);
    expect([isFightLive(cs), areTurnsRunning(cs), isFightHeld(cs), isFightEnded(cs)]).toEqual([true, false, false, false]);
  });
  it('a fight not read yet (null) is none of the four', () => {
    expect([isFightLive(null), areTurnsRunning(null), isFightHeld(null), isFightEnded(null)]).toEqual([false, false, false, false]);
  });
});

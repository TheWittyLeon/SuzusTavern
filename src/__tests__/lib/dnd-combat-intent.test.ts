/**
 * TAV-COMBAT-VERB-NO-MECHANICS — matchCombatIntent / creatureKeywords.
 *
 * The matcher's ONLY job is to decide whether free text reads as the player
 * declaring a combat action. It executes nothing; the caller (play/page.tsx)
 * owns the "is there an unstarted authored combat encounter here?" gate and
 * the refuse-and-prompt behaviour.
 *
 * The asymmetry these tests defend:
 *   - a MISS costs what we have today (Suzu free-narrates a fake outcome) —
 *     bad, but no worse than the filed bug;
 *   - a FALSE POSITIVE refuses a legitimate roleplay turn, which is the only
 *     harm this feature can do to a player.
 * So the innocent-phrasing cases below are the load-bearing half of this file,
 * not filler. Every entry in COMBAT_VERBS_TARGETED exists because its verb has
 * a common non-combat sense — those senses are pinned here.
 */
import { creatureKeywords, matchCombatIntent } from '@/lib/dnd/intentFastPath';

/** The filed repro's scene: mlp-timberwolf-juvenile. */
const TIMBERWOLF = ['Timberwolf (juvenile)'];

describe('matchCombatIntent — tier 1 (unambiguous, no target needed)', () => {
  it('matches the filed repro verbatim', () => {
    // The exact sentence from the 2026-08-01 feel-check that produced a
    // fabricated hit-and-deflection with no roll, no damage, no combat row.
    expect(
      matchCombatIntent(
        'I stand my ground and attack the nearest timberwolf with Eldritch Blast',
        TIMBERWOLF,
      ),
    ).toBe(true);
  });

  it('matches bare attack declarations with no creature list at all', () => {
    expect(matchCombatIntent('I attack')).toBe(true);
    expect(matchCombatIntent('I attack it')).toBe(true);
    expect(matchCombatIntent("I'm attacking, right now")).toBe(true);
  });

  it('matches the unambiguous multi-word declarations', () => {
    expect(matchCombatIntent('I stand and fight')).toBe(true);
    expect(matchCombatIntent('I swing at the thing')).toBe(true);
    expect(matchCombatIntent('I lunge at it')).toBe(true);
    expect(matchCombatIntent('open fire')).toBe(true);
    expect(matchCombatIntent('I loose an arrow')).toBe(true);
    expect(matchCombatIntent('I shoot at whatever that is')).toBe(true);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(matchCombatIntent('ATTACK!')).toBe(true);
    expect(matchCombatIntent('  I Attack.  ')).toBe(true);
  });
});

describe('matchCombatIntent — the "attack" noun guard', () => {
  it('does NOT fire when "attack" is the noun, not the player\'s verb', () => {
    expect(matchCombatIntent('I brace for the attack')).toBe(false);
    expect(matchCombatIntent('her attack goes wide, I think')).toBe(false);
    expect(matchCombatIntent('that attack looked rehearsed')).toBe(false);
    expect(matchCombatIntent('I have no attack worth trying here')).toBe(false);
  });

  it('still fires when a clean occurrence follows a blocked one', () => {
    // The generalized scanner checks EVERY occurrence — an early noun use
    // must not mask a later verb use.
    expect(matchCombatIntent('I brace for the attack, then I attack')).toBe(true);
  });

  it('does not fire on "attack" inside another word', () => {
    expect(matchCombatIntent('the counterattacked ground is soft')).toBe(false);
  });
});

describe('matchCombatIntent — tier 2 (ambiguous verb, creature must be named)', () => {
  it('fires when an ambiguous verb names one of the scene\'s creatures', () => {
    expect(matchCombatIntent('I hit the timberwolf with my staff', TIMBERWOLF)).toBe(true);
    expect(matchCombatIntent('I cast fire bolt at the timberwolf', TIMBERWOLF)).toBe(true);
    expect(matchCombatIntent('I charge the timberwolf', TIMBERWOLF)).toBe(true);
    expect(matchCombatIntent('kill the goblin', ['Goblin'])).toBe(true);
    expect(matchCombatIntent('I fight the dire wolf', ['Dire Wolf'])).toBe(true);
  });

  it('does NOT fire on the same verb when no scene creature is named', () => {
    expect(matchCombatIntent('I hit the road', TIMBERWOLF)).toBe(false);
    expect(matchCombatIntent('I strike a match', TIMBERWOLF)).toBe(false);
    expect(matchCombatIntent('I shoot him a look', TIMBERWOLF)).toBe(false);
    expect(matchCombatIntent('I cut the rope', TIMBERWOLF)).toBe(false);
    expect(matchCombatIntent('I charge my staff with what I have left', TIMBERWOLF)).toBe(false);
    expect(matchCombatIntent('I cast light and keep walking', TIMBERWOLF)).toBe(false);
    expect(matchCombatIntent("I'd fight you if I had to", TIMBERWOLF)).toBe(false);
    expect(matchCombatIntent("they'll kill us if we stay", TIMBERWOLF)).toBe(false);
  });

  it('does NOT fire on a creature name with no combat verb', () => {
    expect(matchCombatIntent('I watch the timberwolf, and wait', TIMBERWOLF)).toBe(false);
    expect(matchCombatIntent('the timberwolf smells like wet bark', TIMBERWOLF)).toBe(false);
  });

  it('cannot fire on a creature that is not in THIS scene', () => {
    // Scope discipline mirrors matchKeywordIntent's: the matcher only ever
    // sees the current scene's own authored creatures.
    expect(matchCombatIntent('I hit the goblin', TIMBERWOLF)).toBe(false);
  });

  it('tolerates a missing/odd creature list without throwing', () => {
    expect(matchCombatIntent('I hit the timberwolf', [])).toBe(false);
    expect(matchCombatIntent('I hit the timberwolf', [undefined])).toBe(false);
    expect(matchCombatIntent('I hit the timberwolf')).toBe(false);
  });
});

describe('matchCombatIntent — non-combat play is never refused', () => {
  it.each([
    'I look around',
    'I ask Zecora what she meant by that',
    'This place feels creepy, honestly.',
    'I head deeper into the wood',
    'I keep moving',
    'I try to remember how I got here',
    'I hold very still and listen',
  ])('%s → no match', (text) => {
    expect(matchCombatIntent(text, TIMBERWOLF)).toBe(false);
  });

  it('empty / whitespace input never matches', () => {
    expect(matchCombatIntent('', TIMBERWOLF)).toBe(false);
    expect(matchCombatIntent('   ', TIMBERWOLF)).toBe(false);
  });
});

describe('creatureKeywords', () => {
  it('emits the full name and its significant words', () => {
    expect(creatureKeywords(['Timberwolf (juvenile)']).sort()).toEqual(
      ['juvenile', 'timberwolf', 'timberwolf juvenile'].sort(),
    );
  });

  it('keeps a multi-word name matchable as a phrase', () => {
    expect(creatureKeywords(['Dire Wolf'])).toContain('dire wolf');
  });

  it('drops generic words that identify nothing on their own', () => {
    const kws = creatureKeywords(['The Beast of the Hollow']);
    expect(kws).not.toContain('the');
    expect(kws).not.toContain('beast');
    expect(kws).toContain('hollow');
  });

  it('drops short fragments and dedupes across names', () => {
    const kws = creatureKeywords(['Goblin #1', 'Goblin #2', undefined, '', '  ']);
    expect(kws.filter((k) => k === 'goblin')).toHaveLength(1);
  });
});

/**
 * PLAY-PERSIST §6.3 — eventToLogRow mapping tests.
 *
 * Pure-function coverage: one test per kind in the mapping table, plus the
 * adversarial cases called out in the design doc's Miko checklist (§8):
 * empty/missing text is skipped (no blank row), narration missing `data.who`
 * falls back to 'Suzu', unknown/structural kinds are skipped, and opening_narrated
 * is never rendered as a plain row (the caller reconstructs it specially).
 */
import { eventToLogRow, decodeHtmlEntities } from '../../lib/rehydration';
import type { EngineSessionEvent } from '../../lib/api/types';

describe('eventToLogRow — kind mapping', () => {
  it('player_action -> player row (who/text/color from data)', () => {
    const e: EngineSessionEvent = {
      seq: 1,
      kind: 'player_action',
      actor: 'leon',
      data: { who: 'leon', text: 'I push open the door.', log_kind: 'player', mode: 'act' },
      created_at: '2026-07-01T10:00:00Z',
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({
      who: 'leon',
      kind: 'player',
      text: 'I push open the door.',
      color: 'var(--accent)',
    });
    expect(row?.id).toBe('ev1');
  });

  it('player_action falls back to actor when data.who is absent', () => {
    const e: EngineSessionEvent = {
      seq: 2,
      kind: 'player_action',
      actor: 'leon',
      data: { text: 'I look around.' },
    };
    const row = eventToLogRow(e);
    expect(row?.who).toBe('leon');
  });

  it('player_action with empty data.text is skipped (no blank row)', () => {
    const e: EngineSessionEvent = {
      seq: 3,
      kind: 'player_action',
      data: { who: 'leon', text: '' },
    };
    expect(eventToLogRow(e)).toBeNull();
  });

  it('player_action with missing data.text is skipped', () => {
    const e: EngineSessionEvent = { seq: 4, kind: 'player_action', data: { who: 'leon' } };
    expect(eventToLogRow(e)).toBeNull();
  });

  it('narration -> narration row, who defaults to Suzu', () => {
    const e: EngineSessionEvent = {
      seq: 5,
      kind: 'narration',
      data: { text: 'The door creaks open.', log_kind: 'narration' },
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({ who: 'Suzu', kind: 'narration', text: 'The door creaks open.' });
  });

  it('narration missing data.who falls back to Suzu (adversarial case)', () => {
    const e: EngineSessionEvent = { seq: 6, kind: 'narration', data: { text: 'Prose.' } };
    expect(eventToLogRow(e)?.who).toBe('Suzu');
  });

  it('narration with missing text is skipped', () => {
    const e: EngineSessionEvent = { seq: 7, kind: 'narration', data: {} };
    expect(eventToLogRow(e)).toBeNull();
  });

  it('dm_narration -> dm_narration row, who from data.who then actor then DM', () => {
    const e: EngineSessionEvent = {
      seq: 8,
      kind: 'dm_narration',
      actor: 'suzu_dm',
      data: { text: 'The torches flicker.' },
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({ who: 'suzu_dm', kind: 'dm_narration', text: 'The torches flicker.' });
  });

  it('dm_narration falls back to literal "DM" when neither data.who nor actor is present', () => {
    const e: EngineSessionEvent = { seq: 9, kind: 'dm_narration', data: { text: 'A ruling.' } };
    expect(eventToLogRow(e)?.who).toBe('DM');
  });

  it('dm_narration with missing text is skipped', () => {
    const e: EngineSessionEvent = { seq: 10, kind: 'dm_narration', data: {} };
    expect(eventToLogRow(e)).toBeNull();
  });

  it('scene_advance -> system row from data.description', () => {
    const e: EngineSessionEvent = {
      seq: 11,
      kind: 'scene_advance',
      data: { description: 'The scene shifts: approach -> cave-mouth' },
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({
      who: 'Suzu',
      kind: 'system',
      text: 'The scene shifts: approach -> cave-mouth',
    });
  });

  it('encounter_resolved -> system row from data.description', () => {
    const e: EngineSessionEvent = {
      seq: 12,
      kind: 'encounter_resolved',
      data: { description: 'Combat ended. Victory.' },
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({ who: 'Suzu', kind: 'system', text: 'Combat ended. Victory.' });
  });

  it('scene_advance/encounter_resolved without data.description is skipped', () => {
    expect(eventToLogRow({ seq: 13, kind: 'scene_advance', data: {} })).toBeNull();
    expect(eventToLogRow({ seq: 14, kind: 'encounter_resolved', data: null })).toBeNull();
  });

  // P1-PLAYFIX §3.5 / C13 — check_resolved rehydration render branch.
  it('check_resolved -> system row from data.description (P1-PLAYFIX §3.5 / C13)', () => {
    const e: EngineSessionEvent = {
      seq: 22,
      kind: 'check_resolved',
      data: { description: 'Survival check (DC 12): 15 — success.' },
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({
      who: 'Suzu',
      kind: 'system',
      text: 'Survival check (DC 12): 15 — success.',
    });
  });

  it('check_resolved without data.description is skipped', () => {
    expect(eventToLogRow({ seq: 23, kind: 'check_resolved', data: {} })).toBeNull();
  });

  // DDX-08 / T3 — server-authoritative dice roll rehydration.
  it('dice_roll (skill) -> roll row with kept as the die value and the sheet modifier', () => {
    const e: EngineSessionEvent = {
      seq: 30,
      kind: 'dice_roll',
      actor: 'leon',
      data: {
        kind: 'skill',
        notation: null,
        skill: 'perception',
        ability: null,
        character_id: 'c1',
        modifier: 3,
        advantage: 'straight',
        rolls: [15],
        kept: 15,
        total: 18,
        description: 'Perception check: rolled 15 + 3 = 18.',
      },
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({
      who: 'leon',
      kind: 'roll',
      text: 'Perception +3',
      roll: { sides: 20, value: 15, modifier: 3, crit: false, fumble: false, label: 'Perception' },
    });
  });

  it('dice_roll (raw notation) -> roll row sized off the notation, modifier 0', () => {
    const e: EngineSessionEvent = {
      seq: 31,
      kind: 'dice_roll',
      actor: 'leon',
      data: {
        kind: 'raw',
        notation: '1d6',
        skill: null,
        ability: null,
        character_id: null,
        modifier: 0,
        advantage: 'straight',
        rolls: [4],
        kept: null,
        total: 4,
        description: 'Rolled 1d6: [4] -> 4.',
      },
    };
    const row = eventToLogRow(e);
    expect(row).toMatchObject({
      kind: 'roll',
      text: '1d6',
      roll: { sides: 6, value: 4, modifier: 0, crit: false, fumble: false, label: '1d6' },
    });
  });

  it('dice_roll natural 20 on a d20 sets crit; natural 1 sets fumble', () => {
    const nat20: EngineSessionEvent = {
      seq: 32,
      kind: 'dice_roll',
      data: {
        kind: 'raw',
        notation: null,
        modifier: 0,
        advantage: 'straight',
        rolls: [20],
        kept: 20,
        total: 20,
        description: 'Rolled d20: 20.',
      },
    };
    expect(eventToLogRow(nat20)?.roll?.crit).toBe(true);

    const nat1: EngineSessionEvent = {
      seq: 33,
      kind: 'dice_roll',
      data: {
        kind: 'raw',
        notation: null,
        modifier: 0,
        advantage: 'straight',
        rolls: [1],
        kept: 1,
        total: 1,
        description: 'Rolled d20: 1.',
      },
    };
    expect(eventToLogRow(nat1)?.roll?.fumble).toBe(true);
  });

  it('dice_roll without data.description is skipped', () => {
    expect(eventToLogRow({ seq: 34, kind: 'dice_roll', data: {} })).toBeNull();
    expect(eventToLogRow({ seq: 35, kind: 'dice_roll', data: null })).toBeNull();
  });

  it('opening_narrated is never a plain row (caller reconstructs it specially)', () => {
    const e: EngineSessionEvent = {
      seq: 15,
      kind: 'opening_narrated',
      data: { scene_id: 'approach', source: 'read_aloud_verbatim' },
    };
    expect(eventToLogRow(e)).toBeNull();
  });

  it('structural/unknown kinds are skipped (rebind, session_start, session_created, hack)', () => {
    expect(eventToLogRow({ seq: 16, kind: 'rebind', data: {} })).toBeNull();
    expect(eventToLogRow({ seq: 17, kind: 'session_start', data: {} })).toBeNull();
    expect(eventToLogRow({ seq: 18, kind: 'session_created', data: {} })).toBeNull();
    expect(eventToLogRow({ seq: 19, kind: 'hack', data: { text: 'ignored' } })).toBeNull();
  });

  it('handles null data without throwing', () => {
    expect(eventToLogRow({ seq: 20, kind: 'player_action', data: null })).toBeNull();
    expect(eventToLogRow({ seq: 21, kind: 'narration', data: null })).toBeNull();
  });

  // MIKO ADVERSARIAL FINDING — FIXED (Ren-Dev, rehydration.ts:41): `data` is
  // `Record<string, unknown> | null` (types.ts) — the `as string | undefined`
  // casts on text/who/description below are compile-time-only and give ZERO
  // runtime protection. getSessionEventsRaw (lib/api/dnd.ts) does a bare
  // `apiCall<{events: EngineSessionEvent[]}>(...)` with no runtime shape
  // validation, so a wire response that lies about its own declared type
  // flows straight through unchecked — a truthy non-string data.text/who/
  // description/actor is a real (if rare) shape a corrupted/legacy row or
  // future engine schema drift could produce. decodeHtmlEntities now guards
  // with `if (typeof s !== 'string' || !s) return s;`, so these values pass
  // through UNTOUCHED (matching the pre-TAV-7 shape: React renders a
  // non-string LogRow.text/who fine) instead of throwing `s.replace is not a
  // function`. These tests now lock the FIXED, degrade-gracefully behavior —
  // see play.rehydration.test.tsx's sibling page-level lock for the
  // corresponding blast-radius-closed proof (the mount path no longer takes
  // down the whole play screen).
  it('a player_action event with a non-string (but truthy) data.text degrades gracefully — the value passes through untouched, no throw', () => {
    const e: EngineSessionEvent = {
      seq: 60,
      kind: 'player_action',
      actor: 'leon',
      data: { who: 'leon', text: 12345 },
    };
    expect(() => eventToLogRow(e)).not.toThrow();
    const row = eventToLogRow(e);
    expect(row).toMatchObject({ id: 'ev60', who: 'leon', kind: 'player', text: 12345 });
  });

  it('a narration event with a non-string data.who degrades gracefully (who is decoded unconditionally, before the kind switch) — passes through untouched, no throw', () => {
    const e: EngineSessionEvent = {
      seq: 61,
      kind: 'narration',
      data: { who: { nested: true }, text: 'Prose.' },
    };
    expect(() => eventToLogRow(e)).not.toThrow();
    const row = eventToLogRow(e);
    expect(row).toMatchObject({ kind: 'narration', text: 'Prose.', who: { nested: true } });
  });

  it('a non-string e.actor degrades gracefully (same decodeHtmlEntities call, different field) — passes through untouched and is still usable as the who fallback', () => {
    const e = {
      seq: 62,
      kind: 'player_action',
      actor: 42,
      data: { text: 'I look around.' },
    } as unknown as EngineSessionEvent;
    expect(() => eventToLogRow(e)).not.toThrow();
    const row = eventToLogRow(e);
    expect(row).toMatchObject({ kind: 'player', text: 'I look around.', who: 42 });
  });

  it('a scene_advance event with a non-string data.description degrades gracefully — passes through untouched, no throw', () => {
    const e: EngineSessionEvent = {
      seq: 63,
      kind: 'scene_advance',
      data: { description: ['not', 'a', 'string'] },
    };
    expect(() => eventToLogRow(e)).not.toThrow();
    const row = eventToLogRow(e);
    expect(row).toMatchObject({ kind: 'system', who: 'Suzu', text: ['not', 'a', 'string'] });
  });

  // TAV-7 / N1: the server persists a "previously on" recap reply under its
  // OWN top-level session-event kind ('recap', distinct from 'narration' —
  // see ProjectNekoNova api/routes/narration.py::_persist_narration). This
  // switch has no `case 'recap':` branch, so it falls to `default: return
  // null` — confirmed this is what actually happens (not assumed from the
  // absence of a case label). Whether that's the deliberate final design (the
  // play-strip SessionRecap component owns recap display via its own
  // independent buildRecap() fetch, so a duplicate row in the permanent
  // transcript would double up the same content) or an overlooked gap (every
  // OTHER server-emitted kind this file knows about — player_action,
  // narration, dm_narration, scene_advance, encounter_resolved, check_resolved,
  // dice_roll, opening_narrated — gets an explicit, documented branch in the
  // switch's own header comment; 'recap' is the only NAMED, meaningful,
  // server-persisted kind that isn't mentioned there at all) is a product
  // call, not mine — flagged, not resolved, in the QA verdict. Locking the
  // CURRENT behavior here either way so a future edit to this switch can't
  // silently drift without a conscious decision.
  it('TAV-7: a persisted kind:"recap" session event is currently NOT rendered as a ChatLog row (falls through to default/null)', () => {
    const e: EngineSessionEvent = {
      seq: 64,
      kind: 'recap',
      actor: 'suzu',
      data: { who: 'Suzu', text: 'When last we met, the tide was rising.', log_kind: 'recap' },
    };
    expect(eventToLogRow(e)).toBeNull();
  });

  it('derives a stable id from seq so rehydrated rows never collide with live r${n} ids', () => {
    const row = eventToLogRow({
      seq: 42,
      kind: 'narration',
      data: { text: 'Prose.' },
    });
    expect(row?.id).toBe('ev42');
    expect(row?.id.startsWith('r')).toBe(false);
  });

  // TAV-7: NekoNova's DMNarrationStreamRequest.sanitize_string runs
  // html.escape() on username/message/mechanics/adventure before persisting
  // — text/who/actor/description read back off a session event may arrive
  // HTML-entity-encoded. eventToLogRow must decode it so ChatLog (a plain
  // JSX text node, never dangerouslySetInnerHTML) shows the real characters.
  it('TAV-7: player_action text is HTML-entity-decoded (the exact live-confirmed recap-echo shape)', () => {
    // Confirmed via a live suzu_dnd_dev read: this is the ACTUAL persisted
    // data.text for the SessionRecap request prompt before the kind:'recap'
    // fix — html.escape() turned its two `"` into `&quot;`.
    const e: EngineSessionEvent = {
      seq: 100,
      kind: 'player_action',
      actor: 'suzu-tester-1',
      data: {
        who: 'suzu-tester-1',
        text: 'Give a short &quot;previously on&quot; recap of our last session.',
        log_kind: 'player',
        mode: 'act',
      },
    };
    const row = eventToLogRow(e);
    expect(row?.text).toBe('Give a short "previously on" recap of our last session.');
    expect(row?.text).not.toMatch(/&quot;/);
  });

  it('TAV-7: narration/dm_narration text and description are also decoded', () => {
    expect(
      eventToLogRow({ seq: 101, kind: 'narration', data: { text: 'The sign reads &quot;Fish &amp; Chips&quot;.' } })
        ?.text,
    ).toBe('The sign reads "Fish & Chips".');
    expect(
      eventToLogRow({ seq: 102, kind: 'dm_narration', data: { text: 'The rogue says &#x27;not it&#x27;.' } })?.text,
    ).toBe("The rogue says 'not it'.");
    expect(
      eventToLogRow({
        seq: 103,
        kind: 'scene_advance',
        data: { description: 'Tom &amp; Jerry&#x27;s tavern comes into view.' },
      })?.text,
    ).toBe("Tom & Jerry's tavern comes into view.");
  });

  it('TAV-7: who/actor are decoded too (not just text)', () => {
    const row = eventToLogRow({
      seq: 104,
      kind: 'player_action',
      actor: 'leon',
      data: { who: 'D&amp;D fan', text: 'Hello.' },
    });
    expect(row?.who).toBe('D&D fan');
  });

  it('TAV-7: plain text with no entities round-trips unchanged (the common case — no false decode)', () => {
    const row = eventToLogRow({
      seq: 105,
      kind: 'narration',
      data: { text: "You’re still new to town — a long ride through the hills." },
    });
    expect(row?.text).toBe("You’re still new to town — a long ride through the hills.");
  });

  it('formats created_at into a time string when present, empty string when absent/invalid', () => {
    const withTs = eventToLogRow({
      seq: 43,
      kind: 'narration',
      data: { text: 'x' },
      created_at: '2026-07-01T10:00:00Z',
    });
    expect(withTs?.ts).not.toBe('');

    const withoutTs = eventToLogRow({ seq: 44, kind: 'narration', data: { text: 'x' } });
    expect(withoutTs?.ts).toBe('');

    const invalidTs = eventToLogRow({
      seq: 45,
      kind: 'narration',
      data: { text: 'x' },
      created_at: 'not-a-date',
    });
    expect(invalidTs?.ts).toBe('');
  });
});

// TAV-7 — reverses Python's html.escape(v, quote=True), the exact escaper
// NekoNova's DMNarrationStreamRequest.sanitize_string runs on free-text
// fields (username/message/mechanics/adventure) before persisting them.
describe('decodeHtmlEntities', () => {
  it('decodes the standard html.escape(quote=True) entity set', () => {
    expect(decodeHtmlEntities('&amp;')).toBe('&');
    expect(decodeHtmlEntities('&lt;')).toBe('<');
    expect(decodeHtmlEntities('&gt;')).toBe('>');
    expect(decodeHtmlEntities('&quot;')).toBe('"');
    expect(decodeHtmlEntities('&#x27;')).toBe("'");
  });

  it('decodes the exact live-confirmed recap-prompt shape', () => {
    expect(
      decodeHtmlEntities('Give a short &quot;previously on&quot; recap of our last session.'),
    ).toBe('Give a short "previously on" recap of our last session.');
  });

  it('decodes &amp; LAST so a literal "&lt;" a player typed (which html.escape\'s own & pass turns into "&amp;lt;") round-trips back to "&lt;", not over-decoded to "<"', () => {
    // This is the exact inverse of html.escape's own order (it replaces `&`
    // FIRST so no later substitution can introduce a fresh bare `&`) — the
    // decoder must undo it in the opposite order or it double-decodes.
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeHtmlEntities('&amp;quot;')).toBe('&quot;');
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;');
  });

  it('is a no-op on plain text with no entities', () => {
    const plain = "You’re still new to town — a long ride through the hills.";
    expect(decodeHtmlEntities(plain)).toBe(plain);
  });

  it('handles empty string and multiple entities in one string', () => {
    expect(decodeHtmlEntities('')).toBe('');
    expect(decodeHtmlEntities('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;')).toBe(
      '<b>bold</b> & "quoted"',
    );
  });

  // A bare "&" that isn't the start of any of the 5 known entity sequences —
  // must be left completely alone, not partially matched or corrupted.
  it('leaves a bare "&" that is not part of any entity sequence untouched', () => {
    expect(decodeHtmlEntities('Fish & Chips')).toBe('Fish & Chips');
    expect(decodeHtmlEntities('AT&T')).toBe('AT&T');
    expect(decodeHtmlEntities('R&D')).toBe('R&D');
  });

  it('decodes real entities while leaving unrelated literal ampersands in the same string alone', () => {
    expect(decodeHtmlEntities('R&D team said &quot;go&quot; at AT&T HQ')).toBe(
      'R&D team said "go" at AT&T HQ',
    );
  });

  // Confirmed empirically (python3 -c "import html; html.escape('&#34;', quote=True)")
  // that html.escape(quote=True) NEVER emits &#34; or &#x22; — only &quot; for
  // `"` and the hex form &#x27; for `'`. Numeric entities for the quote chars
  // are therefore OUT OF SCOPE for what the server actually produces; these
  // two tests document that explicitly rather than leaving it unverified.
  it('numeric entities (&#34; / &#x22;) are never emitted by the server escaper — pass through unchanged (out of scope by design)', () => {
    expect(decodeHtmlEntities('&#34;')).toBe('&#34;');
    expect(decodeHtmlEntities('&#x22;')).toBe('&#x22;');
  });

  it('a player who literally typed the numeric-entity-shaped text "&#34;" still round-trips correctly (html.escape(\'&#34;\') === \'&amp;#34;\', confirmed via python3)', () => {
    expect(decodeHtmlEntities('&amp;#34;')).toBe('&#34;');
    expect(decodeHtmlEntities('&amp;#x22;')).toBe('&#x22;');
  });

  it('is idempotent on already-decoded plain text — a second pass never further mutates it', () => {
    const cases = [
      'Fish & Chips',
      'The rogue said "not it".',
      "It's a trap <run>!",
      'AT&T > Verizon, allegedly.',
      '',
    ];
    for (const plain of cases) {
      const once = decodeHtmlEntities(plain);
      expect(decodeHtmlEntities(once)).toBe(once);
    }
  });

  // FIXED (see the eventToLogRow-level locks above for the reachable,
  // production call-path version of this same gap): the guard is now
  // `if (typeof s !== 'string' || !s) return s;` — a truthy non-string value
  // passes through untouched instead of reaching `s.replace(...)` and throwing.
  it('passes a non-string input through untouched (defensive guard) — no longer throws', () => {
    expect(decodeHtmlEntities(12345 as unknown as string)).toBe(12345);
    expect(decodeHtmlEntities({ nested: true } as unknown as string)).toEqual({ nested: true });
    expect(decodeHtmlEntities(['a', 'b'] as unknown as string)).toEqual(['a', 'b']);
    expect(decodeHtmlEntities(true as unknown as string)).toBe(true);
  });

  it('falsy non-string inputs (null/undefined/0/false/NaN) pass through unchanged and do NOT throw', () => {
    expect(decodeHtmlEntities(null as unknown as string)).toBeNull();
    expect(decodeHtmlEntities(undefined as unknown as string)).toBeUndefined();
    expect(decodeHtmlEntities(0 as unknown as string)).toBe(0);
    expect(decodeHtmlEntities(false as unknown as string)).toBe(false);
    expect(decodeHtmlEntities(NaN as unknown as string)).toBeNaN();
  });
});

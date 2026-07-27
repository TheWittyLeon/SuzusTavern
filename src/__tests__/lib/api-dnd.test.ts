/**
 * @jest-environment node
 *
 * Tests for src/lib/api/dnd.ts
 *
 * Table-driven — verifies each wrapper calls the correct path/method/body.
 * Does not test retry logic (that's api-client.test.ts).
 */

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  (global as Record<string, unknown>).fetch = mockFetch;

  // Default: every call returns success envelope
  mockFetch.mockResolvedValue(
    new Response(
      JSON.stringify({ success: true, data: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
});

import {
  combatFromScene,
  createCharacter,
  getCharacter,
  levelUpCharacter,
  resolveLevelChoice,
  equipItem,
  unequipItem,
  giveItem,
  spendCurrency,
  getInventory,
  listMyCharacters,
  startSession,
  createSession,
  listSessions,
  getSession,
  getSessionEvents,
  getSessionEventsRaw,
  joinSession,
  pauseSession,
  resumeSession,
  endSession,
  awardSessionXp,
  grantCurrency,
  attack,
  dodge,
  dash,
  endTurn,
  rollDeathSave,
  getCombatStatus,
  castSpell,
  applyCondition,
  removeCondition,
  deleteCharacter,
  restoreCharacter,
  listTrashedCharacters,
  deleteSession,
  restoreSession,
  getGrounding,
  getCombatState,
  resolveCheck,
  learnSpell,
  getStartingEquipment,
} from '../../lib/api/dnd';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function lastCall() {
  const [url, init] = mockFetch.mock.calls[
    mockFetch.mock.calls.length - 1
  ] as [string, RequestInit & { headers?: Headers; body?: string }];
  const body = init.body ? (JSON.parse(init.body as string) as unknown) : undefined;
  return { url, method: init.method ?? 'GET', body };
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

describe('Characters', () => {
  it('createCharacter — POST /api/dnd/characters', async () => {
    await createCharacter({ username: 'u', name: 'Aria' });
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/characters');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ username: 'u', name: 'Aria' });
  });

  // 2026-07-24 Starting Equipment design
  it('createCharacter — carries equipment_selections when provided', async () => {
    await createCharacter({
      username: 'u',
      name: 'Aria',
      equipment_selections: [{ choice_id: 'class:armor', option_id: 'a' }],
    });
    const { body } = lastCall();
    expect(body).toMatchObject({
      equipment_selections: [{ choice_id: 'class:armor', option_id: 'a' }],
    });
  });

  it('createCharacter — omits equipment_selections entirely when not provided (back-compat/kill-switch gate)', async () => {
    await createCharacter({ username: 'u', name: 'Aria' });
    const { body } = lastCall();
    expect(body as Record<string, unknown>).not.toHaveProperty('equipment_selections');
  });

  it('getCharacter — GET /api/dnd/characters/:id?username=...', async () => {
    await getCharacter('char-1', 'player');
    const { url, method } = lastCall();
    expect(url).toBe('/api/dnd/characters/char-1?username=player');
    expect(method).toBe('GET');
  });

  it('getCharacter encodes special chars in id', async () => {
    await getCharacter('id with spaces', 'user/name');
    const { url } = lastCall();
    expect(url).toContain('id%20with%20spaces');
    expect(url).toContain('user%2Fname');
  });

  it('levelUpCharacter — POST /api/dnd/characters/:id/levelup', async () => {
    await levelUpCharacter('char-1', 'player');
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/characters/char-1/levelup');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ username: 'player' });
  });

  // T13 (DDX-14t/15t)
  it('resolveLevelChoice — POST /api/dnd/characters/:id/level-choices/:choiceId (subclass)', async () => {
    await resolveLevelChoice('char-1', 'player', 'subclass:3', { subclass: 'champion' });
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/characters/char-1/level-choices/subclass%3A3');
    expect(method).toBe('POST');
    expect(body).toEqual({ username: 'player', selection: { subclass: 'champion' } });
  });

  it('resolveLevelChoice — asi increase selection shape', async () => {
    await resolveLevelChoice('char-1', 'player', 'asi:4', {
      mode: 'increase',
      allocations: { strength: 2 },
    });
    const { body } = lastCall();
    expect(body).toEqual({
      username: 'player',
      selection: { mode: 'increase', allocations: { strength: 2 } },
    });
  });

  it('resolveLevelChoice — asi feat selection shape', async () => {
    await resolveLevelChoice('char-1', 'player', 'asi:4', { mode: 'feat', feat: 'grappler' });
    const { body } = lastCall();
    expect(body).toEqual({
      username: 'player',
      selection: { mode: 'feat', feat: 'grappler' },
    });
  });

  it('resolveLevelChoice resolves to the real {message} shape', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { message: '[DnD] Champion chosen!' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await resolveLevelChoice('char-1', 'player', 'subclass:3', {
      subclass: 'champion',
    });
    expect(result).toEqual({ message: '[DnD] Champion chosen!' });
  });

  it('equipItem — POST /api/dnd/characters/:id/equip', async () => {
    await equipItem('char-1', 'player', 'Sword');
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/characters/char-1/equip');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ username: 'player', item_name: 'Sword' });
  });

  // T5 — contract fix: the engine resolves to `{message: string}`, never a
  // Character and never a recomputed `ac`. Proves the wrapper's return value
  // matches the REAL envelope shape (same class of regression as
  // levelUpCharacter's own contract test).
  it('equipItem resolves to the real {message} shape, not a Character/ac', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { message: '[DnD] Equipped Chain Mail.' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await equipItem('char-1', 'player', 'Chain Mail');
    expect(result).toEqual({ message: '[DnD] Equipped Chain Mail.' });
    expect((result as Record<string, unknown>)['ac']).toBeUndefined();
  });

  it('unequipItem — POST /api/dnd/characters/:id/unequip', async () => {
    await unequipItem('char-1', 'player', 'Sword');
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/characters/char-1/unequip');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ item_name: 'Sword' });
  });

  it('unequipItem resolves to the real {message} shape, not a Character/ac', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { message: '[DnD] Unequipped Chain Mail.' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await unequipItem('char-1', 'player', 'Chain Mail');
    expect(result).toEqual({ message: '[DnD] Unequipped Chain Mail.' });
  });

  it('giveItem — POST /api/dnd/characters/:id/give-item', async () => {
    await giveItem('char-1', 'player', 'Healing Potion');
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/characters/char-1/give-item');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ username: 'player', item_name: 'Healing Potion' });
    expect((body as Record<string, unknown>)['quantity']).toBeUndefined();
  });

  it('giveItem passes an optional quantity through', async () => {
    await giveItem('char-1', 'player', 'Torch', 3);
    const { body } = lastCall();
    expect(body).toMatchObject({ item_name: 'Torch', quantity: 3 });
  });

  it('getInventory — GET /api/dnd/characters/:id/inventory', async () => {
    await getInventory('char-1', 'player');
    const { url, method } = lastCall();
    expect(url).toBe('/api/dnd/characters/char-1/inventory?username=player');
    expect(method).toBe('GET');
  });

  // T12 (DDX-23t): spendCurrency — no `username` in the body (unlike
  // equip/unequip/give-item above) — ownership is proven server-side by
  // guard_owner against the verified actor, not a body field (see
  // NekoNova-DnDEngine routes/characters.py::SpendCurrencyRequest, ~line 219).
  it('spendCurrency — POST /api/dnd/characters/:id/currency/spend, body {amount} only', async () => {
    await spendCurrency('char-1', 25);
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/characters/char-1/currency/spend');
    expect(method).toBe('POST');
    expect(body).toEqual({ amount: 25 });
  });

  it('spendCurrency resolves to the real {currency_gp, spent} shape', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { currency_gp: 75, spent: 25 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await spendCurrency('char-1', 25);
    expect(result).toEqual({ currency_gp: 75, spent: 25 });
  });
});

// ---------------------------------------------------------------------------
// Starting Equipment (2026-07-24 design)
// ---------------------------------------------------------------------------

describe('getStartingEquipment', () => {
  it('GET /api/dnd/starting-equipment?class=&background=', async () => {
    await getStartingEquipment('Fighter', 'Soldier');
    const { url, method } = lastCall();
    expect(url).toBe('/api/dnd/starting-equipment?class=Fighter&background=Soldier');
    expect(method).toBe('GET');
  });

  it('encodes special characters in class/background', async () => {
    await getStartingEquipment('a class', 'a/background');
    const { url } = lastCall();
    expect(url).toContain('class=a%20class');
    expect(url).toContain('background=a%2Fbackground');
  });

  it('resolves to the {class, background, class_package, background_package} envelope', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            class: 'fighter',
            background: 'soldier',
            class_package: {
              fixed: [{ slug: 'explorer-pack', qty: 1, name: "Explorer's Pack", description: '' }],
              choices: [
                {
                  id: 'class:armor',
                  prompt: '(a) chain mail or (b) leather armor',
                  options: [
                    { id: 'a', label: 'chain mail', grants: [{ slug: 'chain-mail', qty: 1, name: 'Chain Mail', description: 'Heavy armor.' }] },
                    { id: 'b', label: 'leather armor', grants: [{ slug: 'leather-armor', qty: 1, name: 'Leather Armor', description: 'Light armor.' }] },
                  ],
                },
              ],
            },
            background_package: { fixed: [], choices: [] },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await getStartingEquipment('fighter', 'soldier');
    expect(result.class).toBe('fighter');
    expect(result.class_package.fixed[0]).toMatchObject({ slug: 'explorer-pack', name: "Explorer's Pack" });
    expect(result.class_package.choices[0].options).toHaveLength(2);
    expect(result.background_package).toEqual({ fixed: [], choices: [] });
  });
});

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

// Slice B Fix 3: learnSpell's optional trailing `prepared` param. Only sent
// on the wire when the caller passes it explicitly (undefined) — omitting it
// preserves the engine's own default computed behavior. Used by the
// character-creation picker to stamp a wizard's picked leveled spells
// prepared=true (see src/app/character/new/page.tsx's leveled-spell apply).
describe('learnSpell — prepared override (Slice B Fix 3)', () => {
  it('omits `prepared` from the body when not passed', async () => {
    await learnSpell('char-1', 'alice', 'fire-bolt');
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/spells/char-1/learn');
    expect(method).toBe('POST');
    expect(body).toEqual({ username: 'alice', slug: 'fire-bolt' });
  });

  it('omits `prepared` from the body when explicitly undefined', async () => {
    await learnSpell('char-1', 'alice', 'magic-missile', undefined, undefined, undefined);
    const { body } = lastCall();
    expect(body).toEqual({ username: 'alice', slug: 'magic-missile' });
  });

  it('includes `prepared: true` when passed true (the wizard-leveled-pick case)', async () => {
    await learnSpell('char-1', 'alice', 'magic-missile', undefined, undefined, true);
    const { body } = lastCall();
    expect(body).toEqual({ username: 'alice', slug: 'magic-missile', prepared: true });
  });

  it('includes `prepared: false` when passed false (not just truthy-gated)', async () => {
    await learnSpell('char-1', 'alice', 'magic-missile', undefined, undefined, false);
    const { body } = lastCall();
    expect(body).toEqual({ username: 'alice', slug: 'magic-missile', prepared: false });
  });

  it('still includes `source` alongside `prepared` when both are passed', async () => {
    await learnSpell('char-1', 'alice', 'burning-hands', 'innate', undefined, true);
    const { body } = lastCall();
    expect(body).toEqual({
      username: 'alice',
      slug: 'burning-hands',
      source: 'innate',
      prepared: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

describe('Sessions', () => {
  it('startSession — POST /api/dnd/sessions', async () => {
    await startSession({ username: 'u', channel: 'ch' });
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/sessions');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ username: 'u', channel: 'ch' });
  });

  it('joinSession — POST /api/dnd/sessions/:id/join', async () => {
    await joinSession('sess-1', { username: 'u', channel: 'ch' });
    const { url, method } = lastCall();
    expect(url).toBe('/api/dnd/sessions/sess-1/join');
    expect(method).toBe('POST');
  });

  it('pauseSession — POST /api/dnd/sessions/:id/pause', async () => {
    await pauseSession('sess-1', { username: 'u', channel: 'ch' });
    const { url } = lastCall();
    expect(url).toBe('/api/dnd/sessions/sess-1/pause');
  });

  it('resumeSession — POST /api/dnd/sessions/:id/resume', async () => {
    await resumeSession('sess-1', { username: 'u', channel: 'ch' });
    const { url } = lastCall();
    expect(url).toBe('/api/dnd/sessions/sess-1/resume');
  });

  it('endSession — POST /api/dnd/sessions/:id/end', async () => {
    await endSession('sess-1', { username: 'u', channel: 'ch' });
    const { url } = lastCall();
    expect(url).toBe('/api/dnd/sessions/sess-1/end');
  });

  it('awardSessionXp — POST /api/dnd/sessions/:id/xp', async () => {
    await awardSessionXp('sess-1', { username: 'u', channel: 'ch', amount: 100 });
    const { url, body } = lastCall();
    expect(url).toBe('/api/dnd/sessions/sess-1/xp');
    expect(body).toMatchObject({ amount: 100 });
  });

  // T12 (DDX-23t): grantCurrency — no `username` in the body; DM identity is
  // proven server-side by guard_dm against the verified actor (see
  // NekoNova-DnDEngine routes/sessions.py::GrantCurrencyRequest, ~line 221).
  it('grantCurrency — POST /api/dnd/sessions/:id/grant-currency, body {character_id, gold}', async () => {
    await grantCurrency('sess-1', 'char-1', 50);
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/sessions/sess-1/grant-currency');
    expect(method).toBe('POST');
    expect(body).toEqual({ character_id: 'char-1', gold: 50 });
  });

  it('grantCurrency resolves to the real {currency_gp, granted} shape', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { currency_gp: 150, granted: 50 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await grantCurrency('sess-1', 'char-1', 50);
    expect(result).toEqual({ currency_gp: 150, granted: 50 });
  });
});

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

describe('Combat', () => {
  it('attack — POST /api/dnd/combat/attack', async () => {
    await attack({ username: 'u', combat_id: 'c1', target: 'goblin' });
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/combat/attack');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ target: 'goblin' });
  });

  it('dodge — POST /api/dnd/combat/dodge', async () => {
    await dodge({ username: 'u', combat_id: 'c1' });
    const { url } = lastCall();
    expect(url).toBe('/api/dnd/combat/dodge');
  });

  it('dash — POST /api/dnd/combat/dash', async () => {
    await dash({ username: 'u', combat_id: 'c1' });
    const { url } = lastCall();
    expect(url).toBe('/api/dnd/combat/dash');
  });

  it('endTurn — POST /api/dnd/combat/endturn', async () => {
    await endTurn({ username: 'u', combat_id: 'c1' });
    const { url } = lastCall();
    expect(url).toBe('/api/dnd/combat/endturn');
  });

  // Combat-UX Fixes 2026-07-27, Fix B.
  it('rollDeathSave — POST /api/dnd/combat/death-save', async () => {
    await rollDeathSave({ username: 'u', combat_id: 'c1' });
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/combat/death-save');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ username: 'u', combat_id: 'c1' });
  });

  it('getCombatStatus — GET /api/dnd/combat/:id/status', async () => {
    await getCombatStatus('sess-1');
    const { url, method } = lastCall();
    expect(url).toBe('/api/dnd/combat/sess-1/status');
    expect(method).toBe('GET');
  });

  it('castSpell — POST /api/dnd/spells/cast', async () => {
    await castSpell({ username: 'u', combat_id: 'c1', spell_name: 'Fireball' });
    const { url, body } = lastCall();
    expect(url).toBe('/api/dnd/spells/cast');
    expect(body).toMatchObject({ spell_name: 'Fireball' });
  });

  // T7 (DDX-17e): `target` is the combatant NAME (engine resolves by
  // case-insensitive name match, not participant_id — see ApplyConditionRequest's
  // doc comment in lib/api/types.ts).
  it('applyCondition — POST /api/dnd/combat/apply-condition, with duration_rounds', async () => {
    await applyCondition({
      combat_id: 'c1',
      target: 'Goblin',
      condition: 'poisoned',
      duration_rounds: 3,
      username: 'leon',
    });
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/combat/apply-condition');
    expect(method).toBe('POST');
    expect(body).toMatchObject({
      combat_id: 'c1',
      target: 'Goblin',
      condition: 'poisoned',
      duration_rounds: 3,
      username: 'leon',
    });
  });

  it('applyCondition — omits duration_rounds entirely when not supplied (indefinite)', async () => {
    await applyCondition({ combat_id: 'c1', target: 'Goblin', condition: 'prone' });
    const { body } = lastCall();
    expect(body).not.toHaveProperty('duration_rounds');
  });

  it('removeCondition — POST /api/dnd/combat/remove-condition', async () => {
    await removeCondition({ combat_id: 'c1', target: 'Goblin', condition: 'poisoned', username: 'leon' });
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/combat/remove-condition');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ combat_id: 'c1', target: 'Goblin', condition: 'poisoned', username: 'leon' });
  });
});

// ---------------------------------------------------------------------------
// Session listing + detail + my-characters (Sprint 5 prerequisite)
// ---------------------------------------------------------------------------

function mockData(data: unknown) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('Session listing (ST-033 / ST-041 / ST-044)', () => {
  it('listSessions — GET /api/dnd/sessions, unwraps .sessions', async () => {
    mockData({ sessions: [{ session_id: 's1', channel: 'leon' }] });
    const out = await listSessions();
    const { url, method } = lastCall();
    expect(url).toBe('/api/dnd/sessions');
    expect(method).toBe('GET');
    expect(out).toEqual([{ session_id: 's1', channel: 'leon' }]);
  });

  it('listSessions forwards username + status as query params', async () => {
    mockData({ sessions: [] });
    await listSessions({ username: 'leon', status: 'active,paused' });
    const { url } = lastCall();
    expect(url).toBe('/api/dnd/sessions?username=leon&status=active%2Cpaused');
  });

  it('listSessions returns [] when the envelope omits sessions', async () => {
    mockData({});
    expect(await listSessions()).toEqual([]);
  });

  it('getSession — GET /api/dnd/sessions/:id, unwraps .session', async () => {
    mockData({ session: { session_id: 's1', status: 'active' } });
    const s = await getSession('s1');
    const { url, method } = lastCall();
    expect(url).toBe('/api/dnd/sessions/s1');
    expect(method).toBe('GET');
    expect(s).toMatchObject({ session_id: 's1', status: 'active' });
  });

  it('getSession encodes the id', async () => {
    mockData({ session: { session_id: 'a/b' } });
    await getSession('a/b');
    expect(lastCall().url).toBe('/api/dnd/sessions/a%2Fb');
  });

  it('createSession — POST /api/dnd/sessions, returns the structured session', async () => {
    mockData({ message: 'started', session: { session_id: 's9', channel: 'leon' } });
    const s = await createSession({ username: 'leon', channel: 'leon' });
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/sessions');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ username: 'leon', channel: 'leon' });
    expect(s).toMatchObject({ session_id: 's9' });
  });

  it('createSession returns null when the (un-upgraded) backend omits session', async () => {
    mockData({ message: 'started' });
    expect(await createSession({ username: 'leon', channel: 'leon' })).toBeNull();
  });

  it('getSessionEvents — GET /api/dnd/sessions/:id/events, adapts wire shape → SessionEvent', async () => {
    mockData({
      events: [
        {
          seq: 1,
          kind: 'combat',
          actor: 'alice',
          visibility: 'public',
          data: { description: 'Two goblins attacked.' },
          created_at: '2026-06-21T10:00:00Z',
        },
      ],
    });
    const events = await getSessionEvents('s1');
    const { url, method } = lastCall();
    expect(url).toBe('/api/dnd/sessions/s1/events');
    expect(method).toBe('GET');
    expect(events).toHaveLength(1);
    expect(events![0]).toMatchObject({
      event_id: '1',
      event_type: 'combat',
      actor: 'alice',
      description: 'Two goblins attacked.',
      created_at: '2026-06-21T10:00:00Z',
    });
  });

  it('getSessionEvents adapts narration event — falls back to data.text when no description', async () => {
    mockData({
      events: [
        {
          seq: 2,
          kind: 'narration',
          actor: 'suzu',
          data: { text: 'The cave trembles with distant thunder.' },
          created_at: '2026-06-21T10:01:00Z',
        },
      ],
    });
    const events = await getSessionEvents('s1');
    expect(events![0]).toMatchObject({
      event_type: 'narration',
      description: 'The cave trembles with distant thunder.',
    });
  });

  it('getSessionEvents returns null on 404 (engine unreachable sentinel)', async () => {
    // FIX-4: null signals "engine unreachable" to checkShouldOpen so it fails safe.
    // Callers that want [] fall back with `?? []`.
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const events = await getSessionEvents('unknown-id');
    expect(events).toBeNull();
  });

  it('getSessionEvents returns null on network error (engine unreachable sentinel)', async () => {
    // FIX-4: null sentinel — not [] — so checkShouldOpen can distinguish.
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const events = await getSessionEvents('s1');
    expect(events).toBeNull();
  });

  it('getSessionEvents returns [] when events array is empty', async () => {
    mockData({ events: [] });
    const events = await getSessionEvents('s1');
    expect(events).toEqual([]);
  });

  it('getSessionEvents handles event with null data without throwing', async () => {
    // Engine can emit null-data events (e.g. session_start rows from pre-migration
    // Postgres state). Adapter must not throw — description should be undefined.
    mockData({
      events: [
        { seq: 1, kind: 'session_start', actor: 'suzu', data: null, created_at: '2026-06-21T09:00:00Z' },
      ],
    });
    const events = await getSessionEvents('s1');
    expect(events).toHaveLength(1);
    expect(events![0]).toMatchObject({ event_type: 'session_start', actor: 'suzu' });
    expect(events![0].description).toBeUndefined();
  });

  it('getSessionEvents prefers data.description over data.text when both are present', async () => {
    // The adapter must pick description first — text is the narration fallback only.
    mockData({
      events: [
        {
          seq: 3,
          kind: 'combat',
          actor: 'suzu',
          data: { description: 'primary text', text: 'fallback text' },
          created_at: '2026-06-21T10:02:00Z',
        },
      ],
    });
    const events = await getSessionEvents('s1');
    expect(events![0].description).toBe('primary text');
  });

  // ── PLAY-PERSIST §6.1 — raw reader for rehydration ─────────────────────────

  it('getSessionEventsRaw — GET /api/dnd/sessions/:id/events, preserves raw shape (seq/kind/data/actor/created_at)', async () => {
    mockData({
      events: [
        {
          seq: 5,
          kind: 'player_action',
          actor: 'leon',
          visibility: 'table',
          data: { who: 'leon', text: 'I push open the door.', log_kind: 'player', mode: 'act' },
          created_at: '2026-07-01T10:00:00Z',
        },
        {
          seq: 6,
          kind: 'narration',
          actor: 'leon',
          visibility: 'table',
          data: { who: 'Suzu', text: 'The door creaks open.', log_kind: 'narration' },
          created_at: '2026-07-01T10:00:05Z',
        },
      ],
    });
    const events = await getSessionEventsRaw('s1');
    const { url, method } = lastCall();
    expect(url).toBe('/api/dnd/sessions/s1/events');
    expect(method).toBe('GET');
    // Raw shape preserved — unlike getSessionEvents, `data` is NOT dropped/flattened.
    expect(events).toEqual([
      {
        seq: 5,
        kind: 'player_action',
        actor: 'leon',
        visibility: 'table',
        data: { who: 'leon', text: 'I push open the door.', log_kind: 'player', mode: 'act' },
        created_at: '2026-07-01T10:00:00Z',
      },
      {
        seq: 6,
        kind: 'narration',
        actor: 'leon',
        visibility: 'table',
        data: { who: 'Suzu', text: 'The door creaks open.', log_kind: 'narration' },
        created_at: '2026-07-01T10:00:05Z',
      },
    ]);
  });

  it('getSessionEventsRaw returns [] when events array is empty', async () => {
    mockData({ events: [] });
    const events = await getSessionEventsRaw('s1');
    expect(events).toEqual([]);
  });

  it('getSessionEventsRaw returns null on 404 (engine unreachable sentinel)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const events = await getSessionEventsRaw('unknown-id');
    expect(events).toBeNull();
  });

  it('getSessionEventsRaw returns null on network error (engine unreachable sentinel)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const events = await getSessionEventsRaw('s1');
    expect(events).toBeNull();
  });

  it('listMyCharacters — GET /api/dnd/characters?username=, unwraps .characters', async () => {
    mockData({ characters: [{ character_id: 'c1', name: 'Velka' }] });
    const out = await listMyCharacters('leon');
    const { url, method } = lastCall();
    expect(url).toBe('/api/dnd/characters?username=leon');
    expect(method).toBe('GET');
    expect(out).toEqual([{ character_id: 'c1', name: 'Velka' }]);
  });

  it('listMyCharacters returns [] when the envelope omits characters', async () => {
    mockData({});
    expect(await listMyCharacters('leon')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Delete / restore / trash (DEL-6)
// ---------------------------------------------------------------------------

describe('Delete / restore / trash (DEL-6)', () => {
  it('deleteCharacter — DELETE /api/dnd/characters/:id?username= (no body)', async () => {
    await deleteCharacter('char-1', 'leon');
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/characters/char-1?username=leon');
    expect(method).toBe('DELETE');
    expect(body).toBeUndefined();
  });

  it('deleteCharacter encodes id + username', async () => {
    await deleteCharacter('id/with', 'user name');
    const { url } = lastCall();
    expect(url).toContain('id%2Fwith');
    expect(url).toContain('user%20name');
  });

  it('restoreCharacter — POST /api/dnd/characters/:id/restore with username body', async () => {
    await restoreCharacter('char-1', 'leon');
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/characters/char-1/restore');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ username: 'leon' });
  });

  it('listTrashedCharacters — GET /api/dnd/characters/trash?username=, unwraps .characters', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { characters: [{ character_id: 't1' }] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const out = await listTrashedCharacters('leon');
    const { url, method } = lastCall();
    expect(url).toBe('/api/dnd/characters/trash?username=leon');
    expect(method).toBe('GET');
    expect(out).toEqual([{ character_id: 't1' }]);
  });

  it('listTrashedCharacters returns [] when characters is absent', async () => {
    expect(await listTrashedCharacters('leon')).toEqual([]);
  });

  it('deleteSession — DELETE /api/dnd/sessions/:id?username= (no body)', async () => {
    await deleteSession('sess-1', 'leon');
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/sessions/sess-1?username=leon');
    expect(method).toBe('DELETE');
    expect(body).toBeUndefined();
  });

  it('restoreSession — POST /api/dnd/sessions/:id/restore with username body', async () => {
    await restoreSession('sess-1', 'leon');
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/sessions/sess-1/restore');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ username: 'leon' });
  });
});

// ---------------------------------------------------------------------------
// ADV-6: combatFromScene
// ---------------------------------------------------------------------------

describe('combatFromScene (ADV-6)', () => {
  it('POST /api/dnd/combat/from-scene with session_id', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            combat_id: 'combat-1',
            round: 1,
            monsters: [
              { participant_id: 'g1', name: 'Goblin', hp: 7 },
            ],
            encounter_id: 'cave_mouth_guards',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await combatFromScene({ session_id: 's42' });
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/combat/from-scene');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ session_id: 's42' });
    expect(result).toMatchObject({ combat_id: 'combat-1', round: 1 });
    expect(result.monsters).toHaveLength(1);
    expect(result.monsters[0]).toMatchObject({ participant_id: 'g1', name: 'Goblin', hp: 7 });
  });

  it('passes optional encounter_id in the request body', async () => {
    await combatFromScene({ session_id: 's1', encounter_id: 'back_chamber' });
    const { body } = lastCall();
    expect(body).toMatchObject({ session_id: 's1', encounter_id: 'back_chamber' });
  });

  it('omits encounter_id from the body when not provided', async () => {
    await combatFromScene({ session_id: 's1' });
    const { body } = lastCall();
    expect((body as Record<string, unknown>)['encounter_id']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ADV-9: createSession with adventure_ref
// ---------------------------------------------------------------------------

describe('createSession with adventure_ref (ADV-9)', () => {
  it('passes adventure_ref through to the request body', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: { message: 'ok', session: { session_id: 's9', channel: 'c' } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await createSession({
      username: 'leon',
      channel: 'the_hollow_tide_cave',
      adventure_ref: 'dnd5e:adventure:hollow-tide-cave',
    });
    const { body } = lastCall();
    expect(body).toMatchObject({
      username: 'leon',
      channel: 'the_hollow_tide_cave',
      adventure_ref: 'dnd5e:adventure:hollow-tide-cave',
    });
  });

  it('does not send adventure_ref when omitted (freeform session)', async () => {
    await createSession({ username: 'leon', channel: 'sandbox' });
    const { body } = lastCall();
    expect((body as Record<string, unknown>)['adventure_ref']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getGrounding — normalizes the engine's NESTED grounding payload into the flat
// shape the play screen reads. Regression: the engine returns
// current_scene.{title,transitions} + campaign.progress.{flags,encounter_state};
// the UI reads scene_name/transitions/flags/encounter_state. Without mapping,
// the "Move on" button never appeared (transitions came back undefined).
// ---------------------------------------------------------------------------

describe('getGrounding — nested→flat normalization', () => {
  it('maps current_scene + campaign.progress into the flat GroundingData shape', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            current_scene: {
              id: 'approach',
              title: 'The Approach',
              boxed_text: 'The dock-road dwindles...',
              transitions: [{ to: 'cave_mouth', label: 'Enter the cave' }],
            },
            campaign: {
              progress: {
                flags: { lookout_spotted: true },
                encounter_state: { cave_mouth_guards: { status: 'unresolved' } },
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const g = await getGrounding('sess1');
    expect(g).not.toBeNull();
    expect(g!.scene_id).toBe('approach');
    expect(g!.scene_name).toBe('The Approach');
    expect(g!.boxed_text).toBe('The dock-road dwindles...');
    expect(g!.transitions).toEqual([{ to: 'cave_mouth', label: 'Enter the cave' }]);
    expect(g!.flags).toEqual({ lookout_spotted: true });
    expect(g!.encounter_state).toEqual({ cave_mouth_guards: { status: 'unresolved' } });
  });

  it('degrades to empty arrays/objects (never throws) on freeform-null grounding', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { current_scene: null, campaign: null } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const g = await getGrounding('sess1');
    expect(g!.transitions).toEqual([]);
    expect(g!.flags).toEqual({});
    expect(g!.encounter_state).toEqual({});
  });

  it('returns null gracefully when the request fails', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    const g = await getGrounding('sess1');
    expect(g).toBeNull();
  });

  // P1-PLAYFIX §3.4 / C8 — grounding surfaces current_scene.checks[], stripped
  // to {skill, dc, note}. on_success/on_failure must NEVER reach the client
  // shape even when the engine's wire payload includes them (authored
  // branching stays opaque to the browser).
  it('maps current_scene.checks[] to {skill, dc, note}, stripping on_success/on_failure', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            current_scene: {
              id: 'navigate',
              title: 'Finding Your Bearings',
              checks: [
                {
                  skill: 'survival',
                  dc: 12,
                  on_success: 'everfree_bearings_found',
                  on_failure: 'everfree_lost',
                  note: 'Read the canopy for a path.',
                },
              ],
            },
            campaign: { progress: {} },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const g = await getGrounding('sess1');
    expect(g!.checks).toEqual([
      { skill: 'survival', dc: 12, note: 'Read the canopy for a path.' },
    ]);
    const check = g!.checks![0] as unknown as Record<string, unknown>;
    expect(check['on_success']).toBeUndefined();
    expect(check['on_failure']).toBeUndefined();
  });

  it('handles a scene offering two alternative checks for one outcome (timberwolf: Stealth OR Survival)', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            current_scene: {
              id: 'timberwolf',
              checks: [
                { skill: 'stealth', dc: 12, on_success: 'slipped_past_wolf' },
                { skill: 'survival', dc: 12, on_success: 'slipped_past_wolf' },
              ],
            },
            campaign: { progress: {} },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const g = await getGrounding('sess1');
    expect(g!.checks).toEqual([
      { skill: 'stealth', dc: 12 },
      { skill: 'survival', dc: 12 },
    ]);
  });

  it('defaults checks to [] when the scene has none', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { current_scene: { id: 'fork' }, campaign: { progress: {} } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const g = await getGrounding('sess1');
    expect(g!.checks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveCheck (P1-PLAYFIX §3.3.1/3.3.3 — S2.4)
// Mirrors advanceScene: same fetch pattern, same route convention.
// ---------------------------------------------------------------------------

describe('resolveCheck (P1-PLAYFIX check-resolution client fn)', () => {
  it('POST /api/dnd/sessions/{id}/check with the skill + actor_username body', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            skill: 'survival',
            dc: 12,
            total: 15,
            success: true,
            flag_set: ['everfree_bearings_found'],
            mechanics: 'Survival check vs DC 12: rolled 15 — SUCCESS.',
            description: 'Survival check (DC 12): 15 — success.',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await resolveCheck('sess1', { skill: 'survival', actor_username: 'leon' });
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/sessions/sess1/check');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ skill: 'survival', actor_username: 'leon' });
    expect(result).toMatchObject({ skill: 'survival', dc: 12, total: 15, success: true });
    expect(result.flag_set).toEqual(['everfree_bearings_found']);
  });

  it('passes optional advantage/disadvantage flags in the request body', async () => {
    await resolveCheck('sess1', {
      skill: 'stealth',
      actor_username: 'leon',
      advantage: true,
    });
    const { body } = lastCall();
    expect(body).toMatchObject({ skill: 'stealth', actor_username: 'leon', advantage: true });
  });

  it('encodes the session id in the URL', async () => {
    await resolveCheck('sess with spaces', { skill: 'survival', actor_username: 'leon' });
    const { url } = lastCall();
    expect(url).toBe('/api/dnd/sessions/sess%20with%20spaces/check');
  });

  it('propagates a 400 no_such_check ApiError to the caller', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, error: 'no_such_check', data: { reason: 'no_such_check' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      resolveCheck('sess1', { skill: 'perception', actor_username: 'leon' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ---------------------------------------------------------------------------
// getCombatState — unwraps the engine's data.state nesting into a bare
// CombatState. Regression: GET /combat/{id}/state returns data:{state:{...}}
// (same convention as mutating routes' data.state); without unwrapping,
// combatState.participants was undefined and the play screen crashed on render.
// ---------------------------------------------------------------------------

describe('getCombatState — unwraps data.state', () => {
  it('returns the inner CombatState when the engine nests it under data.state', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { state: { combat_id: 'c1', participants: [{ participant_id: 'g1' }], initiative: ['g1'] } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const cs = await getCombatState('c1');
    expect(cs.combat_id).toBe('c1');
    expect(Array.isArray(cs.participants)).toBe(true);
    expect(cs.participants).toHaveLength(1);
  });

  it('tolerates a bare CombatState (no extra nesting)', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { combat_id: 'c2', participants: [], initiative: [] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const cs = await getCombatState('c2');
    expect(cs.combat_id).toBe('c2');
    expect(Array.isArray(cs.participants)).toBe(true);
  });
});

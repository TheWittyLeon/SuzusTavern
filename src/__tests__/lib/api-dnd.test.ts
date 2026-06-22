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
  equipItem,
  unequipItem,
  getInventory,
  listMyCharacters,
  startSession,
  createSession,
  listSessions,
  getSession,
  getSessionEvents,
  joinSession,
  pauseSession,
  resumeSession,
  endSession,
  awardSessionXp,
  attack,
  dodge,
  dash,
  endTurn,
  getCombatStatus,
  castSpell,
  deleteCharacter,
  restoreCharacter,
  listTrashedCharacters,
  deleteSession,
  restoreSession,
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

  it('equipItem — POST /api/dnd/characters/:id/equip', async () => {
    await equipItem('char-1', 'player', 'Sword');
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/characters/char-1/equip');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ username: 'player', item_name: 'Sword' });
  });

  it('unequipItem — POST /api/dnd/characters/:id/unequip', async () => {
    await unequipItem('char-1', 'player', 'Sword');
    const { url, method, body } = lastCall();
    expect(url).toBe('/api/dnd/characters/char-1/unequip');
    expect(method).toBe('POST');
    expect(body).toMatchObject({ item_name: 'Sword' });
  });

  it('getInventory — GET /api/dnd/characters/:id/inventory', async () => {
    await getInventory('char-1', 'player');
    const { url, method } = lastCall();
    expect(url).toBe('/api/dnd/characters/char-1/inventory?username=player');
    expect(method).toBe('GET');
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
    expect(events[0]).toMatchObject({
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
    expect(events[0]).toMatchObject({
      event_type: 'narration',
      description: 'The cave trembles with distant thunder.',
    });
  });

  it('getSessionEvents returns [] on 404 (graceful degradation)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const events = await getSessionEvents('unknown-id');
    expect(events).toEqual([]);
  });

  it('getSessionEvents returns [] on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const events = await getSessionEvents('s1');
    expect(events).toEqual([]);
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
    expect(events[0]).toMatchObject({ event_type: 'session_start', actor: 'suzu' });
    expect(events[0].description).toBeUndefined();
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
    expect(events[0].description).toBe('primary text');
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

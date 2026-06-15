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
  createCharacter,
  getCharacter,
  levelUpCharacter,
  equipItem,
  unequipItem,
  getInventory,
  startSession,
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

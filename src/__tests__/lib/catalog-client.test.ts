/**
 * @jest-environment node
 *
 * S2.4 — Tests for the catalog API client functions in src/lib/api/dnd.ts.
 * (getCatalog / getSystems / getSystemDefinition)
 *
 * Uses the node environment (same as api-dnd.test.ts) so Response is available.
 */

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  (global as Record<string, unknown>).fetch = mockFetch;

  // Default: empty catalog response.
  mockFetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        data: {
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
          system: 'dnd5e',
          content_type: 'race',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
});

import { getCatalog, getSystems, getSystemDefinition } from '../../lib/api/dnd';

function lastUrl(): string {
  const calls = mockFetch.mock.calls;
  return (calls[calls.length - 1] as [string])[0];
}

function mockData(data: unknown) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

// ---------------------------------------------------------------------------
// getCatalog
// ---------------------------------------------------------------------------

describe('getCatalog', () => {
  it('calls /api/dnd/catalog?system=dnd5e&type=race', async () => {
    await getCatalog('dnd5e', { type: 'race' });
    expect(lastUrl()).toBe('/api/dnd/catalog?system=dnd5e&type=race');
  });

  it('calls /api/dnd/catalog?system=dnd5e&type=class', async () => {
    await getCatalog('dnd5e', { type: 'class' });
    expect(lastUrl()).toBe('/api/dnd/catalog?system=dnd5e&type=class');
  });

  it('calls /api/dnd/catalog?system=dnd5e&type=background', async () => {
    await getCatalog('dnd5e', { type: 'background' });
    expect(lastUrl()).toBe('/api/dnd/catalog?system=dnd5e&type=background');
  });

  it('appends optional limit and offset', async () => {
    await getCatalog('dnd5e', { type: 'race', limit: 10, offset: 5 });
    const url = lastUrl();
    expect(url).toContain('limit=10');
    expect(url).toContain('offset=5');
  });

  it('appends packs and user when supplied', async () => {
    await getCatalog('dnd5e', { type: 'race', packs: 'core,homebrew', user: 'leon' });
    const url = lastUrl();
    expect(url).toContain('packs=core%2Chomebrew');
    expect(url).toContain('user=leon');
  });

  it('omits optional params when not supplied', async () => {
    await getCatalog('dnd5e', { type: 'race' });
    const url = lastUrl();
    expect(url).not.toContain('limit');
    expect(url).not.toContain('offset');
    expect(url).not.toContain('packs');
    expect(url).not.toContain('user');
  });

  it('throws ApiError when the backend returns success:false', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, error: 'system_not_found' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(getCatalog('unknown', { type: 'race' })).rejects.toMatchObject({
      code: 'system_not_found',
    });
  });

  it('resolves the catalog response shape with items array', async () => {
    mockData({
      system: 'dnd5e',
      content_type: 'race',
      items: [{ slug: 'elf', name: 'Elf', content_type: 'race', source_type: 'srd', data: {} }],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const result = await getCatalog('dnd5e', { type: 'race' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].slug).toBe('elf');
  });

  it('calls /api/dnd/catalog?system=dnd5e with no type param when type is omitted (manifest call)', async () => {
    // getCatalog with no opts.type → the URL must NOT include "type=".
    // This is the counts/manifest call pattern documented in CatalogCounts.
    await getCatalog('dnd5e');
    const url = lastUrl();
    expect(url).toBe('/api/dnd/catalog?system=dnd5e');
    expect(url).not.toContain('type=');
  });
});

// ---------------------------------------------------------------------------
// getSystems
// ---------------------------------------------------------------------------

describe('getSystems', () => {
  it('calls GET /api/dnd/systems and unwraps .systems', async () => {
    mockData({ systems: [{ system_id: 'dnd5e', name: 'D&D 5e', version: '1.0', is_active: true }] });
    const systems = await getSystems();
    expect(lastUrl()).toBe('/api/dnd/systems');
    expect(systems).toHaveLength(1);
    expect(systems[0].system_id).toBe('dnd5e');
  });

  it('returns [] when the envelope omits systems', async () => {
    mockData({});
    const systems = await getSystems();
    expect(systems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getSystemDefinition
// ---------------------------------------------------------------------------

describe('getSystemDefinition', () => {
  const fakeDef = {
    system_id: 'dnd5e',
    name: 'D&D 5e',
    version: '1.0',
    is_active: true,
    definition: {
      attributes: ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'],
      content_types: ['race', 'class', 'background'],
      character_required: ['race', 'class'],
      dice: {},
    },
  };

  it('calls GET /api/dnd/systems/:id/definition and unwraps .system', async () => {
    mockData({ system: fakeDef });
    const result = await getSystemDefinition('dnd5e');
    expect(lastUrl()).toBe('/api/dnd/systems/dnd5e/definition');
    expect(result.system_id).toBe('dnd5e');
    expect(result.definition.attributes).toHaveLength(6);
  });

  it('encodes special characters in the system id', async () => {
    mockData({ system: { ...fakeDef, system_id: 'a/b' } });
    await getSystemDefinition('a/b');
    expect(lastUrl()).toBe('/api/dnd/systems/a%2Fb/definition');
  });
});

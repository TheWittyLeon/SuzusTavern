/**
 * Tests for src/lib/api/adminContent.ts
 *
 * Verifies that each function calls the correct endpoint with the correct
 * method, query parameters, and request body.
 *
 * S8.3 — Gated Content Pipeline: admin content API client.
 */

// Mock the client module — use relative path so jest.mock hoist resolves correctly
jest.mock('../../lib/api/client', () => ({
  apiCall: jest.fn(),
}));

import { apiCall } from '../../lib/api/client';
import {
  listDrafts,
  getDraft,
  saveDraft,
  approveDraft,
  rejectDraft,
} from '../../lib/api/adminContent';

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>;

beforeEach(() => {
  mockApiCall.mockReset();
});

describe('listDrafts', () => {
  it('calls GET /api/dnd/admin/content/drafts with lifecycle=draft and user param', async () => {
    mockApiCall.mockResolvedValueOnce({ items: [], total: 0 });

    await listDrafts({ username: 'Leon' });

    expect(mockApiCall).toHaveBeenCalledWith(
      expect.stringContaining('/api/dnd/admin/content/drafts'),
      expect.objectContaining({ method: 'GET' }),
    );
    const [url] = mockApiCall.mock.calls[0] as [string, unknown];
    expect(url).toContain('lifecycle=draft');
    expect(url).toContain('limit=100');
    expect(url).toContain('user=Leon');
  });

  it('includes pack_id when packId is provided', async () => {
    mockApiCall.mockResolvedValueOnce({ items: [], total: 0 });

    await listDrafts({ username: 'Leon', packId: 'fallout-core' });

    const [url] = mockApiCall.mock.calls[0] as [string, unknown];
    expect(url).toContain('pack_id=fallout-core');
  });

  it('includes source_key when sourceKey is provided', async () => {
    mockApiCall.mockResolvedValueOnce({ items: [], total: 0 });

    await listDrafts({ username: 'Leon', sourceKey: 'fallout-owned-leon' });

    const [url] = mockApiCall.mock.calls[0] as [string, unknown];
    expect(url).toContain('source_key=fallout-owned-leon');
  });

  it('omits pack_id and source_key when not provided', async () => {
    mockApiCall.mockResolvedValueOnce({ items: [], total: 0 });

    await listDrafts({ username: 'Leon' });

    const [url] = mockApiCall.mock.calls[0] as [string, unknown];
    expect(url).not.toContain('pack_id=');
    expect(url).not.toContain('source_key=');
  });
});

describe('getDraft', () => {
  it('calls GET /api/dnd/admin/content/drafts/{draftId} with user param', async () => {
    const mockDraft = {
      draft_id: 42,
      name: 'Laser Rifle',
      content_type: 'weapon',
      slug: 'laser-rifle',
      pack_id: 'fallout-core',
      system_id: 'fallout2d20',
      lifecycle: 'draft',
      source: { key: 'fallout-owned-leon', page: 142, snippet: 'LASER RIFLE...' },
      previous_content_id: null,
      created_at: '2026-06-26T18:04:11Z',
      updated_at: '2026-06-26T18:04:11Z',
      data: { damage: [], skill: 'Guns', qualities: [] },
    };
    mockApiCall.mockResolvedValueOnce(mockDraft);

    const result = await getDraft(42, 'Leon');

    expect(mockApiCall).toHaveBeenCalledWith(
      expect.stringContaining('/api/dnd/admin/content/drafts/42'),
      expect.objectContaining({ method: 'GET' }),
    );
    const [url] = mockApiCall.mock.calls[0] as [string, unknown];
    expect(url).toContain('user=Leon');
    expect(result).toEqual(mockDraft);
  });
});

describe('saveDraft', () => {
  it('calls PATCH /api/dnd/admin/content/drafts/{draftId} with actor and fields', async () => {
    mockApiCall.mockResolvedValueOnce({ draft_id: 42, changed: true, version: 2 });

    const fields = { name: 'Updated Laser Rifle', data: { skill: 'Guns' } };
    await saveDraft(42, fields, 'Leon');

    expect(mockApiCall).toHaveBeenCalledWith(
      '/api/dnd/admin/content/drafts/42',
      expect.objectContaining({
        method: 'PATCH',
        json: { actor: 'Leon', fields },
      }),
    );
  });
});

describe('approveDraft', () => {
  it('calls POST /api/dnd/admin/content/drafts/{draftId}/approve with actor', async () => {
    mockApiCall.mockResolvedValueOnce({
      draft_id: 42,
      lifecycle: 'live',
      promoted_content_id: 9871,
    });

    const result = await approveDraft(42, 'Leon');

    expect(mockApiCall).toHaveBeenCalledWith(
      '/api/dnd/admin/content/drafts/42/approve',
      expect.objectContaining({
        method: 'POST',
        json: { actor: 'Leon' },
      }),
    );
    expect(result).toMatchObject({ lifecycle: 'live', promoted_content_id: 9871 });
  });

  it('includes notes when provided', async () => {
    mockApiCall.mockResolvedValueOnce({
      draft_id: 42,
      lifecycle: 'live',
      promoted_content_id: 9871,
    });

    await approveDraft(42, 'Leon', 'Verified against book page 142');

    expect(mockApiCall).toHaveBeenCalledWith(
      '/api/dnd/admin/content/drafts/42/approve',
      expect.objectContaining({
        json: { actor: 'Leon', notes: 'Verified against book page 142' },
      }),
    );
  });

  it('omits notes field when notes is undefined', async () => {
    mockApiCall.mockResolvedValueOnce({ draft_id: 42, lifecycle: 'live', promoted_content_id: 9871 });

    await approveDraft(42, 'Leon');

    const [, opts] = mockApiCall.mock.calls[0] as [string, { json: Record<string, unknown> }];
    expect(opts.json).not.toHaveProperty('notes');
  });
});

describe('rejectDraft', () => {
  it('calls POST /api/dnd/admin/content/drafts/{draftId}/reject with actor and reason', async () => {
    mockApiCall.mockResolvedValueOnce({ draft_id: 42, lifecycle: 'rejected' });

    const result = await rejectDraft(42, 'Leon', 'Damage values are incorrect');

    expect(mockApiCall).toHaveBeenCalledWith(
      '/api/dnd/admin/content/drafts/42/reject',
      expect.objectContaining({
        method: 'POST',
        json: { actor: 'Leon', reason: 'Damage values are incorrect' },
      }),
    );
    expect(result).toMatchObject({ lifecycle: 'rejected' });
  });
});

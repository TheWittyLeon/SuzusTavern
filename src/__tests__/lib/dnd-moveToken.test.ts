/**
 * B8c-3 fix round (Kage 3, Miko 3): `moveToken` on the REAL function. The wire contract the engine and the proxy read:
 * POST /api/dnd/combat/<encoded id>/move with a body of EXACTLY { participant_id, from, to } (the proxy stamps the actor; a caller's extra field must not travel).
 * Mutations seen red: the id left un-encoded -> the URL case; `json: req` -> the extra-field case; a field dropped -> the body case.
 */
jest.mock('../../lib/api/client', () => ({ apiCall: jest.fn() }));

import { apiCall } from '../../lib/api/client';
import { moveToken } from '../../lib/api/dnd';

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>;
beforeEach(() => mockApiCall.mockReset().mockResolvedValue({}));

describe('moveToken', () => {
  it('POSTs the three fields and nothing else, even when the caller hands more', async () => {
    const ctl = new AbortController();
    await moveToken('c1', { participant_id: 'p1', from: [1, 3], to: [2, 3], actor: 'mallory', extra: 1 } as unknown as Parameters<typeof moveToken>[1], ctl.signal);
    expect(mockApiCall).toHaveBeenCalledTimes(1);
    const [url, init] = mockApiCall.mock.calls[0] as [string, { method: string; json: unknown; signal: AbortSignal }];
    expect(url).toBe('/api/dnd/combat/c1/move');
    expect(init.method).toBe('POST');
    expect(init.json).toStrictEqual({ participant_id: 'p1', from: [1, 3], to: [2, 3] });
    expect(init.signal).toBe(ctl.signal);
  });

  it('encodes the combat id in the path (a slash or a dot-dot cannot change the route)', async () => {
    await moveToken('a/b?x=1#../c', { participant_id: 'p1', from: [0, 0], to: [0, 1] });
    expect(mockApiCall.mock.calls[0][0]).toBe(`/api/dnd/combat/${encodeURIComponent('a/b?x=1#../c')}/move`);
    expect(mockApiCall.mock.calls[0][0]).not.toContain('/b?');
  });
});

/**
 * F1/CAST-FAIL-SILENT (WF-TAV-AUDIT-BATCH-2026-07-22 Pass P) — engineErrorMessage.
 *
 * Coverage:
 *   1. Curated reasonMap match wins, even when body.message is ALSO present.
 *   2. Unmapped 4xx business error (400/403/404/409) with a real body.message
 *      surfaces that message verbatim.
 *   3. Unmapped 4xx business error with NO usable body.message falls back.
 *   4. Status-0 network/abort error NEVER surfaces body.message, even if one
 *      is (implausibly) present — always the fallback.
 *   5. 500 (and other 5xx) NEVER surfaces body.message — always the fallback.
 *   6. Non-JSON / no body at all -> fallback, no crash.
 *   7. A non-ApiError (plain thrown value, e.g. a string) -> fallback, no crash.
 */
import { engineErrorMessage, isApiError } from '@/lib/dnd/engineError';
import { makeApiError } from '@/lib/api/client';

describe('engineErrorMessage', () => {
  it('curated reasonMap wins even when body.message is also present', () => {
    const err = makeApiError(400, 'not_your_turn', {
      success: false,
      message: 'It is currently Goblin (p_gob1)\'s turn.',
      data: { reason: 'not_your_turn' },
    });
    const message = engineErrorMessage(err, {
      fallback: 'Could not act.',
      reasonMap: { not_your_turn: "It's not your turn." },
    });
    expect(message).toBe("It's not your turn.");
  });

  it('unmapped 4xx business error surfaces body.message verbatim', () => {
    for (const status of [400, 403, 404, 409]) {
      const err = makeApiError(status, String(status), {
        success: false,
        message: `Ready-to-show engine text for ${status}.`,
        data: {},
      });
      const message = engineErrorMessage(err, { fallback: 'generic fallback' });
      expect(message).toBe(`Ready-to-show engine text for ${status}.`);
    }
  });

  it('unmapped 4xx business error with no usable body.message falls back', () => {
    const emptyMessage = makeApiError(400, '400', { success: false, message: '', data: {} });
    expect(engineErrorMessage(emptyMessage, { fallback: 'fallback text' })).toBe('fallback text');

    const whitespaceMessage = makeApiError(404, '404', {
      success: false,
      message: '   ',
      data: {},
    });
    expect(engineErrorMessage(whitespaceMessage, { fallback: 'fallback text' })).toBe(
      'fallback text',
    );

    const noBody = makeApiError(409, '409');
    expect(engineErrorMessage(noBody, { fallback: 'fallback text' })).toBe('fallback text');
  });

  it('status-0 network/abort error NEVER surfaces body.message, even if implausibly present', () => {
    const networkErr = makeApiError(0, 'network', {
      success: false,
      message: 'this should never be shown',
    });
    expect(engineErrorMessage(networkErr, { fallback: 'Network error — try again.' })).toBe(
      'Network error — try again.',
    );

    const abortErr = makeApiError(0, 'abort');
    expect(engineErrorMessage(abortErr, { fallback: 'Network error — try again.' })).toBe(
      'Network error — try again.',
    );
  });

  it('5xx NEVER surfaces body.message (would leak "Internal server error" internals)', () => {
    const serverErr = makeApiError(500, '500', {
      success: false,
      message: 'Internal server error',
      data: {},
    });
    expect(engineErrorMessage(serverErr, { fallback: 'Could not complete that action.' })).toBe(
      'Could not complete that action.',
    );

    const serviceUnavailable = makeApiError(503, '503', {
      success: false,
      message: 'Authored adventures are not enabled.',
      data: { reason: 'msm_disabled' },
    });
    // Even WITH a reasonMap entry absent, 503 is not a business 4xx — falls
    // straight to fallback, never the body message.
    expect(
      engineErrorMessage(serviceUnavailable, { fallback: 'Not available right now.' }),
    ).toBe('Not available right now.');
  });

  it('non-JSON / no body at all falls back without crashing', () => {
    const err = makeApiError(400, '400');
    expect(engineErrorMessage(err, { fallback: 'fallback' })).toBe('fallback');
  });

  it('a non-ApiError thrown value falls back without crashing', () => {
    expect(engineErrorMessage('a plain string', { fallback: 'fallback' })).toBe('fallback');
    expect(engineErrorMessage(undefined, { fallback: 'fallback' })).toBe('fallback');
    expect(engineErrorMessage(new Error('plain error, no status'), { fallback: 'fallback' })).toBe(
      'fallback',
    );
  });

  it('isApiError correctly identifies makeApiError output and rejects plain errors', () => {
    expect(isApiError(makeApiError(400, 'x'))).toBe(true);
    expect(isApiError(new Error('plain'))).toBe(false);
    expect(isApiError('a string')).toBe(false);
    expect(isApiError(null)).toBe(false);
  });
});

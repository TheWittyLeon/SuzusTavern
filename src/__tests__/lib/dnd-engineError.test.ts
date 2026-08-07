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

// ── Tier 2 after NEKONOVA-PROXY-DROPS-MESSAGE (2026-08-06) ──────────────────
//
// Tier 2 ("surface the engine's own 4xx text") had never fired on 4 of the 5
// D&D proxy modules: they renamed the engine's `message` key to `error` while
// this module probes `message`. The proxy now forwards `message` again, so
// these lock the two halves of that repair — the key it reads, and the log
// prefix it must strip before a player sees the string.
describe('engineErrorMessage — engine message tier (post proxy fix)', () => {
  const withMessage = (text: string, status = 400) =>
    makeApiError(status, 'x', {
      success: false,
      error: text,
      message: text,
      data: { reason: 'some_unmapped_reason' },
    });

  it('strips a leading [Combat] tag — 86 engine strings carry one', () => {
    const err = withMessage('[Combat] No action remaining for Seth this turn.');
    expect(engineErrorMessage(err, { fallback: 'fb' })).toBe(
      'No action remaining for Seth this turn.',
    );
  });

  it('strips [Spell] / [DnD] / [Session] too, not just [Combat]', () => {
    for (const tag of ['Spell', 'DnD', 'Session']) {
      const err = withMessage(`[${tag}] Something the player should read.`);
      expect(engineErrorMessage(err, { fallback: 'fb' })).toBe(
        'Something the player should read.',
      );
    }
  });

  it('leaves a message with no tag untouched', () => {
    const err = withMessage('Combat or session not found.');
    expect(engineErrorMessage(err, { fallback: 'fb' })).toBe('Combat or session not found.');
  });

  it('does NOT strip brackets that are not a leading subsystem tag', () => {
    for (const text of ['[3] of 5 uses spent.', 'You rolled [nat 20]!', '[Combat missing brace']) {
      expect(engineErrorMessage(withMessage(text), { fallback: 'fb' })).toBe(text);
    }
  });

  it('a tag-only message falls back rather than showing an empty string', () => {
    expect(engineErrorMessage(withMessage('[Combat] '), { fallback: 'fb' })).toBe('fb');
  });

  it('curated copy still WINS over the engine message (tier 1 precedence)', () => {
    const err = withMessage('[Combat] raw engine wording.');
    expect(
      engineErrorMessage(err, { fallback: 'fb', reasonMap: { some_unmapped_reason: 'Curated.' } }),
    ).toBe('Curated.');
  });

  it('NEVER reads `error` as player copy — the Tavern BFF puts machine slugs there', () => {
    // /api/auth/* responses carry `error: "no_refresh_token"` etc. Surfacing
    // one verbatim is the raw-machine-code leak this module exists to prevent,
    // so tier 2 must stay keyed on `message` alone.
    const slugOnly = makeApiError(400, 'x', {
      success: false,
      error: 'no_refresh_token',
      data: { reason: 'unmapped' },
    });
    expect(engineErrorMessage(slugOnly, { fallback: 'fb' })).toBe('fb');
  });

  it('still refuses to surface a 5xx body message', () => {
    const err = withMessage('[Combat] Internal server error', 500);
    expect(engineErrorMessage(err, { fallback: 'fb' })).toBe('fb');
  });
});

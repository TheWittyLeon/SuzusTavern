/**
 * Tests for src/lib/a11y/escapeConsume.ts (TAV-A11Y-USE-ESCAPE-CONSUME-HOOK).
 *
 * The load-bearing invariant (UIR2-TAV-11 r2): e.stopPropagation() fires on
 * Escape UNCONDITIONALLY — even when canClose is false (busy) — so a busy
 * overlay's Escape can never bubble to the document-level Award-XP fallback
 * listener and close the WRONG thing. Only onClose/onRefocus are gated.
 */
import { consumeEscape, makeEscapeConsumeHandler } from '../../lib/a11y/escapeConsume';

function fakeKeyEvent(key: string) {
  return {
    key,
    stopPropagation: jest.fn(),
  } as unknown as React.KeyboardEvent;
}

describe('consumeEscape', () => {
  it('calls stopPropagation and onClose/onRefocus on Escape when canClose is unset (defaults true)', () => {
    const e = fakeKeyEvent('Escape');
    const onClose = jest.fn();
    const onRefocus = jest.fn();
    consumeEscape(e, { onClose, onRefocus });
    expect(e.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRefocus).toHaveBeenCalledTimes(1);
  });

  it('[load-bearing] calls stopPropagation on Escape EVEN when canClose is false (busy) — but does not call onClose/onRefocus', () => {
    const e = fakeKeyEvent('Escape');
    const onClose = jest.fn();
    const onRefocus = jest.fn();
    consumeEscape(e, { onClose, onRefocus, canClose: false });
    expect(e.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(onRefocus).not.toHaveBeenCalled();
  });

  it('calls onClose (no onRefocus provided) when canClose is true', () => {
    const e = fakeKeyEvent('Escape');
    const onClose = jest.fn();
    consumeEscape(e, { onClose, canClose: true });
    expect(e.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is a no-op (no stopPropagation, no onClose) for any non-Escape key', () => {
    const e = fakeKeyEvent('Tab');
    const onClose = jest.fn();
    consumeEscape(e, { onClose });
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is a no-op for other keys even when canClose is false', () => {
    const e = fakeKeyEvent('ArrowDown');
    const onClose = jest.fn();
    consumeEscape(e, { onClose, canClose: false });
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('makeEscapeConsumeHandler', () => {
  it('returns a handler that delegates to consumeEscape (Escape closes)', () => {
    const onClose = jest.fn();
    const onRefocus = jest.fn();
    const handler = makeEscapeConsumeHandler({ onClose, onRefocus });
    const e = fakeKeyEvent('Escape');
    handler(e);
    expect(e.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRefocus).toHaveBeenCalledTimes(1);
  });

  it('[load-bearing] the returned handler still stopPropagation()s while canClose is false, without closing', () => {
    const onClose = jest.fn();
    const handler = makeEscapeConsumeHandler({ onClose, canClose: false });
    const e = fakeKeyEvent('Escape');
    handler(e);
    expect(e.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the returned handler no-ops for non-Escape keys', () => {
    const onClose = jest.fn();
    const handler = makeEscapeConsumeHandler({ onClose });
    const e = fakeKeyEvent('Enter');
    handler(e);
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

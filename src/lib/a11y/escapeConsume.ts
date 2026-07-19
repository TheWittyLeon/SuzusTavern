/**
 * escapeConsume — TAV-A11Y-USE-ESCAPE-CONSUME-HOOK.
 *
 * Mechanizes the "consume-your-own-Escape" invariant established by
 * UIR2-TAV-11 r2: every Escape-handling overlay/menu/modal under /play must
 * call `e.stopPropagation()` UNCONDITIONALLY on Escape — gating only the
 * actual close/refocus on its own busy flag, never the stopPropagation
 * itself.
 *
 * WHY unconditional: the /play page has a document-level Award-XP fallback
 * listener that closes the Award-XP popover on any Escape that reaches
 * `document`. Before r2, several overlays only called stopPropagation()
 * while idle — while busy (submitting/saving), their Escape handler
 * deliberately left the overlay open (so the user could watch/retry an
 * in-flight request) but ALSO left the event unconsumed, so it bubbled
 * straight past the busy overlay to the document-level listener and silently
 * closed the unrelated Award-XP popover. The leak isn't "the overlay closes
 * when it shouldn't" — it's "the overlay's Escape falls through to an
 * unrelated listener and closes something else instead". Consuming the
 * event is a separate concern from whether THIS overlay is allowed to close
 * right now, hence the two are never gated together here.
 *
 * Before this helper, every overlay hand-rolled the same shape:
 *   if (e.key === 'Escape') {
 *     e.stopPropagation();
 *     if (!busy) { close(); refocus(); }
 *   }
 * Hand-rolling it means a new overlay can silently reintroduce the leak by
 * copying an old (pre-r2) example or just forgetting the unconditional part.
 * Route new Escape handling through `consumeEscape`/`makeEscapeConsumeHandler`
 * instead — see the source-scan regression test in
 * src/__tests__/lib/escapeConsume.source-scan.test.ts, which fails if a raw
 * `e.key === 'Escape'` handler appears in the /play page or its overlay
 * components without going through this module.
 */
import type React from 'react';

export interface ConsumeEscapeOptions {
  /** Called when the overlay is actually allowed to close (canClose !== false). */
  onClose: () => void;
  /**
   * Gates onClose/onRefocus — e.g. a `busy`/`submitting` flag. Defaults to
   * `true`. `e.stopPropagation()` fires regardless of this value; only the
   * close/refocus themselves are gated.
   */
  canClose?: boolean;
  /** Called immediately after onClose, when the overlay actually closes (e.g. return focus to the trigger). */
  onRefocus?: () => void;
}

/**
 * Imperative helper for composite handlers that also handle other keys (e.g.
 * a Tab focus-trap alongside Escape, or arrow-key menu navigation). Call it
 * from inside the caller's own `if (e.key === 'Escape') { ... }` branch (or
 * unconditionally — it no-ops for any other key, so the caller can safely
 * call it first and fall through to its own other-key branches).
 */
export function consumeEscape(
  e: React.KeyboardEvent,
  opts: ConsumeEscapeOptions,
): void {
  if (e.key !== 'Escape') return;
  // Unconditional — see module doc comment for why this is never gated.
  e.stopPropagation();
  if (opts.canClose === false) return;
  opts.onClose();
  opts.onRefocus?.();
}

/**
 * Factory for simple single-purpose overlays (menus/popovers whose
 * `onKeyDown` only ever needs to handle Escape) — returns a ready-to-use
 * `onKeyDown` handler.
 *
 * Caveat: call this OUTSIDE the JSX attribute position (e.g. build the
 * handler as a plain local variable/useCallback before the `return`) rather
 * than inline as `onKeyDown={makeEscapeConsumeHandler({...})}`, when
 * `opts.onClose`/`opts.onRefocus` close over a ref. The
 * `react-hooks/refs` lint rule flags ANY function call made during render
 * that receives a ref-touching closure as an argument — it can't see that
 * the ref is only actually read later, when the returned handler fires at
 * event time, not during this render. This project's own overlays all
 * refocus via a ref, so in practice every current call site here uses
 * `consumeEscape` directly inside an inline `onKeyDown={(e) => ...}`
 * instead (same behavior, no factory-call-with-ref-argument during render);
 * this factory is unit-tested and kept for a future ref-free overlay.
 */
export function makeEscapeConsumeHandler(
  opts: ConsumeEscapeOptions,
): (e: React.KeyboardEvent) => void {
  return (e: React.KeyboardEvent) => consumeEscape(e, opts);
}

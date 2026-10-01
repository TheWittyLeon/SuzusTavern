/**
 * lockProps / guardLocked — a TRANSIENT lock that keeps keyboard focus.
 *
 * Native `disabled` on the focused control drops focus to `<body>` (WCAG 2.4.3):
 * the composer on every send, the Cast button on every cast, a die on every roll.
 * Anything that is off only for a while (a request in flight, someone else's turn,
 * Suzu narrating, a paused session) is locked with `aria-disabled` instead: the
 * control stays focusable, announces as unavailable, and the event guard swallows
 * the activation. Native `disabled` is for PERMANENT states only (nothing to
 * select, a `fieldset[disabled]`), where there is no focus to keep.
 *
 *   <button {...lockProps(busy)} onClick={guardLocked(busy, submit)} />
 *   <textarea {...lockProps(busy, { textInput: true })} />
 *
 * DiceTray.press() and the X-card latch are the same pattern, written by hand
 * before this existed. Style `[aria-disabled='true']` like `:disabled`.
 */
import type { SyntheticEvent } from 'react';

export interface LockOptions {
  /** `aria-busy` only while something is really in flight. Defaults to `locked`;
   *  pass `false` for a lock that is not "working" (someone else's turn). */
  busy?: boolean;
  /** A text input also needs `readOnly`, or the user can still type into it. */
  textInput?: boolean;
}

export function lockProps(locked: boolean, { busy, textInput = false }: LockOptions = {}) {
  return {
    'aria-disabled': locked || undefined,
    'aria-busy': (busy ?? locked) || undefined,
    ...(textInput ? { readOnly: locked || undefined } : {}),
  };
}

/** Wrap an activation handler (click, change, key): while locked it is swallowed. */
export function guardLocked<E extends SyntheticEvent>(
  locked: boolean,
  handler?: (event: E) => void,
): (event: E) => void {
  return (event) => {
    if (locked) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
}

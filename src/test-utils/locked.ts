/**
 * expectLocked / expectUnlocked — the assertion for a control under a TRANSIENT lock
 * (lib/a11y/lockProps). jest-dom's toBeDisabled() only sees the native attribute, and a
 * transient lock must NOT be native: native `disabled` on the focused control drops
 * focus to <body> (Iro A9c-2 IMPORTANT-1). So "locked" here means aria-disabled AND
 * not natively disabled; a regression back to `disabled` fails this on purpose.
 */
export function expectLocked(el: HTMLElement): void {
  expect(el).toHaveAttribute('aria-disabled', 'true');
  expect(el).not.toBeDisabled();
}

export function expectUnlocked(el: HTMLElement): void {
  expect(el).not.toHaveAttribute('aria-disabled', 'true');
  expect(el).not.toBeDisabled();
}

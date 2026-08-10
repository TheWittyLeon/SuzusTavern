/**
 * TAV-SKIPLINK-DEAD-PASSWORD-PAGES (1.7 audit, 2026-08-10).
 *
 * The global "Skip to main content" link targets `#main-content`. Two pages
 * rendered `<main className={styles.wrap}>` with no `id` and no `tabIndex`, so
 * the skip link was a DEAD LINK on them and the page had no focusable landmark
 * — the only axe violation in the entire 140-state 1.7 capture matrix
 * (`skip-link` + `region`, 10/10 forgot-password states).
 *
 * `/reset-password` had the identical omission but was NOT in the capture
 * matrix, so it was source-confirmed only — which is exactly the kind of gap a
 * test should close rather than a screenshot.
 *
 * The assertion is deliberately about the CONTRACT (an element with
 * id="main-content" that is programmatically focusable), not about which tag
 * carries it, so a later refactor that moves the id to a wrapper still passes.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

import ForgotPasswordPage from '../../app/forgot-password/page';
import ResetPasswordPage from '../../app/reset-password/page';

function assertSkipTargetPresent(container: HTMLElement) {
  const target = container.querySelector('#main-content');
  expect(target).not.toBeNull();
  // Focusable-by-script: a landmark that the skip link can actually move focus
  // to. Without tabIndex the anchor jumps the viewport but leaves focus behind,
  // which is the half-fixed state worth guarding against.
  expect(target).toHaveAttribute('tabindex', '-1');
}

describe('skip-link targets exist on the password-recovery pages', () => {
  it('/forgot-password — form state', () => {
    const { container } = render(<ForgotPasswordPage />);
    expect(screen.getByRole('heading', { name: /forgotten passphrase/i })).toBeInTheDocument();
    assertSkipTargetPresent(container);
  });

  it('/reset-password', () => {
    const { container } = render(<ResetPasswordPage />);
    assertSkipTargetPresent(container);
  });
});

/**
 * TAV-1 — branded 404 (src/app/not-found.tsx).
 *
 * The Next.js default not-found rendered near-invisible unstyled text with no
 * way back into the app (UIR2-TAV-1). These locks assert the replacement has a
 * real heading and BOTH home routes, so a regression that drops them (or
 * reverts to the framework default) fails loudly.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// SuzuDM is a client/canvas island irrelevant to these semantics — stub it.
jest.mock('../../components/SuzuDM', () => ({
  __esModule: true,
  default: () => <div data-testid="suzu-dm" aria-hidden="true" />,
}));

import NotFound from '../../app/not-found';

describe('TAV-1 — branded not-found page', () => {
  it('renders a page heading (not the invisible framework default)', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/isn.t on the map/i);
  });

  it('offers both a "return to your table" (/dashboard) and a "back to the landing" (/) route', () => {
    render(<NotFound />);
    const toTable = screen.getByRole('link', { name: /return to your table/i });
    const toLanding = screen.getByRole('link', { name: /back to the landing/i });
    expect(toTable).toHaveAttribute('href', '/dashboard');
    expect(toLanding).toHaveAttribute('href', '/');
  });

  it('marks the mascot decorative (aria-hidden) so it is not announced', () => {
    render(<NotFound />);
    expect(screen.getByTestId('suzu-dm')).toHaveAttribute('aria-hidden', 'true');
  });
});

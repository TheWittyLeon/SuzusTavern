/**
 * Tests for src/components/TavernShell.tsx — MINOR-1 (Tora, interaction
 * review): nav overflow discoverability.
 *
 * The TAV-29 flex-nowrap+overflow-x:auto fix (≤720px tab strip) is correct
 * on its own, but for >3-tab configs (admin role, CODEX_ENABLED) the active
 * tab can end up scrolled off-screen with no cue. Covers:
 *   - the active tab is scrolled into view on mount
 *   - the active tab is re-scrolled into view when `active` changes
 *   - a trailing-edge overflow class is applied only when the tab strip is
 *     actually wider than its viewport (scrollWidth > clientWidth)
 *   - that class clears once scrolled to the trailing edge
 *   - the common ≤3-tab case (no overflow) never gets the overflow class
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', email: null, roles: [] }, logout: jest.fn() }),
}));

jest.mock('../../lib/theme/ThemeProvider', () => ({
  useTheme: () => ({
    vibe: 'dusk-tavern',
    setVibe: jest.fn(),
    density: 'cozy',
    setDensity: jest.fn(),
  }),
}));

import TavernShell from '../../components/TavernShell';

function renderShell(active: 'dashboard' | 'lobby' | 'modules' = 'dashboard') {
  return render(
    <TavernShell active={active} title="Test page">
      <div>body</div>
    </TavernShell>,
  );
}

/** Stamps scrollWidth/clientWidth/scrollLeft onto a jsdom element — jsdom's
 *  static layout always reports 0 for all three, so the overflow-detection
 *  code under test needs these overridden to exercise the overflowing
 *  branch at all. */
function stubScrollGeometry(
  el: HTMLElement,
  { scrollWidth, clientWidth, scrollLeft }: { scrollWidth: number; clientWidth: number; scrollLeft: number },
) {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
  Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true, writable: true });
}

describe('TavernShell — active tab scrolls into view', () => {
  it('scrolls the active tab into view on mount', () => {
    const spy = jest.spyOn(Element.prototype, 'scrollIntoView');
    renderShell('lobby');
    const activeTab = screen.getByRole('link', { name: /tables/i });
    expect(activeTab).toHaveAttribute('aria-current', 'page');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ inline: 'nearest', block: 'nearest' }),
    );
  });

  it('re-scrolls when the active tab changes (client-side navigation)', () => {
    const { rerender } = renderShell('dashboard');
    const spy = jest.spyOn(Element.prototype, 'scrollIntoView');
    spy.mockClear();
    rerender(
      <TavernShell active="lobby" title="Test page">
        <div>body</div>
      </TavernShell>,
    );
    expect(spy).toHaveBeenCalled();
  });
});

describe('TavernShell — trailing-edge overflow fade', () => {
  it('does NOT apply the overflow class for the common ≤3-tab case (no overflow)', () => {
    renderShell('dashboard');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    // jsdom reports scrollWidth === clientWidth === 0 by default — no overflow.
    expect(nav).not.toHaveClass('tabsOverflowing');
  });

  it('applies the overflow class once the strip is wider than its viewport', () => {
    renderShell('dashboard');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    stubScrollGeometry(nav, { scrollWidth: 500, clientWidth: 300, scrollLeft: 0 });
    fireEvent.scroll(nav);
    expect(nav).toHaveClass('tabsOverflowing');
  });

  it('clears the overflow class once scrolled to the trailing edge', () => {
    renderShell('dashboard');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    stubScrollGeometry(nav, { scrollWidth: 500, clientWidth: 300, scrollLeft: 0 });
    fireEvent.scroll(nav);
    expect(nav).toHaveClass('tabsOverflowing');

    // Scrolled all the way to the end — 300 + 200 === 500 (scrollWidth).
    stubScrollGeometry(nav, { scrollWidth: 500, clientWidth: 300, scrollLeft: 200 });
    fireEvent.scroll(nav);
    expect(nav).not.toHaveClass('tabsOverflowing');
  });
});

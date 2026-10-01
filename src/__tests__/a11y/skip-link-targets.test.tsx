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
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  useParams: () => ({ sessionId: 's1' }),
}));

// /play mocks (A9c C5) — modeled on play.xcard-independence.test.tsx.
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'alice', email: null } }),
}));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(() =>
    Promise.resolve({
      session_id: 's1',
      channel: 'the_hollow_tide',
      status: 'active',
      dm_username: 'suzu',
      participant_usernames: ['alice'],
      player_count: 1,
      active_combat_id: null,
      dm_mode: 'ai',
      visibility: 'public',
      content_rating: 'sfw',
    }),
  ),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(() => Promise.resolve([])),
  getGrounding: jest.fn(() =>
    Promise.resolve({ scene_id: 'cave_mouth', scene_name: 'Cave Mouth', transitions: [] }),
  ),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));
jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' };
  }),
}));

import ForgotPasswordPage from '../../app/forgot-password/page';
import ResetPasswordPage from '../../app/reset-password/page';
import PlayPage from '../../app/play/[sessionId]/page';
import PlayShell from '../../app/play/[sessionId]/PlayShell';
import { LAYOUT_ROWS, REGION_IDS, type RegionId } from '../../app/play/[sessionId]/presets';

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

describe('skip-link targets on /play (A9c C5, Iro A9b)', () => {
  it('#main-content is the story <main> (the one main landmark), focusable, and the only one', async () => {
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    expect(container.querySelectorAll('#main-content')).toHaveLength(1);
    assertSkipTargetPresent(container);
    const target = container.querySelector('#main-content') as HTMLElement;
    expect(target.tagName).toBe('MAIN');
    expect(target).toHaveAttribute('data-region-slot', 'storyLog');
    // The grid root no longer carries it: "skip to main content" must not land on the chrome.
    expect(container.querySelector('[data-layout-resolved]')).not.toHaveAttribute('id', 'main-content');
  });

  it('exploring: the action bar slot is the focusable #play-actions target but has no content, so no "Skip to actions" link is offered', async () => {
    const { container } = renderPlay(<PlayPage />);
    await screen.findByText('The Hollow Tide');
    const target = container.querySelectorAll('#play-actions');
    expect(target).toHaveLength(1);
    expect(target[0]).toHaveAttribute('tabindex', '-1');
    expect(target[0]).toHaveAttribute('data-region-slot', 'actionBar');
    expect(screen.queryByRole('link', { name: 'Skip to actions' })).toBeNull();
  });
});

describe('"Skip to actions" (PlayShell, real rows)', () => {
  const nodes = (without: RegionId[] = []) => {
    const out: Partial<Record<RegionId, React.ReactNode>> = {};
    for (const id of REGION_IDS) if (!without.includes(id)) out[id] = <span>{id}</span>;
    return out;
  };

  for (const row of LAYOUT_ROWS) {
    for (const moment of ['exploring', 'combat'] as const) {
      it(`${row.id}/${moment}: the link is the grid root's first child and targets the one #play-actions slot`, () => {
        const { container } = render(<PlayShell row={row} moment={moment} regions={nodes()} tenants={{}} />);
        const root = container.querySelector('[data-layout-resolved]') as HTMLElement;
        const link = screen.getByRole('link', { name: 'Skip to actions' });
        expect(root.firstElementChild).toBe(link);
        expect(link).toHaveAttribute('href', '#play-actions');
        expect(container.querySelectorAll('#play-actions')).toHaveLength(1);
        expect(container.querySelector('#play-actions')).toHaveAttribute('data-region-slot', 'actionBar');
      });
    }
  }

  it('no link while the target region has nothing to render', () => {
    render(<PlayShell row={LAYOUT_ROWS[0]} moment="combat" regions={nodes(['actionBar'])} tenants={{}} />);
    expect(screen.queryByRole('link', { name: 'Skip to actions' })).toBeNull();
  });
});

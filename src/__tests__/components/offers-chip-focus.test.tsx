/**
 * A9d-2 (Iro A9d-1 IMPORTANT-2): in the phone's `rows` Offers variant a focused chip that is only partly visible
 * must be scrolled wholly into view (browsers scroll a focused element only when it is wholly hidden). The
 * browser half is capture-play's offer-chip-focus transition; this pins the wiring: every chip kind, `rows` only.
 */
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Offers, { type OffersProps } from '@/app/play/[sessionId]/regions/Offers';
import type { SceneCheck, SceneTransition } from '@/lib/api/types';

const props = (): OffersProps => ({
  availableChecks: [{ skill: 'investigation', dc: 15, state: 'available' }] as unknown as SceneCheck[],
  offeredCheckSkill: null,
  checkBusy: false,
  talking: false,
  sessionLocked: false,
  onAttemptCheck: jest.fn(),
  checkWrapRef: createRef<HTMLDivElement>(),
  freeformOfferedCheck: 'stealth',
  freeformCheckRef: createRef<HTMLDivElement>(),
  rollBusy: false,
  combatBusy: false,
  onRoll: jest.fn(),
  availableTransitions: [{ to: 'stair', label: 'Retreat to the surface' }] as unknown as SceneTransition[],
  adventureComplete: false,
  transitionWrapRef: createRef<HTMLDivElement>(),
  sceneAdvanceBusy: false,
  onMoveOn: jest.fn(),
});

describe('Offers: a focused chip is brought wholly into view in the scrolling `rows` variant only', () => {
  let scrollIntoView: jest.Mock;
  beforeEach(() => {
    scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView; // jsdom implements none
  });
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  const CHIPS = [/Attempt Investigation/, /Attempt Stealth/, /Retreat to the surface/];

  it.each(CHIPS)('rows: focusing %s scrolls it into view, nearest on both axes', (name) => {
    render(<Offers {...props()} variant="rows" />);
    fireEvent.focus(screen.getByRole('button', { name }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  // A10 fix round F3 (named exception: this ran over `list` and `chips`; `list` is deleted)
  it.each(['chips'] as const)('%s wraps (nothing scrolls): focus moves nothing', (variant) => {
    render(<Offers {...props()} variant={variant} />);
    for (const name of CHIPS) fireEvent.focus(screen.getByRole('button', { name }));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('without scrollIntoView (jsdom, an old engine) focus does not throw', () => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    render(<Offers {...props()} variant="rows" />);
    expect(() => fireEvent.focus(screen.getByRole('button', { name: CHIPS[0] }))).not.toThrow();
  });
});

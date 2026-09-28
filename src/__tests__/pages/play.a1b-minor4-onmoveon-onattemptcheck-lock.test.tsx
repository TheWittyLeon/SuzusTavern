/**
 * A5 / Kage-CR IMPORTANT-5 (routed to A6 commit 0, 2026-09-28) — the
 * sibling clause of the exact same `if` statement MINOR-4 below closed for
 * `isSessionLocked`: the `talking` gate on `onMoveOn`
 * (`hooks/useSceneActions.ts:172`) and `onAttemptCheck` (`:274`) is
 * unpinned. Mutation (pass `false` instead of `talking` at the call site)
 * leaves the whole suite green — pre-existing, predates A5, unworsened by
 * it. What it guards: Amendment A §A.1 fact 2 — a "Move on"/"Attempt"
 * landing while the opening stream is in flight leaves `opening_narrated`
 * unwritten, so the opening re-fires on the next mount (the FIX-2 race).
 * Reuses this file's existing direct-handler-call harness (see MINOR-4's
 * doc block below for why `fireEvent` on the disabled button can't work),
 * with `talking` driven to true via a real in-flight beat (the composer
 * send below never resolves its streamDmNarration generator) rather than
 * `isSessionLocked` — a genuinely different gate, same shape.
 *
 * A1b / Kage-CR MINOR-4, exact ask (see 2026-09-28 QA session on
 * `feature/play-shell-a1b-prep-0928`) — the two consumers Kage's review
 * text names by line number, verbatim:
 *
 *   "MINOR-4 -- the moved `isSessionLocked` gate is unpinned at both
 *   consumers. `hooks/useScene.ts:619`, `:725`. [...] stubbing the
 *   `onMoveOn` gate to `false` reds nothing. It survives because
 *   `Offers.tsx:120/211` use native `disabled={... || sessionLocked}`, so
 *   RTL can't click through -- genuine belt-and-braces [...] Cheap fix:
 *   [...] call the handler path directly (or drive the button with
 *   fireEvent after clearing disabled), assert `advanceScene` /
 *   `resolveCheck` were never called."
 *
 * FINDING, confirmed by direct experiment (not assumed): the "drive the
 * button with fireEvent after clearing disabled" half of that suggestion
 * does NOT work in this React version. `Offers.tsx`'s `disabled` prop
 * (`sceneAdvanceBusy || talking || sessionLocked` / `checkBusy || talking
 * || sessionLocked`) is read by React's own synthetic click dispatch
 * (`shouldPreventMouseEvent`) from the component's LAST-RENDERED props,
 * not from the live DOM node. Clearing the DOM `disabled` attribute
 * (`removeAttribute('disabled')` / `.disabled = false`) does make the
 * button dispatch a real native `click` event (verified with a manually
 * attached `addEventListener('click', ...)` listener, which DOES fire) --
 * but React's own onClick handler is never invoked, because React's
 * internal gate is keyed to its own props snapshot, which still says
 * `disabled: true` since nothing re-rendered the component with a
 * different `sessionLocked` value. And `sessionLocked` (the prop) and
 * `isSessionLocked(session)` (this file's target) are the SAME session's
 * `status`, read via the SAME helper -- `useSessionLifecycle.ts:375`
 * (`sessionLocked = isPaused || isEnded`) can never diverge from
 * `useScene.ts`'s own `isSessionLocked(session)` read of that same
 * `session`, so there is no reachable render state where the button is
 * enabled while the internal check would fire. This is not a gap in this
 * test file's fixture; it's structural.
 *
 * So this file uses Kage's OTHER suggested route -- "call the handler path
 * directly" -- via the standard RTL partial-mock technique: `Offers` is
 * mocked to still render the real component (so the native `disabled`
 * belt-and-braces above is unaffected and independently visible), but the
 * mock ALSO captures the exact `onMoveOn`/`onAttemptCheck` props page.tsx
 * passes down (`(to) => void onMoveOn(to)` / `(skill) => void
 * onAttemptCheck(skill)`, `page.tsx` ~4438/~4449) into a module-scope
 * handle the test can call directly -- the REAL useScene closures, invoked
 * with no DOM/click/disabled involved at all.
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { OffersProps } from '@/app/play/[sessionId]/regions/Offers';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

let mockUsername = 'bob';
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: mockUsername, email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

let capturedOffersProps: OffersProps | null = null;
jest.mock('../../app/play/[sessionId]/regions/Offers', () => {
  const actual = jest.requireActual('../../app/play/[sessionId]/regions/Offers');
  return {
    __esModule: true,
    default: (props: OffersProps) => {
      // Captures the LATEST props on every render -- page.tsx's onMoveOn/
      // onAttemptCheck props are fresh arrow-function wrappers each render,
      // but both close over the SAME real useScene handlers underneath.
      capturedOffersProps = props;
      return actual.default(props);
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsRaw = jest.fn<Promise<unknown[] | null>, unknown[]>(() => Promise.resolve(null));
const mockGetParticipants = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve([]));
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockAdvanceScene = jest.fn<Promise<unknown>, unknown[]>();
const mockResolveCheck = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postSessionEvent: jest.fn(() => Promise.resolve({ seq: 1 })),
  pauseSession: jest.fn(() => Promise.resolve({ message: 'ok' })),
  resumeSession: jest.fn(() => Promise.resolve({ message: 'ok' })),
  endSession: jest.fn(() => Promise.resolve({ message: 'ok' })),
  awardSessionXp: jest.fn(() => Promise.resolve({ message: 'ok' })),
  advanceScene: (...args: Parameters<AnyFn>) => mockAdvanceScene(...args),
  resolveCheck: (...args: Parameters<AnyFn>) => mockResolveCheck(...args),
  npcAction: jest.fn(),
  combatFromScene: jest.fn(),
  rollInitiative: jest.fn(),
  monsterTurn: jest.fn(),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  endCombat: jest.fn(),
  setFlag: jest.fn(),
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'bob', role: 'player', character_id: 55 })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

const mockStreamDmNarration = jest.fn<AsyncGenerator<unknown>, unknown[]>(
  async function* mockStream(): AsyncGenerator<unknown> {
    // yields nothing by default — overridden per-test for the talking-gate
    // cases below, which need a beat that stays in flight.
  },
);
jest.mock('../../lib/stream', () => ({
  streamDmNarration: (...args: Parameters<AnyFn>) => mockStreamDmNarration(...args),
}));

import PlayPage from '@/app/play/[sessionId]/page';
import type { Session, Participant } from '@/lib/api/types';

const PAUSED_SESSION: Session = {
  session_id: 's1',
  channel: 'test_channel',
  name: 'The Hollow Tide',
  dm_username: 'dm_alice',
  dm_mode: 'ai',
  ai_assist_level: 'full',
  status: 'paused',
  active_combat_id: null,
};

const PARTICIPANTS: Participant[] = [
  { username: 'dm_alice', is_dm: true, character: null },
  { username: 'bob', is_dm: false, character: null },
];

// IMPORTANT-5: unlike PAUSED_SESSION, this session is NOT locked
// (`isSessionLocked` reads `status`) — `talking` must be the ONLY thing
// refusing onMoveOn/onAttemptCheck below, isolated from MINOR-4's gate.
const ACTIVE_SESSION: Session = {
  ...PAUSED_SESSION,
  status: 'active',
};

function setup() {
  jest.clearAllMocks();
  capturedOffersProps = null;
  mockUsername = 'bob';
  mockGetSession.mockResolvedValue(PAUSED_SESSION);
  mockGetSessionEvents.mockResolvedValue([]);
  mockGetSessionEventsRaw.mockResolvedValue(null);
  mockGetParticipants.mockResolvedValue(PARTICIPANTS);
  mockGetCombatState.mockResolvedValue(null);
  mockGetCharacterSheet.mockResolvedValue(null);
  mockAdvanceScene.mockResolvedValue({ from_scene: 'start', to_scene: 'forest_clearing' });
  mockResolveCheck.mockResolvedValue({ description: 'ok', mechanics: 'ok' });
  mockGetGrounding.mockResolvedValue({
    transitions: [{ to: 'forest_clearing', label: 'Head to the clearing' }],
    checks: [{ skill: 'perception', dc: 12 }],
  });
}

function setupActiveTalking() {
  setup();
  mockGetSession.mockResolvedValue(ACTIVE_SESSION);
  // A beat that sets `talking=true` synchronously (narrate()'s own
  // discipline) and never resolves — mirrors re-QA(1)'s "still pending"
  // technique (play.ddx20-pass3-miko-reqa.test.tsx) so `talking` stays true
  // for the whole test, isolated from any `done`/`error` cleanup timing.
  mockStreamDmNarration.mockImplementation(async function* () {
    await new Promise(() => {});
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('A1b MINOR-4 — onMoveOn / onAttemptCheck isSessionLocked gate, invoked directly', () => {
  it('the native `disabled` belt is present on BOTH affordances (context, not the assertion under test)', async () => {
    setup();
    render(<PlayPage />);
    const moveOnBtn = await screen.findByRole('button', { name: /Head to the clearing/i });
    const attemptBtn = await screen.findByRole('button', { name: /Attempt Perception, DC 12/i });
    expect(moveOnBtn).toBeDisabled();
    expect(attemptBtn).toBeDisabled();
  });

  it('onMoveOn (useScene.ts:619) refuses to advance the scene while the session is paused, called directly (not through the disabled button)', async () => {
    setup();
    render(<PlayPage />);
    await screen.findByRole('button', { name: /Head to the clearing/i });

    expect(capturedOffersProps).not.toBeNull();
    await act(async () => {
      capturedOffersProps!.onMoveOn('forest_clearing');
    });
    await flush();

    expect(mockAdvanceScene).not.toHaveBeenCalled();
  });

  it('onAttemptCheck (useScene.ts:725) refuses to resolve a check while the session is paused, called directly (not through the disabled button)', async () => {
    setup();
    render(<PlayPage />);
    await screen.findByRole('button', { name: /Attempt Perception, DC 12/i });

    expect(capturedOffersProps).not.toBeNull();
    await act(async () => {
      capturedOffersProps!.onAttemptCheck('perception');
    });
    await flush();

    expect(mockResolveCheck).not.toHaveBeenCalled();
  });
});

describe('A5 IMPORTANT-5 — onMoveOn / onAttemptCheck talking gate, invoked directly', () => {
  it('onMoveOn (useSceneActions.ts:172) refuses to advance the scene while a beat is talking, called directly (not through the disabled button)', async () => {
    setupActiveTalking();
    render(<PlayPage />);
    await screen.findByRole('button', { name: /Head to the clearing/i });

    // Drive talking=true via a REAL in-flight beat (composer send), not a
    // stub — the same discipline MINOR-4's own header insists on for
    // isSessionLocked.
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'I look around.' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await flush();

    expect(capturedOffersProps).not.toBeNull();
    await act(async () => {
      capturedOffersProps!.onMoveOn('forest_clearing');
    });
    await flush();

    expect(mockAdvanceScene).not.toHaveBeenCalled();
  });

  it('onAttemptCheck (useSceneActions.ts:274) refuses to resolve a check while a beat is talking, called directly (not through the disabled button)', async () => {
    setupActiveTalking();
    render(<PlayPage />);
    await screen.findByRole('button', { name: /Attempt Perception, DC 12/i });

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'I look around.' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await flush();

    expect(capturedOffersProps).not.toBeNull();
    await act(async () => {
      capturedOffersProps!.onAttemptCheck('perception');
    });
    await flush();

    expect(mockResolveCheck).not.toHaveBeenCalled();
  });
});

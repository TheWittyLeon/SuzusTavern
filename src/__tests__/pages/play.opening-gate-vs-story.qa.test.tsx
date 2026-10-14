/**
 * QA (Miko, 2026-10-13): the play page's opening gate keeps a PRIVATE list of "structural" event kinds
 * (`STRUCTURAL_EVENT_KINDS` in app/play/[sessionId]/hooks/useSceneState.ts) that is a second copy of the decision
 * the recap makes through `isStoryEvent` (lib/rehydration.ts STRUCTURAL_EVENT_KINDS). Before R64 they agreed on
 * `session_end` (both: counts). R64 moved it to bookkeeping in the recap only.
 *
 * Observable consequence, no recap involved: a campaign whose only rows are `session_start` and `session_end`
 * ("nothing happened", by the recap's ruling) is treated by the opening gate as "play already started", so the
 * scene's read-aloud opening is never drawn. The control (start only) draws it.
 *
 * The disagreement is real, so the "ought" assertion below is red today and is marked `it.failing`: the suite stays
 * green, and the day the two lists are made one decision this test turns red and tells the fixer to drop `.failing`.
 * The same shape exists for session_pause / session_resume / recap (the gate never listed them; pre-existing).
 */
import React from 'react';
import { screen, waitFor, act } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'dm_alice', email: null } }),
}));
jest.mock('../../lib/useReducedMotion', () => ({ useReducedMotion: () => true }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[] | null>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsRaw = jest.fn<Promise<unknown[] | null>, unknown[]>(() => Promise.resolve(null));
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockPostSessionEvent = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve({ seq: 9 }));
const mockStream = jest.fn();

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...a: Parameters<AnyFn>) => mockGetSession(...a),
  getSessionEvents: (...a: Parameters<AnyFn>) => mockGetSessionEvents(...a),
  getSessionEventsRaw: (...a: Parameters<AnyFn>) => mockGetSessionEventsRaw(...a),
  getParticipants: jest.fn(() => Promise.resolve([])),
  getGrounding: (...a: Parameters<AnyFn>) => mockGetGrounding(...a),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: (...a: Parameters<AnyFn>) => mockPostSessionEvent(...a),
  postRoll: jest.fn(),
  bindCharacter: jest.fn(() => Promise.resolve({ campaign_id: 's1', username: 'dm_alice', role: 'dm', character_id: null })),
  listMyCharacters: jest.fn(() => Promise.resolve([])),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));
jest.mock('../../lib/stream', () => ({ streamDmNarration: (...a: Parameters<AnyFn>) => mockStream(...a) }));

import PlayPage from '@/app/play/[sessionId]/page';
import type { Session } from '@/lib/api/types';

const SESSION: Session = {
  session_id: 's1',
  channel: 'test_channel',
  name: 'Hollow Tide',
  dm_username: 'dm_alice',
  dm_mode: 'human',
  ai_assist_level: 'off',
  dm_override_player_visible: true,
  active_combat_id: null,
};
const BOXED = 'Torchlight flickers across the wet stone.';
const GROUNDING = {
  scene_id: 'scene-1',
  scene_name: 'The Dark Cave',
  boxed_text: BOXED,
  objective: 'Find the artifact.',
  adventure_title: 'Hollow Tide',
  hook: 'A strange light beckons.',
  transitions: [],
  encounter_state: null,
};
const ev = (event_type: string, description: string) => ({ event_type, description });

async function openingDrawnFor(events: unknown[]): Promise<boolean> {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(SESSION);
  mockGetSessionEvents.mockResolvedValue(events);
  mockGetGrounding.mockResolvedValue(GROUNDING);
  const view = renderPlay(<PlayPage />);
  await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  const drawn = screen.queryByText(new RegExp(BOXED.slice(0, 20))) !== null;
  view.unmount();
  return drawn;
}

describe('opening gate vs the recap list on session_end (R64)', () => {
  it('control: a campaign with only session_start draws the opening (the gate reads the events)', async () => {
    expect(await openingDrawnFor([ev('session_start', 'Session started by dm_alice.')])).toBe(true);
    expect(mockGetSessionEvents).toHaveBeenCalled();
  });

  it('control: a campaign with real story does NOT draw the opening', async () => {
    expect(await openingDrawnFor([ev('session_start', 'Session started.'), ev('narration', 'The door creaks.')])).toBe(false);
  });

  // The recap says start + end is "nothing happened". The gate must say the same: the opening is still owed.
  it.failing('start + end only ("nothing happened" per the recap): the opening should still be drawn', async () => {
    expect(
      await openingDrawnFor([
        ev('session_start', 'Session started by dm_alice.'),
        ev('session_end', 'Session ended. 0 XP awarded to 0 players.'),
      ]),
    ).toBe(true);
  });

  it('characterization (today): start + end only draws NO opening, and the recap shows nothing either: the player sees neither', async () => {
    expect(
      await openingDrawnFor([
        ev('session_start', 'Session started by dm_alice.'),
        ev('session_end', 'Session ended. 0 XP awarded to 0 players.'),
      ]),
    ).toBe(false);
  });

  // Pre-existing (not R64): the gate never listed pause/resume, the recap always did.
  it('characterization (pre-existing): start + pause + resume only draws NO opening, though the recap list calls all three bookkeeping', async () => {
    expect(
      await openingDrawnFor([
        ev('session_start', 'Session started by dm_alice.'),
        ev('session_pause', 'Session paused.'),
        ev('session_resume', 'Session resumed.'),
      ]),
    ).toBe(false);
  });
});

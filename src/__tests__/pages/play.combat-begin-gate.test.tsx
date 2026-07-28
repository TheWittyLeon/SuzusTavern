/**
 * 2026-07-23 pre-flight playthrough nit (backlog "TAVERN PLAY-UI NITS",
 * item a) — Tavern client:
 *
 *   (a) The "Begin an encounter" / "Stand and fight" button used to render
 *       on EVERY scene, even ones with no authored combat encounter.
 *       Clicking it there always 400'd ("No encounter available for the
 *       current scene.") because `POST /combat/from-scene` only resolves
 *       the CURRENT scene's authored encounter block.
 *   (b) The button stayed enabled during narration, so a click could race
 *       an in-flight narration and 409 on the durable turn-key guard.
 *
 * This file pins the fix: the button is now gated on `sceneHasEncounter`
 * (mount/unmount, not just a copy swap — see page.tsx's combat-panel
 * ternary), and its `disabled` expression now matches the sibling action
 * rail (`talking || combatBusy || sessionLocked || rollBusy`), not just
 * `combatBusy`.
 *
 * Review pass (Kage-CR APPROVED-WITH-COMMENTS / Tora APPROVED-WITH-COMMENTS /
 * Iro-A11y CHANGES-REQUESTED, 2026-07-28) added: Iro CRITICAL-1 (falling-edge
 * focus recovery — a mount-gated button can strand focus on <body> when it
 * unmounts itself), Iro MINOR-1 (aria-busy = own-busy-ref || talking, the
 * adjudicated sibling convention), Iro MINOR-2 (aria-disabled mirrors
 * `disabled` byte-for-byte, same pairing as checkBtn/moveOnBtn/the freeform
 * check button).
 *
 * See also play.p4-fight-or-flee.test.tsx (Phase 4 Package B — the
 * "Stand and fight" relabel itself), play.sprint5-adversarial.test.tsx
 * (Iro-A11y MAJOR-2 — the rising-edge toast, unaffected by this fix since
 * it depends on the same `sceneHasEncounter`/`combatId` state, not on
 * whether the button is mounted), and play.checks-and-fork.test.tsx's own
 * "P1-PLAYFIX Ship 2 — stranded focus recovery (CRITICAL-1)" describe block,
 * whose exact `[aria-label^="Scene:"]` + `waitFor(activeElement)` technique
 * the new falling-edge test below mirrors.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { GroundingData, NarrationEvent, Participant, Session } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockGetSession = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSessionEvents = jest.fn<Promise<unknown[]>, unknown[]>(() => Promise.resolve([]));
const mockGetSessionEventsRaw = jest.fn<Promise<unknown[] | null>, unknown[]>(() =>
  Promise.resolve(null),
);
const mockGetParticipants = jest.fn<Promise<Participant[]>, unknown[]>(() => Promise.resolve([]));
const mockGetGrounding = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCombatState = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockGetCharacterSheet = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
const mockCombatFromScene = jest.fn<Promise<unknown>, unknown[]>();
const mockRollInitiative = jest.fn<Promise<unknown>, unknown[]>(() =>
  Promise.resolve({ message: 'Initiative rolled.' }),
);

jest.mock('../../lib/api/dnd', () => ({
  getSession: (...args: Parameters<AnyFn>) => mockGetSession(...args),
  getSessionEvents: (...args: Parameters<AnyFn>) => mockGetSessionEvents(...args),
  getSessionEventsRaw: (...args: Parameters<AnyFn>) => mockGetSessionEventsRaw(...args),
  getParticipants: (...args: Parameters<AnyFn>) => mockGetParticipants(...args),
  getGrounding: (...args: Parameters<AnyFn>) => mockGetGrounding(...args),
  getCombatState: (...args: Parameters<AnyFn>) => mockGetCombatState(...args),
  getCharacterSheet: (...args: Parameters<AnyFn>) => mockGetCharacterSheet(...args),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  combatFromScene: (...args: Parameters<AnyFn>) => mockCombatFromScene(...args),
  rollInitiative: (...args: Parameters<AnyFn>) => mockRollInitiative(...args),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  monsterTurn: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  resolveCheck: jest.fn(),
  postRoll: jest.fn(),
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() =>
    Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' }),
  ),
}));

const mockStreamDmNarration = jest.fn();
jest.mock('../../lib/stream', () => ({
  streamDmNarration: (...args: Parameters<AnyFn>) => mockStreamDmNarration(...args),
}));

import PlayPage from '@/app/play/[sessionId]/page';

/** ai_assist_level 'off' by default — narrate() never actually calls
 *  streamDmNarration under 'off' (mirrors play.p4-fight-or-flee.test.tsx),
 *  which keeps tests 1/2/4 hermetic. Test 3 overrides to 'full'. */
const SESSION: Session = {
  session_id: 's1',
  channel: 'everfree_flight_channel',
  name: 'Test Table',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['leon'],
  player_count: 1,
  active_combat_id: null,
  dm_mode: 'ai',
  ai_assist_level: 'off',
};

const PARTY: Participant[] = [
  {
    username: 'leon',
    is_dm: false,
    character: {
      character_id: 'c1',
      name: 'Anomaly',
      char_class: 'Ranger',
      level: 1,
      current_hp: 10,
      max_hp: 10,
      ac: 13,
    },
  },
];

/** A scene with an authored combat encounter (any trigger — the gate reads
 *  presence alone, matching page.tsx's `sceneHasEncounter`). */
const GROUNDING_WITH_ENCOUNTER: GroundingData = {
  scene_id: 'everfree_flight',
  scene_name: 'Flight Through the Everfree',
  boxed_text: 'The pack is closing in.',
  transitions: [],
  checks: [],
  flags: {},
  encounter_state: {},
  encounter: { kind: 'combat', trigger: 'manual' },
};

/** A scene with no authored encounter at all. */
const GROUNDING_NO_ENCOUNTER: GroundingData = {
  scene_id: 'anchor_arrival_outskirts',
  scene_name: 'The Outskirts',
  boxed_text: 'The road winds on.',
  transitions: [],
  checks: [],
  flags: {},
  encounter_state: {},
  encounter: null,
};

const FROM_SCENE_RESULT = {
  combat_id: 'combat-flight',
  round: 1,
  monsters: [
    { participant_id: 'w1', name: 'Timberwolf', hp: 19, from_ref: 'dnd5e:monster:mlp-timberwolf' },
  ],
  terrain: {},
  encounter_id: 'everfree_timberwolves',
};

function streamOnce(events: NarrationEvent[]) {
  mockStreamDmNarration.mockImplementation(async function* () {
    for (const e of events) yield e;
  });
}

/** Holds the legacy narration stream open indefinitely after one chunk —
 *  narrate()'s setTalking(true) fires before the for-await loop and
 *  setTalking(false) only after it completes (page.tsx ~line 2368/2502), so
 *  a generator that never finishes keeps `talking` true for the rest of the
 *  test. Same technique as play.ddx20-pass3-synthetic-beats.test.tsx /
 *  play.ddx20-durable-turn.test.tsx use for the durable subscribeDmJob path. */
function streamForever() {
  mockStreamDmNarration.mockImplementation(async function* () {
    yield { kind: 'chunk', text: 'The pack lunges from the treeline.' };
    await new Promise(() => {});
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue(SESSION);
  mockGetParticipants.mockResolvedValue(PARTY);
  mockGetGrounding.mockResolvedValue(null);
  streamOnce([{ kind: 'chunk', text: 'The pack is closing in.' }, { kind: 'done' }]);
  mockCombatFromScene.mockResolvedValue(FROM_SCENE_RESULT);
});

describe('TAVERN PLAY-UI NITS (a)+(b) — begin-combat button render gate + busy-disabled', () => {
  it('(1) a scene with no authored encounter never renders the begin-combat button', async () => {
    mockGetGrounding.mockResolvedValue(GROUNDING_NO_ENCOUNTER);
    render(<PlayPage />);

    // Wait for the scene to actually load before asserting absence —
    // otherwise this would trivially pass on the pre-fetch render too.
    await screen.findByText('The Outskirts');

    expect(
      screen.queryByRole('button', { name: /Begin an encounter/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stand and fight/i })).not.toBeInTheDocument();
  });

  it('(2) a scene with an authored encounter renders the button, labeled "Stand and fight"', async () => {
    mockGetGrounding.mockResolvedValue(GROUNDING_WITH_ENCOUNTER);
    render(<PlayPage />);
    await screen.findByText('Test Table');

    expect(
      await screen.findByRole('button', { name: /Stand and fight/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Begin an encounter$/i })).not.toBeInTheDocument();
  });

  it('(3) encounter present + narration in flight (talking) disables the button', async () => {
    mockGetGrounding.mockResolvedValue(GROUNDING_WITH_ENCOUNTER);
    mockGetSession.mockResolvedValue({ ...SESSION, ai_assist_level: 'full' });

    render(<PlayPage />);
    await screen.findByText('Test Table');

    const fightBtn = await screen.findByRole('button', { name: /Stand and fight/i });
    expect(fightBtn).not.toBeDisabled();

    streamForever();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'I ready myself.' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    // narrate()'s setTalking(true) fires synchronously before the SSE tail
    // is awaited — by the time the keydown's `act` flushes, `talking` is
    // already true and stays true (the mocked stream never completes).
    expect(fightBtn).toBeDisabled();
    // Iro-A11y MINOR-1: aria-busy = own-busy-ref (combatBusy) || talking —
    // this button isn't itself mid-request here, `talking` alone drives it.
    expect(fightBtn).toHaveAttribute('aria-busy', 'true');
    // Iro-A11y MINOR-2: aria-disabled mirrors `disabled` byte-for-byte.
    expect(fightBtn).toHaveAttribute('aria-disabled', 'true');
    expect(mockCombatFromScene).not.toHaveBeenCalled();
  });

  it('(4) idle with an encounter: button is enabled and calls combatFromScene once on click', async () => {
    mockGetGrounding.mockResolvedValue(GROUNDING_WITH_ENCOUNTER);
    render(<PlayPage />);
    await screen.findByText('Test Table');

    const fightBtn = await screen.findByRole('button', { name: /Stand and fight/i });
    expect(fightBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(fightBtn);
    });

    expect(mockCombatFromScene).toHaveBeenCalledTimes(1);
    expect(mockCombatFromScene).toHaveBeenCalledWith({ session_id: 's1' });
  });
});

describe('Iro-A11y CRITICAL-1 — falling-edge focus recovery when the button unmounts itself', () => {
  it('moves focus to the scene heading when the button\'s own successful click unmounts it', async () => {
    mockGetGrounding.mockResolvedValue(GROUNDING_WITH_ENCOUNTER);
    // combatFromScene's result carries no `state`, and getCombatState/
    // rollInitiative both resolve without one either (this file's defaults)
    // — so combatState never reaches 'active'. The ternary's other two
    // branches (combatIsActive / activeEncounterId) never take over once
    // combatId is set; the slot settles on `null`, not a replacement "In
    // combat" UI, which is what actually exercises the falling edge in
    // isolation (no second control to also claim focus).
    const { container } = render(<PlayPage />);
    await screen.findByText('Test Table');

    const fightBtn = await screen.findByRole('button', { name: /Stand and fight/i });

    // The user is on the button (keyboard activation or a prior mouse click
    // both leave the browser's focus there) before the unmounting click
    // fires — mirrors play.checks-and-fork.test.tsx's identical CRITICAL-1
    // pattern for the sibling check/transition refocus behavior.
    act(() => fightBtn.focus());
    expect(fightBtn).toHaveFocus();

    await act(async () => {
      fireEvent.click(fightBtn);
    });

    // combatFromScene resolves -> setCombatId(...) flips the ternary's
    // `!combatId && sceneHasEncounter` condition false -> the button
    // unmounts itself — focus must not be left stranded on <body>.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Stand and fight/i })).not.toBeInTheDocument();
    });
    const sceneHead = container.querySelector('[aria-label^="Scene:"]');
    expect(sceneHead).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(sceneHead));
  });

  it('does not refocus on initial mount even though the button starts out visible', async () => {
    mockGetGrounding.mockResolvedValue(GROUNDING_WITH_ENCOUNTER);
    render(<PlayPage />);
    await screen.findByText('Test Table');
    await screen.findByRole('button', { name: /Stand and fight/i });

    // beginEncounterVisibleRef seeds to `false`, so the mount render
    // (whatever sceneHasEncounter starts out as) can never satisfy the
    // falling-edge branch on its own first effect run — focus stays
    // wherever the browser naturally left it (document.body, since nothing
    // here explicitly focuses anything), never programmatically forced onto
    // sceneHead.
    expect(document.activeElement).toBe(document.body);
  });
});

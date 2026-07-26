/**
 * P1-PLAYFIX §3.3.3 (Ship 2 / S2.4) — Tavern client: check affordances + fork
 * choice buttons.
 *
 * Coverage (maps to the design doc's Miko checklist):
 *   C10: fork scene's two `auto:false` labelled transitions render as two
 *        distinct choice buttons, each calling advanceScene(to).
 *   C11: check affordance calls resolveCheck, narrates result.mechanics via
 *        narrate(), and refreshes grounding afterward.
 *   C12 (client-side bound): the affordance never invents a check the scene
 *        doesn't authored-offer — grounding is the sole source.
 *   Rehydration (§3.3.3 item 4): on load, checks/transitions reflect the
 *        CURRENT scene from grounding, not an assumed opening scene — a
 *        resumed session lands mid-graph (modelled here via the timberwolf
 *        scene with a two-skill alternative check).
 *   Adversarial: checks hidden during active combat; a 400 no_such_check
 *        refusal surfaces a toast without crashing.
 *
 * D1a (Leon, product decision, 2026-07-19): authored scene checks are now
 * ALWAYS-AVAILABLE, player-invoked affordances — the prior "DM must invite
 * it" gate (asserted throughout this file up to that date) is SUPERSEDED.
 * A player can attempt any authored check for the active scene without
 * waiting for Suzu to name it first; the check she DOES invite is now purely
 * a visual/a11y highlight (`offerCheck` below still drives that highlight
 * for the aria-wiring tests), not a visibility gate.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type {
  CombatState,
  GroundingData,
  NarrationEvent,
  Participant,
  Session,
} from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 's1' }),
}));

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 1, username: 'leon', email: null } }),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('../../lib/api/dnd', () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(),
  getCombatState: jest.fn(() => Promise.resolve(null)),
  getCharacterSheet: jest.fn(() => Promise.resolve(null)),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  combatFromScene: jest.fn(),
  startCombat: jest.fn(),
  spawnMonster: jest.fn(),
  rollInitiative: jest.fn(),
  monsterTurn: jest.fn(),
  attack: jest.fn(),
  dodge: jest.fn(),
  dash: jest.fn(),
  endTurn: jest.fn(),
  endCombat: jest.fn(),
  advanceScene: jest.fn(),
  setFlag: jest.fn(),
  resolveCheck: jest.fn(),
  // DDX-22 Phase 3: JournalPane is now unconditionally mounted on the play
  // page (only its CSS visibility/inert state is gated by journalVisible —
  // see page.tsx's <aside id="play-pane-journal">), so every render of this
  // page fires a getSessionNotes() GET regardless of whether the journal is
  // ever opened. Default to "no note yet" so this suite stays hermetic.
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () { yield { kind: 'done' as const }; }),
}));

import * as dnd from '@/lib/api/dnd';
import * as stream from '@/lib/stream';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetSessionEvents = dnd.getSessionEvents as jest.MockedFunction<typeof dnd.getSessionEvents>;
const mGetSessionEventsRaw = dnd.getSessionEventsRaw as jest.MockedFunction<
  typeof dnd.getSessionEventsRaw
>;
const mAdvanceScene = dnd.advanceScene as jest.MockedFunction<typeof dnd.advanceScene>;
const mResolveCheck = dnd.resolveCheck as jest.MockedFunction<typeof dnd.resolveCheck>;
const mStream = stream.streamDmNarration as jest.MockedFunction<typeof stream.streamDmNarration>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION: Session = {
  session_id: 's1',
  channel: 'mlp_everfree_leon',
  status: 'active',
  dm_username: 'suzu',
  participant_usernames: ['leon'],
  player_count: 1,
  active_combat_id: null,
  dm_mode: 'ai',
  ai_assist_level: 'full',
};

const SESSION_WITH_COMBAT: Session = { ...SESSION, active_combat_id: 'combat-1' };

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

const COMBAT_STATE_ACTIVE: CombatState = {
  combat_id: 'combat-1',
  session_id: 's1',
  round: 1,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p1',
  initiative: ['p1'],
  participants: [
    {
      participant_id: 'p1',
      entity_id: 'c1',
      name: 'Anomaly',
      is_pc: true,
      initiative: 15,
      hp_current: 10,
      hp_max: 10,
      ac: 13,
      conditions: [],
      is_alive: true,
      can_be_targeted: false,
      is_active_turn: true,
      took_turn: false,
    },
  ],
};

/** A resumed mid-graph session: current_scene is the timberwolf beat (not the
 *  opening cold_open), offering two ALTERNATIVE skills for the same outcome. */
const GROUNDING_TIMBERWOLF: GroundingData = {
  scene_id: 'slice_everfree_timberwolf',
  scene_name: 'The Timberwolf',
  boxed_text: 'Twigs snap somewhere close.',
  objective: 'Slip past or fight the timberwolf.',
  transitions: [],
  checks: [
    { skill: 'stealth', dc: 12 },
    { skill: 'survival', dc: 12 },
  ],
  flags: {},
  encounter_state: {},
};

/** The fork scene: two auto:false labelled transitions, no checks. */
const GROUNDING_FORK: GroundingData = {
  scene_id: 'slice_everfree_fork',
  scene_name: 'The Fork',
  boxed_text: 'Two paths diverge.',
  objective: 'Choose a way onward.',
  transitions: [
    { to: 'slice_everfree_zecora', label: 'Follow the smoke — southeast' },
    { to: 'slice_everfree_ponyville', label: 'Follow the path — northwest' },
  ],
  checks: [],
  flags: {},
  encounter_state: {},
};

function streamOnce(events: NarrationEvent[]) {
  mStream.mockImplementation(async function* () {
    for (const e of events) yield e;
  });
}

async function sendMessage(text: string) {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter' });
  });
}

/**
 * D1a: authored checks render as soon as the scene grounding loads — a
 * narrator invite is no longer required for visibility. This helper now
 * exists purely to drive the `isOffered` HIGHLIGHT signal (via a narrate()
 * beat whose SSE response carries the matching offeredCheck), for the tests
 * further down that assert on the highlight's aria wiring. It still waits
 * for the "Attempt {skill}" button to be present (which, post-D1a, may
 * already have been true before this call — that's fine, the wait is a
 * no-op in that case).
 */
async function offerCheck(skill: string, dc: number) {
  await screen.findByRole('textbox');
  streamOnce([
    { kind: 'chunk', text: `Suzu invites a ${skill} check.`, offeredCheck: { skill, dc } },
    { kind: 'done' },
  ]);
  await sendMessage(`I consider using my ${skill}.`);
  // findByRole requires a single match; a scene may author the same skill at
  // two DCs (two buttons whose name both start with "Attempt {skill}"), so
  // wait on the count instead of a single-element query.
  const namePattern = new RegExp(`Attempt ${skill}`, 'i');
  await waitFor(() => {
    expect(screen.queryAllByRole('button', { name: namePattern }).length).toBeGreaterThan(0);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetSessionEvents.mockResolvedValue([]);
  mGetSessionEventsRaw.mockResolvedValue(null);
  streamOnce([{ kind: 'chunk', text: 'Suzu narrates.' }, { kind: 'done' }]);
});

// ── C10: fork renders both labelled choices as distinct buttons ─────────────

describe('P1-PLAYFIX — fork scene choice buttons (C10)', () => {
  it('renders both auto:false labelled transitions as distinct buttons, on rehydrated mid-graph load', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_FORK);
    render(<PlayPage />);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Follow the smoke — southeast/i }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: /Follow the path — northwest/i }),
    ).toBeInTheDocument();
  });

  it('each fork button calls advanceScene with its own to_scene', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_FORK);
    mAdvanceScene.mockResolvedValue({
      from_scene: 'slice_everfree_fork',
      to_scene: 'slice_everfree_zecora',
    });
    render(<PlayPage />);

    const zecoraBtn = await screen.findByRole('button', { name: /Follow the smoke/i });
    await act(async () => {
      fireEvent.click(zecoraBtn);
    });
    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    expect(mAdvanceScene.mock.calls[0][0]).toBe('s1');
    expect(mAdvanceScene.mock.calls[0][1]).toMatchObject({ to_scene: 'slice_everfree_zecora' });
  });

  it('the OTHER fork branch calls advanceScene with the northwest to_scene', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_FORK);
    mAdvanceScene.mockResolvedValue({
      from_scene: 'slice_everfree_fork',
      to_scene: 'slice_everfree_ponyville',
    });
    render(<PlayPage />);

    const ponyvilleBtn = await screen.findByRole('button', { name: /Follow the path/i });
    await act(async () => {
      fireEvent.click(ponyvilleBtn);
    });
    await waitFor(() => expect(mAdvanceScene).toHaveBeenCalledTimes(1));
    expect(mAdvanceScene.mock.calls[0][1]).toMatchObject({ to_scene: 'slice_everfree_ponyville' });
  });
});

// ── C11: check affordance calls resolveCheck + narrates + refreshes grounding ─

describe('P1-PLAYFIX — check affordance (C11)', () => {
  it('D1a: rehydrating from grounding alone surfaces BOTH authored alternatives — no narrator invite required; inviting one only highlights it, the other stays available', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    // On bare load — no offer yet — both authored alternatives are already
    // player-invocable, since the scene authors both Stealth and Survival at
    // DC 12.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Attempt Stealth, DC 12/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Attempt Survival, DC 12/i })).toBeInTheDocument();
    });

    // Once Suzu invites the Stealth check, BOTH buttons remain — offering
    // one alternative does not hide the other, it only highlights the
    // invited one (see the aria-wiring describe block below for the
    // highlight assertion itself).
    await offerCheck('stealth', 12);
    expect(
      screen.getByRole('button', { name: /Attempt Stealth, DC 12/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Attempt Survival, DC 12/i }),
    ).toBeInTheDocument();
  });

  it('clicking a check button calls resolveCheck with the skill + actor_username, then refreshes grounding', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    mResolveCheck.mockResolvedValue({
      skill: 'survival',
      dc: 12,
      total: 15,
      success: true,
      flag_set: ['slipped_past_wolf'],
      mechanics: 'Survival check vs DC 12: rolled 15 — SUCCESS.',
      description: 'Survival check (DC 12): 15 — success.',
    });
    // Second grounding read (after the check resolves) reflects the auto-advance
    // that the engine may have performed — the client must learn this from the
    // REFRESH, not from the check response itself.
    mGetGrounding.mockResolvedValueOnce(GROUNDING_TIMBERWOLF).mockResolvedValue(GROUNDING_FORK);

    render(<PlayPage />);
    // D1a: the button is already player-invocable without an invite; this
    // call just exercises the offer path too (harmless — see the helper's
    // own doc comment) so the invite/highlight machinery stays covered.
    await offerCheck('survival', 12);
    const survivalBtn = await screen.findByRole('button', { name: /Attempt Survival/i });
    await act(async () => {
      fireEvent.click(survivalBtn);
    });

    await waitFor(() => expect(mResolveCheck).toHaveBeenCalledTimes(1));
    expect(mResolveCheck.mock.calls[0][0]).toBe('s1');
    expect(mResolveCheck.mock.calls[0][1]).toMatchObject({
      skill: 'survival',
      actor_username: 'leon',
    });

    // The result's description is surfaced in the log.
    await waitFor(() =>
      expect(screen.getByText('Survival check (DC 12): 15 — success.')).toBeInTheDocument(),
    );

    // getGrounding was called again (refreshGrounding) — and the scene
    // subsequently reflects the fork (proving the client learned the
    // auto-advance from the refresh, not the check response).
    await waitFor(() => expect(mGetGrounding.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Follow the smoke — southeast/i }),
      ).toBeInTheDocument(),
    );
  });

  it('does NOT render check affordances while combat is active', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    (dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>).mockResolvedValue(
      COMBAT_STATE_ACTIVE,
    );
    render(<PlayPage />);

    await screen.findByText(/mlp everfree leon|Mlp Everfree Leon/i).catch(() => null);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Attempt Stealth/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Attempt Survival/i })).not.toBeInTheDocument();
    });
  });

  it('does NOT render a check row when the scene offers none', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_FORK);
    render(<PlayPage />);
    await screen.findByRole('button', { name: /Follow the smoke/i });
    expect(screen.queryByRole('button', { name: /^Attempt/i })).not.toBeInTheDocument();
  });

  it('a 400 no_such_check refusal shows a toast and does not crash', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    const err = Object.assign(new Error('no_such_check'), {
      status: 400,
      body: { data: { reason: 'no_such_check' } },
    });
    mResolveCheck.mockRejectedValue(err);

    render(<PlayPage />);
    // D1a: not required for the button to appear (it's player-invocable on
    // load), but exercises the offer/highlight path alongside the refusal.
    await offerCheck('stealth', 12);
    const stealthBtn = await screen.findByRole('button', { name: /Attempt Stealth/i });
    await act(async () => {
      fireEvent.click(stealthBtn);
    });

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    // Page did not crash — the button is still present/interactable.
    expect(screen.getByRole('button', { name: /Attempt Stealth/i })).toBeInTheDocument();
  });

  it('F1/CAST-FAIL-SILENT: a non-400/503 refusal (e.g. 404 "Session not found.") surfaces the engine\'s own message, not the old blanket "Could not resolve that check."', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    const err = Object.assign(new Error('Session not found.'), {
      status: 404,
      body: { success: false, message: 'Session not found.', data: {} },
    });
    mResolveCheck.mockRejectedValue(err);

    render(<PlayPage />);
    const stealthBtn = await screen.findByRole('button', { name: /Attempt Stealth/i });
    await act(async () => {
      fireEvent.click(stealthBtn);
    });

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Session not found.' }),
      ),
    );
    expect(
      mockToast.mock.calls.some(
        (c) => (c[0] as { message?: string }).message === 'Could not resolve that check.',
      ),
    ).toBe(false);
  });
});

// ── F4/CHECK-DOUBLE-RENDER: flag-OFF regression pin ──────────────────────────
//
// DURABLE_GENERATION_ENABLED is false in this file (no lib/config mock
// override) — the legacy events poll (page.tsx's flag-OFF `poll`) only ever
// appends `dice_roll`/`x_card` kinds (see its own `.filter` call), so a
// check_resolved event re-delivered by that poll was NEVER double-rendered
// even before F4. This pins that invariant explicitly so a future change
// that widens the flag-OFF poll's kind filter — or that couples
// renderedSeqsRef's flag-ON-only seeding to the flag-OFF path — gets caught
// here rather than silently coupling the two poll paths.
describe('F4/CHECK-DOUBLE-RENDER — flag-OFF poll never re-appends check_resolved', () => {
  it('a resolved check with event_seq set renders once; a legacy poll tick carrying a duplicate-shaped check_resolved event does not double it', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    mResolveCheck.mockResolvedValue({
      skill: 'stealth',
      dc: 12,
      total: 15,
      success: true,
      flag_set: [],
      mechanics: 'd20+3 = 15 vs DC 12',
      description: 'Anomaly slips past the timberwolf, flag-OFF path.',
      event_seq: 99,
    });

    jest.useFakeTimers();
    try {
      render(<PlayPage />);
      const stealthBtn = await screen.findByRole('button', { name: /Attempt Stealth/i });
      await act(async () => {
        fireEvent.click(stealthBtn);
      });
      await act(async () => {
        await Promise.resolve();
      });

      const log = await screen.findByRole('log');
      expect(
        within(log).getAllByText(/slips past the timberwolf, flag-OFF path/i),
      ).toHaveLength(1);

      // Legacy poll tick: getSessionEventsRaw re-serves a check_resolved
      // event at the same seq — the flag-OFF poll's own kind filter
      // (dice_roll/x_card only) means this is a complete no-op regardless.
      mGetSessionEventsRaw.mockResolvedValue([
        {
          seq: 99,
          kind: 'check_resolved',
          actor: 'leon',
          created_at: '2026-07-14T09:01:00Z',
          data: {
            skill: 'stealth',
            dc: 12,
            success: true,
            description: 'Anomaly slips past the timberwolf, flag-OFF path.',
          },
        },
      ]);
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(
        within(log).getAllByText(/slips past the timberwolf, flag-OFF path/i),
      ).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── Iro Ship 2 CRITICAL-1: stranded focus after a resolved check / taken
// transition unmounts the just-clicked control ────────────────────────────────

describe('P1-PLAYFIX Ship 2 — stranded focus recovery (CRITICAL-1)', () => {
  it('the scene heading is a stable, programmatically-focusable anchor', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    const { container } = render(<PlayPage />);
    await waitFor(() =>
      expect(container.querySelector('[aria-label^="Scene:"]')).not.toBeNull(),
    );

    const sceneHead = container.querySelector('[aria-label^="Scene:"]');
    expect(sceneHead).not.toBeNull();
    expect(sceneHead).toHaveAttribute('tabindex', '-1');
  });

  it('moves focus to the scene heading when a resolved check unmounts its own button', async () => {
    mGetGrounding.mockResolvedValueOnce(GROUNDING_TIMBERWOLF).mockResolvedValue(GROUNDING_FORK);
    mResolveCheck.mockResolvedValue({
      skill: 'stealth',
      dc: 12,
      total: 15,
      success: true,
      flag_set: ['slipped_past_wolf'],
      mechanics: 'Stealth check vs DC 12: rolled 15 — SUCCESS.',
      description: 'Stealth check (DC 12): 15 — success.',
    });

    const { container } = render(<PlayPage />);
    // D1a: not required for the button to appear; exercises the invite path too.
    await offerCheck('stealth', 12);
    const stealthBtn = await screen.findByRole('button', { name: /Attempt Stealth/i });

    // The user is on the button (keyboard activation or a prior mouse click
    // both leave the browser's focus there) before the resolving click fires.
    act(() => stealthBtn.focus());
    expect(stealthBtn).toHaveFocus();

    await act(async () => {
      fireEvent.click(stealthBtn);
    });

    // The check row (and the stealth button with it) unmounts once grounding
    // refreshes to the checks-free fork scene — focus must land on the scene
    // heading, not get stranded on <body>.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Attempt Stealth/i })).not.toBeInTheDocument();
    });
    const sceneHead = container.querySelector('[aria-label^="Scene:"]');
    await waitFor(() => expect(document.activeElement).toBe(sceneHead));
  });

  it('moves focus to the scene heading when a taken transition unmounts its own button', async () => {
    mGetGrounding.mockResolvedValueOnce(GROUNDING_FORK).mockResolvedValue(GROUNDING_TIMBERWOLF);
    mAdvanceScene.mockResolvedValue({
      from_scene: 'slice_everfree_fork',
      to_scene: 'slice_everfree_timberwolf',
    });

    const { container } = render(<PlayPage />);
    const zecoraBtn = await screen.findByRole('button', { name: /Follow the smoke/i });

    act(() => zecoraBtn.focus());
    expect(zecoraBtn).toHaveFocus();

    await act(async () => {
      fireEvent.click(zecoraBtn);
    });

    // The transition row unmounts once grounding refreshes to a scene with no
    // transitions — focus must land on the scene heading, not <body>.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Follow the smoke/i })).not.toBeInTheDocument();
    });
    const sceneHead = container.querySelector('[aria-label^="Scene:"]');
    await waitFor(() => expect(document.activeElement).toBe(sceneHead));
  });
});

// ── Iro Ship 2 MAJOR-1 / MINOR-1 / MINOR-2 — aria wiring on the check row ────

describe('P1-PLAYFIX Ship 2 — check-note aria wiring + group labels', () => {
  const GROUNDING_WITH_NOTE: GroundingData = {
    ...GROUNDING_TIMBERWOLF,
    checks: [{ skill: 'stealth', dc: 12, note: 'Rustling underbrush might give you away.' }],
  };

  it('wires aria-describedby to a sr-only note span when the check has a note', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_NOTE);
    render(<PlayPage />);
    // Establishes the invite/highlight; the button itself is already
    // rendered pre-invite under D1a (single-check scene, so offering it
    // makes it THE offered check).
    await offerCheck('stealth', 12);

    const stealthBtn = await screen.findByRole('button', { name: /Attempt Stealth, DC 12/i });
    const describedBy = stealthBtn.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    // Because Suzu just offered this exact check, describedBy is a two-id
    // list (the offered sr-only span + the note sr-only span) rather than
    // the note alone. The note's own id must still be present in that list
    // and correctly wired.
    const noteEl = screen.getByText('Rustling underbrush might give you away.');
    expect((describedBy as string).split(' ')).toContain(noteEl.id);
    expect(noteEl).toHaveClass('sr-only');
  });

  it('references only the offered-check sr-only span (never a note id) when the check has no note', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    render(<PlayPage />);
    await offerCheck('stealth', 12);

    const stealthBtn = await screen.findByRole('button', { name: /Attempt Stealth, DC 12/i });
    // Since Suzu just offered this exact check, the button carries the
    // "Suzu invited this check" sr-only span, so describedBy is non-empty
    // even with no note authored. What must hold is that with no authored
    // note, nothing note-shaped is wired in.
    const describedBy = stealthBtn.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(describedBy).not.toMatch(/check-note-/);
    expect(screen.queryByText(/./, { selector: '[id^="check-note-"]' })).not.toBeInTheDocument();
  });

  it('groups the skill-check row and scene-transition row with role="group" + labels', async () => {
    mGetGrounding.mockResolvedValueOnce(GROUNDING_TIMBERWOLF);
    render(<PlayPage />);
    await offerCheck('stealth', 12);
    await screen.findByRole('button', { name: /Attempt Stealth/i });
    expect(screen.getByRole('group', { name: 'Skill check' })).toBeInTheDocument();
  });

  it('groups the scene-transition row with role="group" + label', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_FORK);
    render(<PlayPage />);
    await screen.findByRole('button', { name: /Follow the smoke/i });
    expect(screen.getByRole('group', { name: 'Scene transition' })).toBeInTheDocument();
  });
});

// ── TAV-CHECK-DISCOVERABILITY (Phase-1 #6, Leon "option A") ──────────────────
// A second, composer-adjacent placement of the SAME availableChecks the
// side-panel .checkWrap group renders — aria-hidden (tabIndex=-1 chips) so
// screen-reader/keyboard users see the check exactly once (the canonical
// .checkWrap group), while sighted/mouse/touch users get it in both places.
describe('TAV-CHECK-DISCOVERABILITY — composer-adjacent check chips (Phase-1 #6)', () => {
  it('renders an "Attempt {skill}, DC {dc}" chip near the composer whenever the scene has authored checks, alongside (not instead of) the side-panel group', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    await waitFor(() => {
      // aria-hidden={true} elements are excluded from getByRole by default —
      // querying with {hidden: true} surfaces the duplicate chip alongside
      // the canonical accessible button.
      expect(
        screen.getAllByRole('button', { name: /Attempt Stealth, DC 12/i, hidden: true }).length,
      ).toBe(2);
      expect(
        screen.getAllByRole('button', { name: /Attempt Survival, DC 12/i, hidden: true }).length,
      ).toBe(2);
    });

    // The DEFAULT (accessibility-tree) query still finds exactly ONE of each
    // — the side-panel .checkWrap button — proving the chip duplicate is
    // genuinely excluded from the a11y tree, not merely visually offset.
    expect(screen.getAllByRole('button', { name: /Attempt Stealth, DC 12/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Attempt Survival, DC 12/i })).toHaveLength(1);
  });

  it('the composer-adjacent chip is aria-hidden and unreachable by Tab (tabIndex -1), unlike the side-panel button', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    const { container } = render(<PlayPage />);
    await screen.findByRole('textbox');

    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /Attempt Stealth, DC 12/i, hidden: true }),
      ).toHaveLength(2),
    );
    const chipsWrap = container.querySelector('[aria-hidden="true"] button');
    expect(chipsWrap).not.toBeNull();
    // Walk up from the hidden chip button to confirm its ancestor wrapper
    // (not the button itself) carries aria-hidden.
    const hiddenAncestor = chipsWrap?.closest('[aria-hidden="true"]');
    expect(hiddenAncestor).not.toBeNull();
    expect(chipsWrap).toHaveAttribute('tabindex', '-1');

    // The canonical side-panel button has NO tabindex override (a normal,
    // fully keyboard-reachable button).
    const canonicalBtn = screen.getByRole('button', { name: /Attempt Stealth, DC 12/i });
    expect(canonicalBtn).not.toHaveAttribute('tabindex');
  });

  it('clicking the composer-adjacent chip invokes the SAME resolveCheck handler as the side-panel button', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    mResolveCheck.mockResolvedValue({
      skill: 'survival',
      dc: 12,
      total: 15,
      success: true,
      flag_set: [],
      mechanics: 'Survival check vs DC 12: rolled 15 — SUCCESS.',
      description: 'Survival check (DC 12): 15 — success.',
    });

    render(<PlayPage />);
    await screen.findByRole('textbox');

    const chips = await screen.findAllByRole('button', {
      name: /Attempt Survival, DC 12/i,
      hidden: true,
    });
    expect(chips).toHaveLength(2);
    // The SECOND match (queried in DOM order) is the composer-adjacent chip
    // — it lives after the side-panel group in this component's render order.
    const composerChip = chips[1];

    await act(async () => {
      fireEvent.click(composerChip);
    });

    await waitFor(() => expect(mResolveCheck).toHaveBeenCalledTimes(1));
    expect(mResolveCheck.mock.calls[0][0]).toBe('s1');
    expect(mResolveCheck.mock.calls[0][1]).toMatchObject({
      skill: 'survival',
      actor_username: 'leon',
    });
    await waitFor(() =>
      expect(screen.getByText('Survival check (DC 12): 15 — success.')).toBeInTheDocument(),
    );
  });

  it('renders NO composer-adjacent chip when the scene offers no checks', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_FORK);
    render(<PlayPage />);
    await screen.findByRole('button', { name: /Follow the smoke/i });
    expect(screen.queryAllByRole('button', { name: /^Attempt/i, hidden: true })).toHaveLength(0);
  });

  it('renders NO composer-adjacent chip during active combat (same availableChecks gate, untouched)', async () => {
    mGetSession.mockResolvedValue(SESSION_WITH_COMBAT);
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    (dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>).mockResolvedValue(
      COMBAT_STATE_ACTIVE,
    );
    render(<PlayPage />);

    await screen.findByRole('textbox');
    await waitFor(() => {
      expect(
        screen.queryAllByRole('button', { name: /Attempt Stealth/i, hidden: true }),
      ).toHaveLength(0);
      expect(
        screen.queryAllByRole('button', { name: /Attempt Survival/i, hidden: true }),
      ).toHaveLength(0);
    });
  });
});

// Iro MINOR-1 (P1-PLAYFIX-2 gate fix): key / noteId / offeredId collided when
// a scene authors two checks with the SAME skill (different DC) — e.g. a
// bargain-vs-intimidate Persuasion beat offered at two DCs. Keyed by
// `${skill}-${dc}` now.
describe('P1-PLAYFIX Ship 2 — check id uniqueness (Iro MINOR-1)', () => {
  const GROUNDING_SAME_SKILL_TWO_DCS: GroundingData = {
    ...GROUNDING_TIMBERWOLF,
    checks: [
      { skill: 'stealth', dc: 12, note: 'The easy route.' },
      { skill: 'stealth', dc: 18, note: 'The bold, faster route.' },
    ],
  };

  it('renders two distinct buttons for the same skill at different DCs, each with its own unique note id', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_SAME_SKILL_TWO_DCS);
    render(<PlayPage />);
    // D1a: both authored DCs for this skill are already rendered pre-invite;
    // offering the skill (dc is validated engine-side, not by the offer)
    // additionally highlights both as offered (see the assertion below).
    await offerCheck('stealth', 12);

    const dc12Btn = await screen.findByRole('button', { name: /Attempt Stealth, DC 12/i });
    const dc18Btn = await screen.findByRole('button', { name: /Attempt Stealth, DC 18/i });
    expect(dc12Btn).not.toBe(dc18Btn);

    const dc12DescribedBy = dc12Btn.getAttribute('aria-describedby');
    const dc18DescribedBy = dc18Btn.getAttribute('aria-describedby');
    expect(dc12DescribedBy).toBeTruthy();
    expect(dc18DescribedBy).toBeTruthy();
    // The core of the fix: the two ids must NOT collide.
    expect(dc12DescribedBy).not.toBe(dc18DescribedBy);

    // Both DC12 and DC18 share the 'stealth' skill, so both are "offered"
    // once Suzu invites Stealth — describedBy is now a two-id list (offered
    // span + note span) per button. Pull out the note id specifically to
    // confirm it still resolves to the button's own note.
    const dc12NoteId = (dc12DescribedBy as string).split(' ').find((id) => id.startsWith('check-note-'));
    const dc18NoteId = (dc18DescribedBy as string).split(' ').find((id) => id.startsWith('check-note-'));
    expect(dc12NoteId).not.toBe(dc18NoteId);

    expect(document.getElementById(dc12NoteId as string)).toHaveTextContent(
      'The easy route.',
    );
    expect(document.getElementById(dc18NoteId as string)).toHaveTextContent(
      'The bold, faster route.',
    );
  });
});

// D1a core behavior (Leon, product decision, 2026-07-19): the direct on/off
// proof that an authored check is a player-invoked affordance from the
// moment the scene loads — a narrator invite is never required for
// visibility, only for the highlight. This describe block replaces the
// pre-D1a "DM-gated core behavior" contract this file used to protect.
describe('P1-PLAYFIX-2 / D1a — authored checks are player-invoked, not DM-gated', () => {
  it('renders "Attempt {skill}" for every authored check as soon as the scene loads, with no narrator offer at all', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    render(<PlayPage />);
    await screen.findByRole('textbox');

    // Authored (grounding.checks has stealth + survival) and already
    // player-invocable — no beat, no offer, nothing narrated yet.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Attempt Stealth, DC 12/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Attempt Survival, DC 12/i })).toBeInTheDocument();
    });
  });

  it('highlights only the skill Suzu invites, without hiding the sibling authored check', async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_TIMBERWOLF);
    render(<PlayPage />);
    await offerCheck('stealth', 12);

    const stealthBtn = await screen.findByRole('button', { name: /Attempt Stealth, DC 12/i });
    const survivalBtn = await screen.findByRole('button', { name: /Attempt Survival, DC 12/i });
    // Only the invited skill carries the "Suzu invited this check" sr-only
    // span (the highlight signal); the sibling remains a normal, available
    // (non-highlighted) authored check.
    expect(
      within(stealthBtn).getByText('Suzu invited this check.'),
    ).toBeInTheDocument();
    expect(
      within(survivalBtn).queryByText('Suzu invited this check.'),
    ).not.toBeInTheDocument();
  });
});

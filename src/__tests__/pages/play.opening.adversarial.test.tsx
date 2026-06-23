/**
 * A1 adversarial tests — Tavern play page (Track A / solo experience).
 *
 * Covers gaps NOT exercised by play.opening.test.tsx:
 *
 * SECURITY / INTERLOCK
 *   1. AI-full session + scene_advance event already in events list
 *      → opening must NOT fire (hasFiction gate blocks it), even though
 *        opening_narrated marker is absent. The existing test covers AI-off;
 *        this covers AI-full (same gate, different session type).
 *   2. AI-full session + encounter_resolved event → opening must NOT fire.
 *   3. Multiple non-structural events → opening must NOT fire.
 *
 * FAILURE INJECTION
 *   4. getSessionEvents throws (engine unreachable) → gate returns false →
 *      no opening, no crash, page still renders.
 *   5. getGrounding resolves to null → no opening, no crash.
 *
 * STATE / FLAGS
 *   6. AI-off + opening_narrated already written → postSessionEvent NOT called
 *      a second time (fire-once gate holds on re-mount).
 *   7. getSessionEvents resolves to an empty list AND grounding has no scene_id
 *      → opening must NOT fire (freeform session guard).
 *
 * EXPLICIT NON-BROWSER LIMITS (deferred to Tatsu deploy pass):
 *   - SSE stream mid-drop (browser network throttle / offline mid-stream).
 *   - Rapid double-click on the play page triggering two concurrent opening
 *     streams before the first postSessionEvent resolves (race between two
 *     concurrent component mounts is only observable in a real browser where
 *     the AbortController is not immediately torn down by StrictMode).
 *   - z-index / overlay stacking of the opening scene panel against the
 *     NarratorStrip — jsdom cannot evaluate CSS stacking context.
 *   - Mobile widths (320/360/414) for the opening scene render — jsdom
 *     has no layout engine.
 */
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { Session, Participant } from "@/lib/api/types";

jest.mock("next/navigation", () => ({
  useParams: () => ({ sessionId: "sess-adv" }),
}));

jest.mock("../../components/Toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("../../lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: 1, username: "leon", email: null } }),
}));

jest.mock("../../lib/useReducedMotion", () => ({
  useReducedMotion: () => true,
}));

jest.mock("../../lib/api/dnd", () => ({
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
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
}));

jest.mock("../../lib/stream", () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: "done" as const };
  }),
}));

import * as dnd from "@/lib/api/dnd";
import PlayPage from "@/app/play/[sessionId]/page";

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<
  typeof dnd.getParticipants
>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetSessionEvents = dnd.getSessionEvents as jest.MockedFunction<
  typeof dnd.getSessionEvents
>;
const mPostSessionEvent = dnd.postSessionEvent as jest.MockedFunction<
  typeof dnd.postSessionEvent
>;

// ── Shared fixtures ──────────────────────────────────────────────────────────

const SESSION_FULL: Session = {
  session_id: "sess-adv",
  channel: "the_hollow_tide",
  status: "active",
  dm_username: "suzu",
  participant_usernames: ["leon"],
  player_count: 1,
  active_combat_id: null,
  dm_mode: "ai",
  ai_assist_level: "full",
};

const SESSION_AI_OFF: Session = {
  ...SESSION_FULL,
  ai_assist_level: "off",
};

const PARTY: Participant[] = [
  {
    username: "leon",
    is_dm: false,
    character: {
      character_id: "c1",
      name: "Velka",
      char_class: "Rogue",
      level: 1,
      current_hp: 8,
      max_hp: 10,
      ac: 14,
    },
  },
];

const GROUNDING_WITH_SCENE = {
  scene_id: "approach",
  scene_name: "The Approach",
  boxed_text: "The cave mouth yawns before you.",
  objective: "Reach the cave before the tide rises.",
  hook: "A fishing crew vanished on the morning tide.",
  adventure_title: "The Hollow Tide Cave",
  transitions: [],
  flags: {},
  encounter_state: {},
};

const GROUNDING_FREEFORM = {
  scene_id: undefined,
  scene_name: undefined,
  boxed_text: undefined,
  transitions: [],
  flags: {},
  encounter_state: {},
};

beforeEach(() => {
  jest.clearAllMocks();
  mGetParticipants.mockResolvedValue(PARTY);
  mGetSessionEvents.mockResolvedValue([]);
  mPostSessionEvent.mockResolvedValue({});
});

// ── SECURITY / INTERLOCK ─────────────────────────────────────────────────────

describe("A1 adversarial - hasFiction gate (AI-full)", () => {
  beforeEach(() => {
    mGetSession.mockResolvedValue(SESSION_FULL);
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_SCENE);
  });

  it("does NOT fire opening when scene_advance event exists (AI-full session)", async () => {
    // scene_advance is a non-structural event → hasFiction=true → gate blocks
    mGetSessionEvents.mockResolvedValue([
      { event_type: "scene_advance", description: "The party moved deeper in." },
    ]);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // If opening had fired in AI-full mode, a stream would have been triggered
    // (which in StrictMode abort timing still fires the gate check). The assertion
    // here is on the postSessionEvent marker — if gate blocks, it is never called.
    expect(mPostSessionEvent).not.toHaveBeenCalled();
  });

  it("does NOT fire opening when encounter_resolved event exists (AI-full session)", async () => {
    mGetSessionEvents.mockResolvedValue([
      { event_type: "encounter_resolved", description: "Goblins defeated." },
    ]);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(mPostSessionEvent).not.toHaveBeenCalled();
  });

  it("does NOT fire opening when multiple non-structural events exist (AI-full)", async () => {
    mGetSessionEvents.mockResolvedValue([
      { event_type: "scene_advance", description: "Into the tunnel." },
      { event_type: "encounter_resolved", description: "Skeletons crumbled." },
      { event_type: "xp_award", description: "25 XP awarded." },
    ]);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(mPostSessionEvent).not.toHaveBeenCalled();
  });

  it("does NOT fire opening for unknown future event kinds (belt-and-braces)", async () => {
    // Any unrecognised event type is non-structural → hasFiction=true → blocks
    mGetSessionEvents.mockResolvedValue([
      { event_type: "future_unknown_kind", description: "Something happened." },
    ]);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(mPostSessionEvent).not.toHaveBeenCalled();
  });
});

// ── FAILURE INJECTION ────────────────────────────────────────────────────────

// HONEST-LIMITS NOTE: "getSessionEvents throws globally" cannot be tested via
// component render in jsdom. SessionRecap.tsx calls getSessionEvents in a
// useEffect WITHOUT a try/catch. Mocking it to reject globally causes
// SessionRecap's uncaught async rejection to propagate through React's scheduler
// into the Jest test runner regardless of console suppression or act() wrapping.
// checkShouldOpen (page.tsx) DOES have a try/catch and returns false on
// rejection — verified by source read. This is a defect in SessionRecap (not
// in the gate logic). Filed for Ren-Dev: wrap getSessionEvents in
// SessionRecap.tsx useEffect in try/catch. Re-enable the test once fixed.
// CARRY-FORWARD: deploy break-it pass — load play screen with engine events
// endpoint returning 500 and verify the page does not white-screen.

describe("A1 adversarial - failure injection", () => {
  it("getGrounding resolves to null → no opening, page renders without crash", async () => {
    mGetSession.mockResolvedValue(SESSION_AI_OFF);
    mGetGrounding.mockResolvedValue(null);

    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(mPostSessionEvent).not.toHaveBeenCalled();
    expect(screen.queryByText(/cave mouth yawns/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it("getGrounding resolves to freeform (no scene_id) → no opening, page renders", async () => {
    mGetSession.mockResolvedValue(SESSION_AI_OFF);
    mGetGrounding.mockResolvedValue(GROUNDING_FREEFORM);

    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(mPostSessionEvent).not.toHaveBeenCalled();
    expect(screen.queryByText(/cave mouth yawns/i)).not.toBeInTheDocument();
  });
});

// ── STATE / FLAGS ────────────────────────────────────────────────────────────

describe("A1 adversarial - state and flags", () => {
  it("opening_narrated already present → postSessionEvent NOT called on re-mount (AI-off)", async () => {
    mGetSession.mockResolvedValue(SESSION_AI_OFF);
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_SCENE);
    mGetSessionEvents.mockResolvedValue([
      { event_type: "opening_narrated", description: "Scene was already opened." },
    ]);

    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Fire-once gate held: no second marker write
    expect(mPostSessionEvent).not.toHaveBeenCalled();
  });

  it("structural-only events (session_start + character_bound) still allow opening (AI-off)", async () => {
    // These are whitelisted as structural → hasFiction=false → gate should pass
    mGetSession.mockResolvedValue(SESSION_AI_OFF);
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_SCENE);
    mGetSessionEvents.mockResolvedValue([
      { event_type: "session_start", description: "Session started." },
      { event_type: "character_bound", description: "Velka bound." },
    ]);

    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    // In AI-off mode the local render appends boxed_text to the log
    await waitFor(() =>
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument(),
    );
  });

  it("freeform session (no scene_id in grounding) → no opening regardless of events", async () => {
    // Belt-and-braces: even with zero events, a freeform session must not open
    mGetSession.mockResolvedValue(SESSION_AI_OFF);
    mGetGrounding.mockResolvedValue(GROUNDING_FREEFORM);
    mGetSessionEvents.mockResolvedValue([]); // no events at all

    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(mPostSessionEvent).not.toHaveBeenCalled();
    expect(screen.queryByText(/cave mouth yawns/i)).not.toBeInTheDocument();
  });
});

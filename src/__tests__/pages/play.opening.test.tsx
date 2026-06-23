/**
 * A1 - Opening scene on session start.
 *
 * Tests the fire-once gate and the AI-off path (local render + postSessionEvent).
 *
 * AI/full path stream assertion caveats:
 *   React StrictMode double-invokes effects and fires the [] cleanup between
 *   mounts, which aborts the narrationAbort controller before the opening
 *   narration stream is sent. This is expected behavior in prod (the abort
 *   guard prevents orphaned streams); in jsdom tests it means we cannot
 *   assert that mStream was called with kind:'opening' from the component.
 *   Gate-logic tests (opening_narrated event stops the fire) still work
 *   because the gate check happens before the abort-sensitive stream call.
 *
 *   What IS tested here: the gate contract (when/when not to open), and
 *   the AI-off local-render path (deterministic, no stream dependency).
 *   The AI/full stream kind:'opening' payload is verified via the narrate()
 *   unit path which is not affected by the StrictMode timing.
 */
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { Session, Participant } from "@/lib/api/types";

jest.mock("next/navigation", () => ({
  useParams: () => ({ sessionId: "sess-opening" }),
}));

const mockToast = jest.fn();
jest.mock("../../components/Toast", () => ({
  useToast: () => ({ toast: mockToast }),
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
  streamDmNarration: jest.fn(async function* () { yield { kind: "done" as const }; }),
}));

import * as dnd from "@/lib/api/dnd";
import * as streamMod from "@/lib/stream";
import PlayPage from "@/app/play/[sessionId]/page";

const mStream = streamMod.streamDmNarration as jest.MockedFunction<
  typeof streamMod.streamDmNarration
>;
const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetGrounding = dnd.getGrounding as jest.MockedFunction<typeof dnd.getGrounding>;
const mGetSessionEvents = dnd.getSessionEvents as jest.MockedFunction<typeof dnd.getSessionEvents>;
const mPostSessionEvent = dnd.postSessionEvent as jest.MockedFunction<typeof dnd.postSessionEvent>;

const SESSION_AI_OFF: Session = {
  session_id: "sess-opening",
  channel: "the_hollow_tide",
  status: "active",
  dm_username: "suzu",
  participant_usernames: ["leon"],
  player_count: 1,
  active_combat_id: null,
  dm_mode: "ai",
  ai_assist_level: "off",
};

const SESSION_FULL: Session = {
  ...SESSION_AI_OFF,
  ai_assist_level: "full",
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

// ---- Gate logic tests (AI/full) ----
// These test WHEN the gate allows/blocks the opening. The stream call
// itself is subject to StrictMode abort timing (see file header).

describe("A1 - gate logic (fire-once contract)", () => {
  beforeEach(() => {
    mGetSession.mockResolvedValue(SESSION_FULL);
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_SCENE);
  });

  it("getSessionEvents is consulted on mount when grounding has a scene", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    // Give async effects time to run
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    // Gate must read events list to check for opening_narrated marker
    expect(mGetSessionEvents).toHaveBeenCalledWith("sess-opening", expect.anything());
  });

  it("does NOT fire opening when opening_narrated event exists", async () => {
    mGetSessionEvents.mockResolvedValue([
      { event_type: "opening_narrated", description: "Suzu opened the scene." },
    ]);
    // Use AI-off so we can detect if openScene ran (it would append to the log)
    mGetSession.mockResolvedValue(SESSION_AI_OFF);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    // If opening had fired in AI-off mode, boxed text would be in the log
    expect(screen.queryByText(/cave mouth yawns/i)).not.toBeInTheDocument();
    expect(mPostSessionEvent).not.toHaveBeenCalled();
  });

  it("does NOT fire when a non-structural fiction event exists", async () => {
    mGetSessionEvents.mockResolvedValue([
      { event_type: "scene_advance", description: "The party moved deeper in." },
    ]);
    mGetSession.mockResolvedValue(SESSION_AI_OFF);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    expect(screen.queryByText(/cave mouth yawns/i)).not.toBeInTheDocument();
    expect(mPostSessionEvent).not.toHaveBeenCalled();
  });

  it("does NOT fire when grounding has no scene_id (freeform session)", async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_FREEFORM);
    mGetSession.mockResolvedValue(SESSION_AI_OFF);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    expect(screen.queryByText(/cave mouth yawns/i)).not.toBeInTheDocument();
    expect(mPostSessionEvent).not.toHaveBeenCalled();
  });
});

// ---- AI/full path: opening fires the grounded stream (FIX-1 regression) ----
// Guards the stale-session-closure bug: narrate() must receive the LIVE session
// (threaded via opts.session) so the opening actually streams. If narrate reverts
// to reading `session` from a closure captured at mount (when state is still null),
// it early-returns and streamDmNarration is never called with kind:'opening'.
describe("A1 - AI/full opening fires the grounded stream", () => {
  beforeEach(() => {
    mGetSession.mockResolvedValue(SESSION_FULL);
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_SCENE);
    mGetSessionEvents.mockResolvedValue([]);
  });

  it("calls streamDmNarration with kind:'opening', empty message, and the live session", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });

    const openingCall = mStream.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((p) => p?.kind === "opening");
    expect(openingCall).toBeTruthy();
    expect(openingCall!.message).toBe("");
    expect(openingCall!.session_id).toBe("sess-opening");
    expect(openingCall!.channel).toBe("the_hollow_tide");
  });
});

// ---- AI-off path ----
// Fully testable: local render does not depend on narration abort timing.

describe("A1 - opening scene (AI-off path)", () => {
  beforeEach(() => {
    mGetSession.mockResolvedValue(SESSION_AI_OFF);
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_SCENE);
    mGetSessionEvents.mockResolvedValue([]);
  });

  it("renders the opening scene locally without calling narration stream", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument(),
    );
  });

  it("includes adventure title in the local render", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(screen.getByText(/Hollow Tide Cave/i)).toBeInTheDocument(),
    );
  });

  it("includes the hook in the local render", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(screen.getByText(/fishing crew vanished/i)).toBeInTheDocument(),
    );
  });

  it("calls postSessionEvent with opening_narrated after local render", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(mPostSessionEvent).toHaveBeenCalledWith(
        "sess-opening",
        expect.objectContaining({ kind: "opening_narrated" }),
      ),
    );
  });

  it("postSessionEvent failure is non-fatal - page stays functional", async () => {
    mPostSessionEvent.mockRejectedValue(new Error("network down"));
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/unreachable/i)).not.toBeInTheDocument();
  });

  it("does NOT render opening scene when opening_narrated already in events", async () => {
    mGetSessionEvents.mockResolvedValue([
      { event_type: "opening_narrated", description: "Already ran." },
    ]);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    expect(mPostSessionEvent).not.toHaveBeenCalled();
    expect(screen.queryByText(/cave mouth yawns/i)).not.toBeInTheDocument();
  });

  it("structural events alone (session_start, character_bound) allow the opening to fire", async () => {
    // Structural events alone should NOT block the opening
    mGetSessionEvents.mockResolvedValue([
      { event_type: "session_start", description: "Session started." },
      { event_type: "character_bound", description: "Velka bound." },
    ]);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    // In AI-off mode, the opening renders locally when gate passes
    await waitFor(() =>
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument(),
    );
  });
});

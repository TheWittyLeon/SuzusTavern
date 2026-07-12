/**
 * P1-READALOUD — Opening scene on session start.
 *
 * The verbatim read-aloud path (Option A) collapses the old AI-on and AI-off
 * branches into a single deterministic render: every session type (AI, AI-off,
 * human-DM) renders the authored boxed_text block instantly, then optional NPC
 * opening lines, then writes the opening_narrated marker. No LLM call on open.
 *
 * What is tested:
 *   - Gate contract: when/when not to open (openingFiredRef + durable event).
 *   - read_aloud row appears with byte-identical boxed_text for AI sessions.
 *   - read_aloud row appears for AI-off sessions (same path).
 *   - opening_lines are rendered as read_aloud_line rows after the block.
 *   - Zero opening_lines → no NPC dialogue rows appended.
 *   - opening_narrated marker written with source:'read_aloud_verbatim'.
 *   - postSessionEvent failure is non-fatal.
 *   - narrate() / streamDmNarration is NOT called on open (no AI opening call).
 *   - Idempotent: opening_narrated already in events → gate blocks; no re-render.
 *   - Structural events alone (session_start, character_bound) allow the opening.
 *
 * StrictMode abort note: React StrictMode double-invokes effects and tears down
 * the AbortController between mounts. The openingFiredRef latch prevents double-
 * fire within one mount. The durable marker prevents re-fire across remounts.
 * Both paths are exercised below.
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
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
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
  // DDX-22 Phase 3: JournalPane is now unconditionally mounted on the play
  // page (only its CSS visibility/inert state is gated by journalVisible —
  // see page.tsx's <aside id="play-pane-journal">), so every render of this
  // page fires a getSessionNotes() GET regardless of whether the journal is
  // ever opened. Default to "no note yet" so this suite stays hermetic.
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
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

// ── Fixtures ─────────────────────────────────────────────────────────────────

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

const SESSION_HUMAN_DM: Session = {
  ...SESSION_AI_OFF,
  dm_mode: "human",
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
  opening_lines: [],
  transitions: [],
  flags: {},
  encounter_state: {},
};

const GROUNDING_WITH_OPENING_LINES = {
  ...GROUNDING_WITH_SCENE,
  opening_lines: [
    {
      npc_ref: "mira_fisher",
      line: "Careful — the tide's already turning.",
      speaker_display_name: "Mira",
    },
    {
      npc_ref: "guard_holt",
      line: "You best move quick.",
      speaker_display_name: "Guard Holt",
    },
  ],
};

const GROUNDING_FREEFORM = {
  scene_id: undefined,
  scene_name: undefined,
  boxed_text: undefined,
  opening_lines: [],
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

// ── Gate logic ────────────────────────────────────────────────────────────────

describe("P1-READALOUD gate logic (fire-once contract)", () => {
  beforeEach(() => {
    mGetSession.mockResolvedValue(SESSION_FULL);
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_SCENE);
  });

  it("getSessionEvents is consulted on mount when grounding has a scene", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(mGetSessionEvents).toHaveBeenCalledWith("sess-opening", expect.anything());
  });

  it("does NOT fire opening when opening_narrated event exists", async () => {
    mGetSessionEvents.mockResolvedValue([
      { event_type: "opening_narrated", description: "Scene already opened." },
    ]);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    expect(screen.queryByText(/cave mouth yawns/i)).not.toBeInTheDocument();
    expect(mPostSessionEvent).not.toHaveBeenCalled();
  });

  it("does NOT fire when a non-structural fiction event exists", async () => {
    mGetSessionEvents.mockResolvedValue([
      { event_type: "scene_advance", description: "The party moved deeper in." },
    ]);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    expect(screen.queryByText(/cave mouth yawns/i)).not.toBeInTheDocument();
    expect(mPostSessionEvent).not.toHaveBeenCalled();
  });

  it("does NOT fire when grounding has no scene_id (freeform session)", async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_FREEFORM);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });

    expect(screen.queryByText(/cave mouth yawns/i)).not.toBeInTheDocument();
    expect(mPostSessionEvent).not.toHaveBeenCalled();
  });
});

// ── Verbatim read-aloud render (AI/full path) ─────────────────────────────────

describe("P1-READALOUD renders verbatim for AI/full sessions", () => {
  beforeEach(() => {
    mGetSession.mockResolvedValue(SESSION_FULL);
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_SCENE);
    mGetSessionEvents.mockResolvedValue([]);
  });

  it("renders boxed_text verbatim as a read_aloud row — no LLM stream on open", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument(),
    );

    // The opening_narrated marker must also be written client-side.
    await waitFor(() =>
      expect(mPostSessionEvent).toHaveBeenCalledWith(
        "sess-opening",
        expect.objectContaining({ kind: "opening_narrated" }),
      ),
    );
  });

  it("does NOT call streamDmNarration for the opening (no AI opening call)", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });

    // No stream call should be made with kind:'opening' — the verbatim path
    // replaces it. (A subsequent player action would fire a normal beat, which
    // is not triggered here since no user interaction occurs.)
    const openingCall = mStream.mock.calls
      .map((c) => c[0] as unknown as Record<string, unknown>)
      .find((p) => p?.kind === "opening");
    expect(openingCall).toBeUndefined();
  });

  it("includes adventure title in the read-aloud block", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(screen.getByText(/Hollow Tide Cave/i)).toBeInTheDocument(),
    );
  });

  it("includes the hook in the read-aloud block", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(screen.getByText(/fishing crew vanished/i)).toBeInTheDocument(),
    );
  });

  it("writes opening_narrated with source:'read_aloud_verbatim'", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(mPostSessionEvent).toHaveBeenCalledWith(
        "sess-opening",
        expect.objectContaining({
          kind: "opening_narrated",
          data: expect.objectContaining({ source: "read_aloud_verbatim" }),
        }),
      ),
    );
  });
});

// ── Verbatim read-aloud render (AI-off path) ──────────────────────────────────

describe("P1-READALOUD renders verbatim for AI-off sessions (same path)", () => {
  beforeEach(() => {
    mGetSession.mockResolvedValue(SESSION_AI_OFF);
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_SCENE);
    mGetSessionEvents.mockResolvedValue([]);
  });

  it("renders boxed_text verbatim without calling narration stream", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument(),
    );
    expect(mStream).not.toHaveBeenCalled();
  });

  it("writes opening_narrated with source:'read_aloud_verbatim' on AI-off", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(mPostSessionEvent).toHaveBeenCalledWith(
        "sess-opening",
        expect.objectContaining({
          kind: "opening_narrated",
          data: expect.objectContaining({ source: "read_aloud_verbatim" }),
        }),
      ),
    );
  });

  it("postSessionEvent failure is non-fatal — page stays functional", async () => {
    mPostSessionEvent.mockRejectedValue(new Error("network down"));
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/unreachable/i)).not.toBeInTheDocument();
  });

  it("does NOT render opening when opening_narrated already in events", async () => {
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
    mGetSessionEvents.mockResolvedValue([
      { event_type: "session_start", description: "Session started." },
      { event_type: "character_bound", description: "Velka bound." },
    ]);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument(),
    );
  });
});

// ── Human-DM path parity ──────────────────────────────────────────────────────

describe("P1-READALOUD renders verbatim for human-DM sessions", () => {
  beforeEach(() => {
    mGetSession.mockResolvedValue(SESSION_HUMAN_DM);
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_SCENE);
    mGetSessionEvents.mockResolvedValue([]);
  });

  it("renders boxed_text verbatim for a human-DM session without calling LLM", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument(),
    );
    expect(mStream).not.toHaveBeenCalled();
  });

  it("writes opening_narrated marker on human-DM session", async () => {
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(mPostSessionEvent).toHaveBeenCalledWith(
        "sess-opening",
        expect.objectContaining({ kind: "opening_narrated" }),
      ),
    );
  });
});

// ── opening_lines rendering ───────────────────────────────────────────────────

describe("P1-READALOUD opening_lines — optional NPC dialogue", () => {
  beforeEach(() => {
    mGetSession.mockResolvedValue(SESSION_AI_OFF);
    mGetSessionEvents.mockResolvedValue([]);
  });

  it("renders each opening_line as a read_aloud_line row with speaker and dialogue", async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_OPENING_LINES);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    // Both NPC lines should appear verbatim
    await waitFor(() => {
      expect(screen.getByText(/tide's already turning/i)).toBeInTheDocument();
      expect(screen.getByText(/You best move quick/i)).toBeInTheDocument();
    });
    // Speaker names should appear
    await waitFor(() => {
      expect(screen.getByText("Mira")).toBeInTheDocument();
      expect(screen.getByText("Guard Holt")).toBeInTheDocument();
    });
  });

  it("does NOT render NPC dialogue rows when opening_lines is empty", async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_SCENE); // opening_lines: []
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    // Wait for boxed_text to confirm open fired
    await waitFor(() =>
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument(),
    );

    // No NPC speaker names from the fixture should be present
    expect(screen.queryByText("Mira")).not.toBeInTheDocument();
    expect(screen.queryByText("Guard Holt")).not.toBeInTheDocument();
  });

  it("renders boxed_text block first, then opening_lines after", async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_OPENING_LINES);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() => {
      expect(screen.getByText(/cave mouth yawns/i)).toBeInTheDocument();
      expect(screen.getByText(/tide's already turning/i)).toBeInTheDocument();
    });

    // Verify ordering: boxed_text element comes before the NPC line element in DOM
    const boxedEl = screen.getByText(/cave mouth yawns/i);
    const lineEl = screen.getByText(/tide's already turning/i);
    expect(
      boxedEl.compareDocumentPosition(lineEl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opening_narrated marker is still written when opening_lines are present", async () => {
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_OPENING_LINES);
    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");

    await waitFor(() =>
      expect(mPostSessionEvent).toHaveBeenCalledWith(
        "sess-opening",
        expect.objectContaining({ kind: "opening_narrated" }),
      ),
    );
  });
});

// ── Idempotency across remounts ───────────────────────────────────────────────

describe("P1-READALOUD idempotency — re-mount does not re-fire", () => {
  it("does NOT re-append read-aloud block if opening_narrated already exists for the session", async () => {
    mGetSession.mockResolvedValue(SESSION_AI_OFF);
    mGetGrounding.mockResolvedValue(GROUNDING_WITH_SCENE);
    mGetSessionEvents.mockResolvedValue([
      { event_type: "opening_narrated", description: "Scene was opened before." },
    ]);

    render(<PlayPage />);
    await screen.findByText("The Hollow Tide");
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });

    expect(mPostSessionEvent).not.toHaveBeenCalled();
    expect(screen.queryByText(/cave mouth yawns/i)).not.toBeInTheDocument();
  });
});

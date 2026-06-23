/**
 * A2 - Real character-derived quick-checks.
 *
 * Tests that the DiceTray receives real skill modifiers from the bound
 * character's sheet, that DM-only (no character) hides quick-checks, and
 * that a sheet-fetch failure degrades gracefully (no NaN, no crash).
 */
import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { Session, Participant } from "@/lib/api/types";

jest.mock("next/navigation", () => ({
  useParams: () => ({ sessionId: "sess-a2" }),
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
  getCharacterSheet: jest.fn(),
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
import PlayPage from "@/app/play/[sessionId]/page";

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetCharacterSheet = dnd.getCharacterSheet as jest.MockedFunction<typeof dnd.getCharacterSheet>;

const SESSION: Session = {
  session_id: "sess-a2",
  channel: "test_table",
  status: "active",
  dm_username: "suzu",
  participant_usernames: ["leon"],
  player_count: 1,
  active_combat_id: null,
  ai_assist_level: "off",
};

const PARTY_WITH_CHARACTER: Participant[] = [
  {
    username: "leon",
    is_dm: false,
    character: {
      character_id: "c1",
      name: "Velka",
      char_class: "Rogue",
      level: 3,
      current_hp: 18,
      max_hp: 20,
      ac: 14,
    },
  },
];

const PARTY_NO_CHARACTER: Participant[] = [
  { username: "leon", is_dm: true, character: null },
];

const SHEET_WITH_SKILLS = {
  character_id: "c1",
  owner_username: "leon",
  name: "Velka",
  race: "Half-Elf",
  subrace: "",
  char_class: "Rogue",
  subclass: "",
  level: 3,
  background: "Criminal",
  alignment: "CN",
  ability_scores: {},
  hp: { current: 18, max: 20, temp: 0 },
  ac: 14,
  initiative: 3,
  proficiency_bonus: 2,
  speed: 30,
  xp: 900,
  xp_next: 2700,
  hit_dice_remaining: 3,
  proficient_saves: [],
  proficient_skills: ["perception", "stealth", "investigation"],
  class_features: [],
  conditions: [],
  spellcasting: null,
  spell_slots: {},
  is_spellcaster: false,
  inventory: [],
  inventory_weight: 0,
  skills: [
    { name: "acrobatics", ability: "dexterity", modifier: 5, proficient: true },
    { name: "investigation", ability: "intelligence", modifier: 4, proficient: true },
    { name: "perception", ability: "wisdom", modifier: 3, proficient: true },
    { name: "persuasion", ability: "charisma", modifier: 1, proficient: false },
    { name: "stealth", ability: "dexterity", modifier: 7, proficient: true },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue(SESSION);
  (dnd.getSessionEvents as jest.MockedFunction<typeof dnd.getSessionEvents>)
    .mockResolvedValue([]);
});

/** Helper: render and navigate to the Scene pane where DiceTray lives. */
async function renderAndOpenScene() {
  render(<PlayPage />);
  await screen.findByText("Test Table");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /scene/i }));
  });
}

describe("A2 - real character quick-checks", () => {
  it("renders quick-check buttons with real modifiers from the sheet", async () => {
    mGetParticipants.mockResolvedValue(PARTY_WITH_CHARACTER);
    mGetCharacterSheet.mockResolvedValue(SHEET_WITH_SKILLS);

    await renderAndOpenScene();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /perception/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /stealth/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /investigation/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /persuasion/i })).toBeInTheDocument();
    });

    // Verify real modifiers are shown (Stealth +7, Perception +3, Investigation +4, Persuasion +1)
    expect(screen.getByRole("button", { name: /stealth/i })).toHaveTextContent("+7");
    expect(screen.getByRole("button", { name: /perception/i })).toHaveTextContent("+3");
  });

  it("passes getCharacterSheet the bound character_id and username", async () => {
    mGetParticipants.mockResolvedValue(PARTY_WITH_CHARACTER);
    mGetCharacterSheet.mockResolvedValue(SHEET_WITH_SKILLS);

    render(<PlayPage />);
    await screen.findByText("Test Table");

    await waitFor(() =>
      expect(mGetCharacterSheet).toHaveBeenCalledWith("c1", "leon", expect.anything()),
    );
  });

  it("hides quick-checks when no character is bound (DM-only)", async () => {
    mGetParticipants.mockResolvedValue(PARTY_NO_CHARACTER);
    mGetCharacterSheet.mockRejectedValue(new Error("no char"));

    await renderAndOpenScene();

    // Raw dice still present
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /roll d20/i })).toBeInTheDocument(),
    );
    // No quick-checks section
    expect(screen.queryByText(/quick checks/i)).not.toBeInTheDocument();
  });

  it("degrades gracefully when sheet fetch fails - no NaN, no crash", async () => {
    mGetParticipants.mockResolvedValue(PARTY_WITH_CHARACTER);
    mGetCharacterSheet.mockRejectedValue(new Error("network error"));

    await renderAndOpenScene();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /roll d20/i })).toBeInTheDocument(),
    );

    const body = document.body.textContent ?? "";
    expect(body).not.toContain("NaN");
    expect(screen.queryByText(/quick checks/i)).not.toBeInTheDocument();
  });

  it("hides quick-checks when sheet has no skills array", async () => {
    mGetParticipants.mockResolvedValue(PARTY_WITH_CHARACTER);
    const sheetNoSkills = { ...SHEET_WITH_SKILLS, skills: undefined };
    mGetCharacterSheet.mockResolvedValue(sheetNoSkills);

    await renderAndOpenScene();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /roll d20/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/quick checks/i)).not.toBeInTheDocument();
  });
});

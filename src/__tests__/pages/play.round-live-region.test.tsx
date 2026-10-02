/**
 * A9d-2 fix round N10 (Iro Minor-3; the A9d-1 MINOR-5 pin that was owed) -- ONE polite live region says the round.
 *
 * With AI assist off the header's status pill reads "round N - combat", and the initiative tracker's own live span says "round N" too. A screen
 * reader that hears both says the round twice per turn; the pill's round is `aria-hidden` (page.tsx's `.pillRound`), so the tracker is the one region
 * that announces it. Nothing pinned that: the A9d-2 builder removed the duplicate and Iro measured it in the AX tree, by hand. This renders
 * AI-off combat through the real page and counts every live node (aria-live or role status/alert, not under aria-hidden or hidden) whose
 * accessible text matches /round \d/: exactly one.
 *
 * Control: take `aria-hidden` off the pill's round span -> the count is 2 and this reds (run, red, restored).
 */
import React from 'react';
import { waitFor } from '@testing-library/react';
import { renderPlay } from '@/test-utils/renderPlay';
import '@testing-library/jest-dom';
import type { Session, Participant, CombatState, CombatParticipantState, CharacterSheet } from '@/lib/api/types';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'sess-t6' }),
}));

jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const mockUseAuth = jest.fn(() => ({ user: { id: 1, username: 'leon', email: null } }));
jest.mock('../../lib/auth/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../../lib/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('../../lib/api/dnd', () => ({
  getCatalog: jest.fn(() => Promise.resolve({ system: 'dnd5e', content_type: 'class', items: [], total: 0, limit: 100, offset: 0 })),
  getSession: jest.fn(),
  getSessionEvents: jest.fn(() => Promise.resolve([])),
  getSessionEventsRaw: jest.fn(() => Promise.resolve(null)),
  getParticipants: jest.fn(),
  getGrounding: jest.fn(() => Promise.resolve(null)),
  getCombatState: jest.fn(),
  getCharacterSheet: jest.fn(),
  postSessionEvent: jest.fn(() => Promise.resolve({})),
  postXCard: jest.fn(),
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
  pauseSession: jest.fn(),
  resumeSession: jest.fn(),
  endSession: jest.fn(),
  awardSessionXp: jest.fn(),
  resolveCheck: jest.fn(),
  postRoll: jest.fn(),
  // T6 — CastSpellPanel's own direct imports (same mocked module).
  getKnownSpells: jest.fn(() =>
    Promise.resolve({
      is_spellcaster: true,
      caster_kind: 'prepared',
      ability: 'wisdom',
      budget: {
        cantrips_known: 0,
        cantrips_max: 0,
        spells_known: null,
        spells_max: null,
        prepared_used: 0,
        prepared_max: 0,
      },
      cantrips: [],
      spells: [],
    }),
  ),
  castSpell: jest.fn(),
  // DDX-22 Phase 3: JournalPane is now unconditionally mounted on the play
  // page (only its CSS visibility/inert state is gated by journalVisible —
  // see page.tsx's <aside id="play-pane-journal">), so every render of this
  // page fires a getSessionNotes() GET regardless of whether the journal is
  // ever opened. Default to "no note yet" so this suite stays hermetic.
  getSessionNotes: jest.fn(() => Promise.resolve(null)),
  putSessionNotes: jest.fn(() => Promise.resolve({ body: '', updated_at: '2026-01-01T00:00:00Z' })),
}));

jest.mock('../../lib/stream', () => ({
  streamDmNarration: jest.fn(async function* () {
    yield { kind: 'done' as const };
  }),
}));

import * as dnd from '@/lib/api/dnd';
import PlayPage from '@/app/play/[sessionId]/page';

const mGetSession = dnd.getSession as jest.MockedFunction<typeof dnd.getSession>;
const mGetParticipants = dnd.getParticipants as jest.MockedFunction<typeof dnd.getParticipants>;
const mGetCharacterSheet = dnd.getCharacterSheet as jest.MockedFunction<typeof dnd.getCharacterSheet>;
const mGetCombatState = dnd.getCombatState as jest.MockedFunction<typeof dnd.getCombatState>;

const combatant = (id: string, name: string, isPc: boolean, active: boolean): CombatParticipantState => ({
  participant_id: id,
  entity_id: id,
  name,
  is_pc: isPc,
  initiative: 12,
  hp_current: 18,
  hp_max: 20,
  ac: 14,
  conditions: [],
  is_alive: true,
  can_be_targeted: true,
  is_active_turn: active,
  took_turn: false,
});
const COMBAT: CombatState = {
  combat_id: 'combat-1',
  session_id: 'sess-t6',
  round: 2,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'p-enemy',
  initiative: ['p-enemy', 'p-self'],
  participants: [combatant('p-enemy', 'Goblin', false, true), combatant('p-self', 'Velka', true, false)],
};
const PARTY: Participant[] = [
  { username: 'leon', is_dm: false, character: { character_id: 'c1', name: 'Velka', char_class: 'Fighter', level: 3, current_hp: 18, max_hp: 20, ac: 14 } },
];

/** Every live node a screen reader would announce from, with the text it would speak (text under aria-hidden / hidden left out). */
function liveTexts(): string[] {
  const nodes = [...document.querySelectorAll<HTMLElement>('[aria-live="polite"], [aria-live="assertive"], [role="status"], [role="alert"], [role="log"]')];
  return nodes
    .filter((n) => !n.closest('[aria-hidden="true"], [hidden], [inert]'))
    .map((n) => {
      const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      let out = '';
      for (let t = w.nextNode(); t; t = w.nextNode()) if (!t.parentElement?.closest('[aria-hidden="true"], [hidden]')) out += t.textContent;
      return out.replace(/\s+/g, ' ').trim();
    });
}

beforeEach(() => {
  jest.clearAllMocks();
  mGetSession.mockResolvedValue({ session_id: 'sess-t6', channel: 'test_table', dm_username: 'suzu', active_combat_id: 'combat-1', ai_assist_level: 'off' } as Session);
  mGetParticipants.mockResolvedValue(PARTY);
  mGetCharacterSheet.mockResolvedValue({
    character_id: 'c1', owner_username: 'leon', name: 'Velka', race: 'Human', subrace: '', char_class: 'Fighter', subclass: '', level: 3, background: 'Soldier',
    alignment: '', ability_scores: {}, hp: { current: 18, max: 20, temp: 0 }, ac: 14, initiative: 1, proficiency_bonus: 2, speed: 30, xp: 900, xp_next: 2700,
    hit_dice_remaining: 3, proficient_saves: [], proficient_skills: [], class_features: [], conditions: [], spell_slots: {}, is_spellcaster: false, inventory: [],
    inventory_weight: 0,
  } as unknown as CharacterSheet);
  mGetCombatState.mockResolvedValue(COMBAT);
});

describe('AI-off combat: exactly one polite live region says the round', () => {
  it('the initiative tracker\'s span is the one live node whose spoken text names the round; the header pill\'s round is aria-hidden', async () => {
    renderPlay(<PlayPage />);
    await waitFor(() => expect(document.querySelector('[class*="pillRound"]')).not.toBeNull()); // the pill (control: the duplicate exists)
    await waitFor(() => expect(liveTexts().some((t) => /\bround 2\b/i.test(t))).toBe(true)); // the tracker's own
    const saying = liveTexts().filter((t) => /\bround \d/i.test(t));
    expect(saying).toHaveLength(1);
    // and the pill's span IS the aria-hidden one (not silently absent)
    expect(document.querySelector('[class*="pillRound"]')).toHaveAttribute('aria-hidden', 'true');
  });
});

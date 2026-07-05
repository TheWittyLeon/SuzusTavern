/**
 * DDX-10 — LevelUpButton: ADVERSARIAL pass (Miko-QA, break-it).
 *
 * Sibling to LevelUpButton.test.tsx (Ren's happy/AC-path suite). That file
 * proves the golden path and the "refetch decides success" design intent;
 * this file tries to break it: double-submit, refetch failure after a
 * successful mutate, and weird/degenerate before/after diffs fed straight
 * into the real (unmodified) `summarizeLevelUpGain`.
 *
 * FINDING (D1, FIXED — R2): `confirmLevelUp` had NO synchronous busy-guard of
 * any kind — not even the weaker React-`busy`-state check some DDX-25
 * handlers had before their fix. It relied entirely on the `disabled` DOM
 * attribute produced by a state re-render to stop a second click. That
 * re-render had not committed yet if both clicks landed in the same React
 * batch (same technique DDX-25's ADV-5/ADV-5b/D5 use against
 * Pause/Award-XP/End-session — see
 * play.ddx25-session-controls-adversarial.test.tsx and the
 * `sessionActionBusyRef` fix those tests lock in). Proved below, not assumed:
 * `levelUpCharacter` was called TWICE for one same-tick double-click, i.e. a
 * real double level-up (level +2) was reachable from the UI. R2 added a
 * synchronous `levelUpBusyRef` latch (check-and-return before the first
 * `await`, cleared in `finally`) mirroring `sessionActionBusyRef` — the
 * `it.failing` below is now a real passing assertion, and the companion
 * "documents current buggy count" test below it now locks the FIXED count
 * (1) so a future regression shows as a deliberate diff, not a silent one.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  levelUpCharacter: jest.fn(),
  getCharacterSheet: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import LevelUpButton, { summarizeLevelUpGain } from '../../components/LevelUpButton';
import type { CharacterSheet } from '../../lib/api/types';

const mockLevelUp = dnd.levelUpCharacter as jest.Mock;
const mockGetSheet = dnd.getCharacterSheet as jest.Mock;

function ability(score: number, modifier: number) {
  return { score, modifier };
}

const BASE: CharacterSheet = {
  character_id: 'cid-1',
  owner_username: 'leon',
  name: 'Aria',
  race: 'Human',
  subrace: '',
  char_class: 'Fighter',
  subclass: '',
  level: 4,
  background: 'Soldier',
  alignment: '',
  ability_scores: {
    strength: ability(16, 3),
    dexterity: ability(12, 1),
    constitution: ability(14, 2),
    intelligence: ability(10, 0),
    wisdom: ability(10, 0),
    charisma: ability(8, -1),
  },
  hp: { current: 38, max: 38, temp: 0 },
  ac: 16,
  initiative: 1,
  proficiency_bonus: 2,
  speed: 30,
  xp: 6500,
  xp_next: 6500,
  hit_dice_remaining: 4,
  proficient_saves: ['strength', 'constitution'],
  proficient_skills: ['athletics'],
  class_features: ['Second Wind', 'Fighting Style'],
  conditions: [],
  spellcasting: null,
  spell_slots: {},
  is_spellcaster: false,
  inventory: [],
  inventory_weight: 0,
};

function renderButton(overrides?: Partial<CharacterSheet>, onLeveledUp = jest.fn()) {
  render(
    <ToastProvider>
      <LevelUpButton
        characterId="cid-1"
        username="leon"
        sheet={{ ...BASE, ...overrides }}
        onLeveledUp={onLeveledUp}
      />
    </ToastProvider>,
  );
  return { onLeveledUp };
}

/** A few microtask turns — enough for a chain of `await`s inside a mocked
 *  (synchronously-resolving) handler to fully settle. Same helper shape as
 *  play.ddx25-session-controls-adversarial.test.tsx's flush(). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockLevelUp.mockReset();
  mockGetSheet.mockReset();
});

describe('LevelUpButton adversarial — double-submit race probe', () => {
  it(
    'D1 (FIXED — R2): back-to-back clicks on "Yes, level up" in the same React batch must call levelUpCharacter only once',
    async () => {
      mockLevelUp.mockResolvedValue({ message: '[DnD] Aria leveled up!' });
      mockGetSheet.mockResolvedValue({ ...BASE, level: 5, xp_next: 14000 });
      renderButton();

      fireEvent.click(screen.getByRole('button', { name: /^level up$/i }));
      const confirmBtn = screen.getByRole('button', { name: /^yes, level up$/i });

      // Both dispatches inside ONE outer act(): React only commits (flips the
      // DOM `disabled` attribute) once this callback settles — the exact
      // "two taps, one tick" window DDX-25's sessionActionBusyRef exists to
      // close for Pause/Award-XP/End-session. confirmLevelUp now has the same
      // synchronous `levelUpBusyRef` latch, so the second dispatch's call
      // returns immediately instead of reaching levelUpCharacter again.
      await act(async () => {
        fireEvent.click(confirmBtn);
        fireEvent.click(confirmBtn);
      });
      await flush();

      expect(mockLevelUp).toHaveBeenCalledTimes(1);
    },
  );

  it('documents the FIXED call count so a future regression shows as a deliberate diff, not a silent change', async () => {
    mockLevelUp.mockResolvedValue({ message: '[DnD] Aria leveled up!' });
    mockGetSheet.mockResolvedValue({ ...BASE, level: 5, xp_next: 14000 });
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: /^level up$/i }));
    const confirmBtn = screen.getByRole('button', { name: /^yes, level up$/i });

    await act(async () => {
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);
    });
    await flush();

    // R2: ONE real mutate call from one same-tick double-click — the second
    // dispatch is turned away by levelUpBusyRef before it ever reaches
    // levelUpCharacter. Locked here as a positive assertion (not `it.failing`)
    // so a regression that reopens the race hard-fails this test rather than
    // silently continuing to "pass".
    expect(mockLevelUp).toHaveBeenCalledTimes(1);
  });
});

describe('LevelUpButton adversarial — refetch failure after a successful mutate', () => {
  it('getCharacterSheet throwing after levelUpCharacter resolves: no false success, no onLeveledUp, no wedge — and the copy reflects reality without inviting a retry (D2, FIXED — R2)', async () => {
    mockLevelUp.mockResolvedValue({ message: '[DnD] Aria leveled up!' });
    mockGetSheet.mockRejectedValue(new Error('network blip'));
    const { onLeveledUp } = renderButton();

    fireEvent.click(screen.getByRole('button', { name: /^level up$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^yes, level up$/i }));

    // R2: the mutate and the refetch now have separate try/catch blocks, so
    // a refetch failure after a resolved levelUpCharacter lands in its OWN
    // catch with its own copy — distinct from an actual levelUpCharacter
    // failure.
    expect(
      await screen.findByText("Couldn't refresh your sheet — reload to see the result."),
    ).toBeInTheDocument();

    // No false success: never shows the gain-summary "Leveled up! Lv.X →
    // Lv.Y" copy (note the "!" — distinct from the new refetch-failure
    // copy's em dash, so this regex still correctly misses it post-fix).
    expect(screen.queryByText(/leveled up!/i)).not.toBeInTheDocument();
    // Never reaches `onLeveledUp(after)` (that call sits after the refetch in
    // the try body) -> the parent page's sheet state is now STALE relative to
    // the server (which the mutate really did change) until a manual reload.
    expect(onLeveledUp).not.toHaveBeenCalled();

    // No wedge: dialog closes and the button re-enables (busy resets via the
    // `finally` block) rather than getting stuck on the "…" spinner state.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^level up$/i })).toBeEnabled();

    // FIXED (D2, Medium — was: same "Could not level up. Try again in a
    // moment." string used for an actual levelUpCharacter failure, which is
    // misleading here — the mutate already succeeded server-side, and "try
    // again" risked a second REAL level-up from a confused user who believed
    // nothing had happened yet). Lock both directions: the old mutate-failure
    // string must NOT appear in this branch, and the new copy must not use
    // retry language.
    expect(
      screen.queryByText('Could not level up. Try again in a moment.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
  });
});

describe('summarizeLevelUpGain — weird/degenerate diffs (real function, not reimplemented)', () => {
  it('a >1 level jump reports the true span without crashing (e.g. a batch/replay apply)', () => {
    const before: CharacterSheet = { ...BASE, level: 4 };
    const after: CharacterSheet = {
      ...BASE,
      level: 6,
      hp: { current: 60, max: 60, temp: 0 },
    };
    const gain = summarizeLevelUpGain(before, after);
    expect(gain.fromLevel).toBe(4);
    expect(gain.toLevel).toBe(6);
    expect(gain.hpGain).toBe(22);
  });

  it('HP max unchanged or DECREASED clamps to 0 rather than displaying (or crashing on) a negative gain', () => {
    const unchanged = summarizeLevelUpGain(BASE, {
      ...BASE,
      level: 5,
      hp: { current: 38, max: 38, temp: 0 },
    });
    expect(unchanged.hpGain).toBe(0);

    const decreased = summarizeLevelUpGain(BASE, {
      ...BASE,
      level: 5,
      hp: { current: 30, max: 30, temp: 0 },
    });
    expect(decreased.hpGain).toBe(0); // clamped, never -8
  });

  it('a spell-slot level present before and fully absent after is reported as a decrease to 0, not dropped or crashed on', () => {
    const before: CharacterSheet = {
      ...BASE,
      spell_slots: {
        '1': { max: 4, used: 0, remaining: 4 },
        '2': { max: 2, used: 0, remaining: 2 },
      },
    };
    const after: CharacterSheet = {
      ...BASE,
      level: 5,
      spell_slots: { '1': { max: 4, used: 0, remaining: 4 } }, // level-2 slot vanished
    };
    const gain = summarizeLevelUpGain(before, after);
    expect(gain.slotChanges).toContainEqual({ level: '2', from: 2, to: 0 });
  });

  it('duplicate feature names in the after list do not crash and are not silently deduped into a false summary', () => {
    const after: CharacterSheet = {
      ...BASE,
      level: 5,
      class_features: [...BASE.class_features, 'Extra Attack', 'Extra Attack'],
    };
    const gain = summarizeLevelUpGain(BASE, after);
    expect(() => gain.newFeatures.join(', ')).not.toThrow();
    expect(gain.newFeatures).toEqual(['Extra Attack', 'Extra Attack']);
  });
});

describe('LevelUpButton adversarial — result region is a real announced live region', () => {
  it('the gain summary renders inside role="status" (not just visible text) so screen readers pick it up', async () => {
    mockLevelUp.mockResolvedValue({ message: 'ok' });
    mockGetSheet.mockResolvedValue({ ...BASE, level: 5, xp_next: 14000 });
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: /^level up$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^yes, level up$/i }));

    const status = await screen.findByRole('status');
    await waitFor(() => expect(status).toHaveTextContent(/leveled up! lv\.4 → lv\.5\./i));
  });
});

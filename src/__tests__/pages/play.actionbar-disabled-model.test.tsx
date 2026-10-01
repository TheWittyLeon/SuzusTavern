/**
 * TAV-PLAY-SHELL A9c-2 D6, carry (c) — the combat bar's disabled model.
 *
 * Every combat-submit control is INERT under every condition that disables it.
 * The assertion is behavioural (a forced click reaches no handler), not the
 * attribute alone, so the guarantee survives whichever mechanism provides it:
 * the native `disabled` attribute today, which is why the Attack button's
 * extra JS guard was deleted rather than copied onto the other four verbs
 * (Kage A8 D: only one of five had it).
 *
 * Verbs under test: Attack / Dodge / Dash / End turn / Roll death save, plus
 * CastSpellPanel's submit (the second player combat-submit surface; D6 moves
 * it into the actionBar region, so both now sit in one bar).
 *
 * Controls (mutate the consumer, see red, restore):
 *  - drop `disabled={actionDisabled}` from Dodge -> its three cases red;
 *  - drop the `guardLocked(castLocked, ...)` wrapper from CastSpellPanel's Cast onClick
 *    -> its cases red. (Since A9c-2 IMPORTANT-1 Cast is `aria-disabled`, not native
 *    `disabled`, so the guard is the thing that makes it inert.)
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { expectLocked } from '@/test-utils/locked';

jest.mock('../../lib/api/dnd', () => ({
  getKnownSpells: jest.fn(),
  castSpell: jest.fn(),
  getCharacterSheet: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import CastSpellPanel from '../../components/CastSpellPanel';
import ActionBar, { type ActionBarProps } from '@/app/play/[sessionId]/regions/ActionBar';
import type { SpellListResult } from '../../lib/api/types';

const TARGETS = [{ id: 'g1', name: 'Goblin' }];
const BASE: ActionBarProps = { targets: TARGETS, onAction: jest.fn(), isPlayerTurn: true, isDying: false };

type Condition = 'busy' | 'notYourTurn' | 'isDying' | 'actionSpent' | 'noTargets';
const CONDITION_PROPS: Record<Condition, Partial<ActionBarProps>> = {
  busy: { busy: true },
  notYourTurn: { isPlayerTurn: false },
  isDying: { isDying: true, deathSaves: { successes: 0, failures: 0 } },
  actionSpent: { actionSpent: true },
  noTargets: { targets: [] },
};

// verb -> accessible-name matcher + every condition that disables it. End turn is
// deliberately NOT disabled by dying (a downed PC may pass); death save only
// exists while dying and is gated by busy alone.
const VERBS: Array<{ verb: string; name: RegExp; conditions: Condition[]; dying?: boolean }> = [
  { verb: 'Attack', name: /^Attack/, conditions: ['busy', 'notYourTurn', 'isDying', 'actionSpent', 'noTargets'] },
  { verb: 'Dodge', name: /^Dodge/, conditions: ['busy', 'notYourTurn', 'isDying'] },
  { verb: 'Dash', name: /^Dash/, conditions: ['busy', 'notYourTurn', 'isDying'] },
  { verb: 'End turn', name: /^End turn/, conditions: ['busy', 'notYourTurn'] },
  { verb: 'Roll death save', name: /^Roll death save/, conditions: ['busy'], dying: true },
];

const CASES = VERBS.flatMap((v) => v.conditions.map((c) => [v.verb, c] as const));

describe('ActionBar — every verb is inert under every condition that disables it', () => {
  it.each(CASES)('%s is inert when %s', (verb, condition) => {
    const spec = VERBS.find((v) => v.verb === verb)!;
    const onAction = jest.fn();
    const dying = spec.dying ? CONDITION_PROPS.isDying : {};
    render(<ActionBar {...BASE} {...dying} {...CONDITION_PROPS[condition]} onAction={onAction} />);
    const btn = screen.getByRole('button', { name: spec.name });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // Positive control: the same render with no disabling condition DOES act, so a
  // green table above is not a harness that can never click.
  it.each(VERBS.filter((v) => v.verb !== 'Attack'))('%s acts when nothing disables it', (spec) => {
    const onAction = jest.fn();
    const dying = spec.dying ? CONDITION_PROPS.isDying : {};
    render(<ActionBar {...BASE} {...dying} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: spec.name }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('Attack acts when nothing disables it (opens the target menu, then fires with the target id)', () => {
    const onAction = jest.fn();
    render(<ActionBar {...BASE} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: /^Attack/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Goblin/ }));
    expect(onAction).toHaveBeenCalledWith('attack', 'g1');
  });
});

const SPELLS: SpellListResult = {
  is_spellcaster: true,
  caster_kind: 'prepared',
  ability: 'wisdom',
  budget: {
    cantrips_known: 1,
    cantrips_max: 3,
    spells_known: null,
    spells_max: null,
    prepared_used: 0,
    prepared_max: 4,
  },
  cantrips: [
    {
      slug: 'sacred-flame',
      name: 'Sacred Flame',
      level: 0,
      school: 'evocation',
      source: 'class',
      prepared: true,
      is_cantrip: true,
      concentration: false,
      ritual: false,
      castable_now: true,
      heals: false,
    },
  ],
  spells: [],
};

describe("CastSpellPanel's submit is inert under every condition that disables it", () => {
  const cast = dnd.castSpell as jest.Mock;
  beforeEach(() => {
    cast.mockReset().mockResolvedValue({ message: 'ok' });
    (dnd.getKnownSpells as jest.Mock).mockResolvedValue(SPELLS);
    (dnd.getCharacterSheet as jest.Mock).mockResolvedValue({});
  });

  async function renderPanel(over: { isPlayerTurn: boolean; disabled: boolean }) {
    render(
      <ToastProvider>
        <CastSpellPanel
          combatId="c1"
          characterId="cid"
          username="leon"
          participants={[]}
          spellSlots={{}}
          onCast={jest.fn()}
          onSheetChanged={jest.fn()}
          onStateRefresh={jest.fn()}
          {...over}
        />
      </ToastProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    return screen.getByRole('button', { name: /^Cast /i });
  }

  it.each([
    ['not your turn', { isPlayerTurn: false, disabled: false }],
    ['locked (session paused/ended, or another mutation in flight)', { isPlayerTurn: true, disabled: true }],
  ])('Cast is inert when %s', async (_label, over) => {
    const btn = await renderPanel(over);
    expectLocked(btn);
    fireEvent.click(btn);
    expect(cast).not.toHaveBeenCalled();
  });

  it('Cast acts when nothing disables it', async () => {
    const btn = await renderPanel({ isPlayerTurn: true, disabled: false });
    expect(btn).toBeEnabled();
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(cast).toHaveBeenCalledTimes(1);
  });
});

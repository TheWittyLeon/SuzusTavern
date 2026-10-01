/**
 * CastSpellPanel — the transient locks keep focus (Iro A9c-2 IMPORTANT-1, Kage
 * IMPORTANT-2). The Cast button and the three selects are `aria-disabled` + guarded
 * while a cast is in flight / it is not the caster's turn / the session is paused —
 * never native `disabled`, which blurred the focused control to <body> on every cast
 * and on every turn change. jsdom cannot see the blur; the harness's
 * `cast-keeps-focus` is the browser pin. This pins the mechanism.
 *
 * Controls: put `disabled={castLocked}` back on the Cast button -> the "not natively
 * disabled" asserts red; drop a select's onChange guard -> "ignores a change" reds.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { expectLocked, expectUnlocked } from '@/test-utils/locked';

jest.mock('../../lib/api/dnd', () => ({
  getKnownSpells: jest.fn(),
  castSpell: jest.fn(),
  getCharacterSheet: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import CastSpellPanel, { type CastSpellPanelProps } from '../../components/CastSpellPanel';
import type { SpellListResult } from '../../lib/api/types';

const SPELL = (slug: string, name: string) => ({
  slug, name, level: 0, school: 'evocation', source: 'class', prepared: true,
  is_cantrip: true, concentration: false, ritual: false, castable_now: true, heals: false,
});
const SPELLS: SpellListResult = {
  is_spellcaster: true,
  caster_kind: 'prepared',
  ability: 'wisdom',
  budget: { cantrips_known: 2, cantrips_max: 3, spells_known: null, spells_max: null, prepared_used: 0, prepared_max: 4 },
  cantrips: [SPELL('guidance', 'Guidance'), SPELL('sacred-flame', 'Sacred Flame')],
  spells: [],
} as unknown as SpellListResult;

const cast = dnd.castSpell as jest.Mock;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

function tree(over: Partial<CastSpellPanelProps>) {
  return (
    <ToastProvider>
      <CastSpellPanel
        combatId="c1"
        characterId="cid"
        username="leon"
        participants={[]}
        spellSlots={{}}
        isPlayerTurn
        onCast={jest.fn()}
        onSheetChanged={jest.fn()}
        onStateRefresh={jest.fn()}
        {...over}
      />
    </ToastProvider>
  );
}

beforeEach(() => {
  cast.mockReset().mockResolvedValue({ message: 'ok' });
  (dnd.getKnownSpells as jest.Mock).mockResolvedValue(SPELLS);
  (dnd.getCharacterSheet as jest.Mock).mockResolvedValue({});
});

describe('CastSpellPanel keeps focus under a transient lock', () => {
  it('the turn passing to a monster locks Cast without blurring it', async () => {
    const { rerender } = render(tree({}));
    await flush();
    const btn = screen.getByRole('button', { name: /^Cast Guidance$/ });
    btn.focus();
    expectUnlocked(btn);
    rerender(tree({ isPlayerTurn: false }));
    const locked = screen.getByRole('button', { name: /not your turn/i });
    expect(locked).toBe(btn);
    expectLocked(locked);
    expect(locked).toHaveFocus();
    // A not-your-turn lock is not "working": no aria-busy.
    expect(locked).not.toHaveAttribute('aria-busy', 'true');
  });

  it('a cast in flight: Cast keeps focus, is busy, and a second activation is swallowed', async () => {
    let finish!: (v: { message: string }) => void;
    cast.mockReturnValue(new Promise((r) => { finish = r; }));
    render(tree({}));
    await flush();
    const btn = screen.getByRole('button', { name: /^Cast Guidance$/ });
    btn.focus();
    fireEvent.click(btn);
    expect(cast).toHaveBeenCalledTimes(1);
    expectLocked(btn);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveFocus();
    fireEvent.click(btn);
    expect(cast).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ message: 'ok' }); });
    await flush();
    expect(btn).toHaveFocus();
  });

  it('the selects are aria-disabled, never native disabled, and ignore a change / mousedown', async () => {
    render(tree({ disabled: true }));
    await flush();
    for (const name of ['Spell', 'Target']) {
      const sel = screen.getByRole('combobox', { name }) as HTMLSelectElement;
      expectLocked(sel);
      sel.focus();
      expect(sel).toHaveFocus();
    }
    const spell = screen.getByRole('combobox', { name: 'Spell' }) as HTMLSelectElement;
    const before = spell.value;
    fireEvent.change(spell, { target: { value: 'sacred-flame' } });
    expect(spell.value).toBe(before);
    // fireEvent returns false when the handler called preventDefault (no popup opens).
    expect(fireEvent.mouseDown(spell)).toBe(false);
  });

  it('positive control: unlocked selects change and open', async () => {
    render(tree({}));
    await flush();
    const spell = screen.getByRole('combobox', { name: 'Spell' }) as HTMLSelectElement;
    expectUnlocked(spell);
    fireEvent.change(spell, { target: { value: 'sacred-flame' } });
    expect(spell.value).toBe('sacred-flame');
    expect(fireEvent.mouseDown(spell)).toBe(true);
  });
});

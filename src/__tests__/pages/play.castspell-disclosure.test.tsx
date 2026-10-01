/**
 * TAV-PLAY-SHELL A9c-2 D7 (lever 3) — the cast panel is folded behind a
 * "Cast a spell" disclosure by default, so an open panel does not take ~100px
 * from the story log in the content-sized action bar.
 *
 * Pins: folded by default, native disclosure semantics (aria-expanded +
 * aria-controls pointing at the body), the controls stay MOUNTED while folded
 * (a selection and the loaded spell list survive a fold; no refetch), an
 * unfolded panel behaves exactly as before, and the panel without a
 * `disclosure` prop (every other caller) is unchanged.
 *
 * Controls: render the body without `hidden` -> the folded test reds; unmount
 * the body while folded -> the survives-a-fold test reds.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/api/dnd', () => ({
  getKnownSpells: jest.fn(),
  castSpell: jest.fn(),
  getCharacterSheet: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import CastSpellPanel from '../../components/CastSpellPanel';
import CastSpellTenant from '@/app/play/[sessionId]/tenants/CastSpellTenant';
import type { CharacterSheet, CombatState, SpellListResult } from '../../lib/api/types';

const spell = (slug: string, name: string) => ({
  slug,
  name,
  level: 0,
  school: 'evocation',
  source: 'class',
  prepared: true,
  is_cantrip: true,
  concentration: false,
  ritual: false,
  castable_now: true,
  heals: false,
});
const SPELLS: SpellListResult = {
  is_spellcaster: true,
  caster_kind: 'prepared',
  ability: 'wisdom',
  budget: {
    cantrips_known: 2,
    cantrips_max: 3,
    spells_known: null,
    spells_max: null,
    prepared_used: 0,
    prepared_max: 4,
  },
  cantrips: [spell('sacred-flame', 'Sacred Flame'), spell('guidance', 'Guidance')],
  spells: [],
};

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

beforeEach(() => {
  (dnd.getKnownSpells as jest.Mock).mockReset().mockResolvedValue(SPELLS);
});

function tenant() {
  return (
    <ToastProvider>
      <CastSpellTenant
        isDmPlayingOwnPc={false}
        isHumanDM={false}
        combatIsActive
        combatState={{ participants: [] } as unknown as CombatState}
        combatId="c1"
        myCharacterIdStr="cid"
        mySheet={{ is_spellcaster: true, spell_slots: {} } as unknown as CharacterSheet}
        username="leon"
        isPlayerTurn
        combatBusy={false}
        sessionLocked={false}
        onCast={jest.fn()}
        onSheetChanged={jest.fn()}
        onStateRefresh={jest.fn()}
        onBusyChange={jest.fn()}
      />
    </ToastProvider>
  );
}

describe('CastSpellTenant — the cast panel folds behind a "Cast a spell" disclosure', () => {
  it('is folded by default: the trigger says so, the controls are not exposed', async () => {
    render(tenant());
    await flush();
    const trigger = screen.getByRole('button', { name: /cast a spell/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('combobox', { name: 'Spell' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cast (?!a spell)/i })).toBeNull();
  });

  it('the trigger controls the body it folds (aria-controls -> the hidden wrapper)', async () => {
    render(tenant());
    await flush();
    const trigger = screen.getByRole('button', { name: /cast a spell/i });
    const body = document.getElementById(trigger.getAttribute('aria-controls') as string);
    expect(body).not.toBeNull();
    expect(body).toHaveAttribute('hidden');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(body).not.toHaveAttribute('hidden');
  });

  it('unfolded, the picker and the Cast button are there and reachable', async () => {
    render(tenant());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /cast a spell/i }));
    expect(screen.getByRole('combobox', { name: 'Spell' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Cast (?!a spell)/i })).toBeEnabled();
  });

  it('a selection and the loaded list survive a fold: the body stays mounted, nothing is refetched', async () => {
    render(tenant());
    await flush();
    const trigger = screen.getByRole('button', { name: /cast a spell/i });
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole('combobox', { name: 'Spell' }), { target: { value: 'guidance' } });
    fireEvent.click(trigger); // fold
    fireEvent.click(trigger); // unfold
    expect(screen.getByRole('combobox', { name: 'Spell' })).toHaveValue('guidance');
    expect(dnd.getKnownSpells).toHaveBeenCalledTimes(1);
  });
});

describe('CastSpellPanel — without a `disclosure` prop it is exactly what it was', () => {
  it('no disclosure trigger, controls exposed immediately', async () => {
    render(
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
        />
      </ToastProvider>,
    );
    await flush();
    expect(screen.queryByRole('button', { name: /cast a spell/i })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Spell' })).toBeVisible();
  });
});

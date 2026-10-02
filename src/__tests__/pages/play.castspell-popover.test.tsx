/**
 * A9d-2 fix round N8 (Sora lever brief 2.4; Tora 4c) -- the cast panel opens from a "Cast a spell" button as an anchored POPOVER, the
 * fifth consumer of `useAnchoredPopover`. It replaces A9c-2 D7's in-flow disclosure (and this file's `disclosure` cases, deleted with the
 * prop: the brief's named exception). An open in-flow panel pushed the X-card off a 390x844 screen; the browser half of that
 * (the X-card wholly visible with Cast open) is the harness's `popover-cast` leg.
 *
 * Pins: closed by default with the opener's dialog semantics (aria-haspopup / aria-expanded / aria-controls naming the popover);
 * named "Cast a spell", portalled out of the tenant (a slot clips and an overlay owner paints over a child); focus to the first control on
 * open; Escape closes and focus returns to the button; the controls stay MOUNTED while closed (keepMounted: a loaded list and a
 * selection survive, nothing is refetched); a cast that resolves closes it (the popover would cover the log line); the gate failing under
 * an open popover closes it (it does not come back open); and the panel without a host is what it was.
 *
 * Controls: drop `keepMounted` -> the survives-a-close test reds; drop the close on cast -> the cast test reds; drop the reset when the gate
 * fails -> the gate test reds.
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

function tenant(over: { combatIsActive?: boolean } = {}) {
  return (
    <ToastProvider>
      <CastSpellTenant
        isDmPlayingOwnPc={false}
        isHumanDM={false}
        combatIsActive={over.combatIsActive ?? true}
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

describe('CastSpellTenant -- Cast a spell is an anchored popover', () => {
  const opener = () => screen.getByRole('button', { name: 'Cast a spell' });
  // closed it has no role (see AnchoredPopover): found by the id the opener controls, which is what aria-controls is for
  const popover = () => document.getElementById(opener().getAttribute('aria-controls') as string) as HTMLElement;

  it('is closed by default: the opener says so, the popover is hidden by class (kept mounted)', async () => {
    render(tenant());
    await flush();
    expect(opener()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(opener()).toHaveAttribute('aria-expanded', 'false');
    expect(popover()).toHaveClass('closed');
    expect(popover()).not.toHaveAttribute('role'); // closed + kept mounted: no role or name in jsdom (AnchoredPopover), so a bare queryByRole('dialog') elsewhere is unaffected
  });

  it('the opener controls the popover (aria-controls -> its id), which is portalled out of the tenant and never aria-modal', async () => {
    const { container } = render(tenant());
    await flush();
    expect(popover().id).toBe(opener().getAttribute('aria-controls'));
    expect(container.contains(popover())).toBe(false);
    expect(popover().parentElement).toBe(document.body);
    expect(popover()).not.toHaveAttribute('aria-modal');
  });

  it('opens on the button and puts focus on the first control; Escape closes it and focus returns to the button', async () => {
    render(tenant());
    await flush();
    fireEvent.click(opener());
    expect(opener()).toHaveAttribute('aria-expanded', 'true');
    expect(popover()).not.toHaveClass('closed');
    expect(screen.getByRole('combobox', { name: 'Spell' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Spell' }), { key: 'Escape' });
    expect(opener()).toHaveAttribute('aria-expanded', 'false');
    expect(popover()).toHaveClass('closed');
    expect(opener()).toHaveFocus();
  });

  it('a selection and the loaded list survive a close: the panel stays mounted, nothing is refetched', async () => {
    render(tenant());
    await flush();
    fireEvent.click(opener());
    fireEvent.change(screen.getByRole('combobox', { name: 'Spell' }), { target: { value: 'guidance' } });
    fireEvent.click(opener()); // close
    fireEvent.click(opener()); // reopen
    expect(screen.getByRole('combobox', { name: 'Spell' })).toHaveValue('guidance');
    expect(dnd.getKnownSpells).toHaveBeenCalledTimes(1);
  });

  it('a cast that resolves closes the popover and returns focus to the button, so the log line it wrote is seen', async () => {
    (dnd.castSpell as jest.Mock).mockResolvedValue({ message: 'You cast Sacred Flame.' });
    (dnd.getCharacterSheet as jest.Mock).mockResolvedValue({ is_spellcaster: true, spell_slots: {} });
    render(tenant());
    await flush();
    fireEvent.click(opener());
    fireEvent.click(screen.getByRole('button', { name: /^Cast Guidance/ }));
    await flush();
    expect(dnd.castSpell).toHaveBeenCalledTimes(1);
    expect(opener()).toHaveAttribute('aria-expanded', 'false');
    expect(popover()).toHaveClass('closed');
    expect(opener()).toHaveFocus();
  });

  it('the gate failing under an open popover closes it: it does not come back open when the gate holds again', async () => {
    const { rerender } = render(tenant());
    await flush();
    fireEvent.click(opener());
    expect(opener()).toHaveAttribute('aria-expanded', 'true');
    rerender(tenant({ combatIsActive: false }));
    expect(screen.queryByRole('button', { name: 'Cast a spell' })).toBeNull();
    rerender(tenant());
    await flush();
    expect(opener()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('CastSpellPanel -- the panel on its own (the disclosure prop is gone)', () => {
  it('has no disclosure trigger and exposes its controls immediately', async () => {
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

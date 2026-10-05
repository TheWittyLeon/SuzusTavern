/** While held the Cast button fires nothing (click / Enter / Space / touch) and its accessible name does not contradict the held note (it never says "not your turn"). */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
jest.mock('../../lib/api/dnd', () => ({ getKnownSpells: jest.fn(), castSpell: jest.fn(), getCharacterSheet: jest.fn() }));
import * as dnd from '../../lib/api/dnd';
import { ToastProvider } from '../../components/Toast';
import CastSpellPanel from '../../components/CastSpellPanel';
import type { SpellListResult } from '../../lib/api/types';

const SPELL = (slug: string, name: string) => ({ slug, name, level: 0, school: 'evocation', source: 'class', prepared: true, is_cantrip: true, concentration: false, ritual: false, castable_now: true, heals: false });
const SPELLS = { is_spellcaster: true, caster_kind: 'prepared', ability: 'wisdom', budget: { cantrips_known: 2, cantrips_max: 3, spells_known: null, spells_max: null, prepared_used: 0, prepared_max: 4 }, cantrips: [SPELL('guidance', 'Guidance')], spells: [] } as unknown as SpellListResult;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

it('held: Cast fires nothing by any input, and its name says the fight is on hold, not that it is not your turn', async () => {
  (dnd.castSpell as jest.Mock).mockReset().mockResolvedValue({ message: 'ok' });
  (dnd.getKnownSpells as jest.Mock).mockResolvedValue(SPELLS);
  (dnd.getCharacterSheet as jest.Mock).mockResolvedValue({});
  render(<ToastProvider><CastSpellPanel combatId="c1" characterId="cid" username="leon" participants={[]} spellSlots={{}} isPlayerTurn={false} held onCast={jest.fn()} onSheetChanged={jest.fn()} onStateRefresh={jest.fn()} /></ToastProvider>);
  await flush();
  const btn = screen.getAllByRole('button').find((b) => /cast/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))!;
  fireEvent.click(btn); fireEvent.keyDown(btn, { key: 'Enter' }); fireEvent.keyDown(btn, { key: ' ' }); fireEvent.pointerDown(btn, { pointerType: 'touch' }); fireEvent.click(btn);
  await flush();
  expect(dnd.castSpell).not.toHaveBeenCalled();
  expect(btn.getAttribute('aria-label')).toBe('Cast Guidance (fight on hold)');
  expect(btn.getAttribute('aria-label')).not.toMatch(/not your turn/);
  expect(screen.getByText('The fight is on hold.')).toBeInTheDocument();
});

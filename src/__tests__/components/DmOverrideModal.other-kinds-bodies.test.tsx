/**
 * Miko-QA: request bodies for attack / check / save (and damage for contrast).
 * Run unchanged in the base tree (8957f1a) and the fix tree (e574589) with
 * BODY_OUT=<file>; diff the two JSON files. Attack/check/save must be identical.
 * Also asserts the literal expected bodies so it is a regression test on its own.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
const mockSubmitOverride = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('../../lib/api/dnd', () => ({
  submitOverride: (...args: Parameters<AnyFn>) => mockSubmitOverride(...args),
}));
import DmOverrideModal from '@/components/DmOverrideModal';
import type { CombatParticipantState } from '@/lib/api/types';

const mk = (id: string, name: string, hp: number): CombatParticipantState => ({
  participant_id: id, entity_id: id, name, is_pc: id.startsWith('pc'), initiative: 10,
  hp_current: hp, hp_max: 30, ac: 12, conditions: [], is_alive: true, can_be_targeted: true,
  is_active_turn: false, took_turn: false,
});
const P = [mk('goblin-1', 'Goblin', 7), mk('pc-1', 'Kaelen', 20)];
const out: Record<string, unknown> = {};

async function run(label: string, steps: (h: { set: (re: RegExp, v: string) => void; click: (n: RegExp) => void; target: () => void }) => void) {
  mockSubmitOverride.mockReset();
  mockSubmitOverride.mockResolvedValue({ applied: { message: 'ok' } });
  const { unmount } = render(<DmOverrideModal open combatId="c1" participants={P} defaultActorId="goblin-1" onSuccess={jest.fn()} onClose={jest.fn()} />);
  steps({
    set: (re, v) => fireEvent.change(screen.getByLabelText(re), { target: { value: v } }),
    click: (n) => fireEvent.click(screen.getByRole('radio', { name: n })),
    target: () => fireEvent.change(screen.getByLabelText(/^Target(?! new)/), { target: { value: 'pc-1' } }),
  });
  fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: '  ruling  ' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Apply override/i })); });
  await new Promise((r) => setTimeout(r, 0));
  out[label] = mockSubmitOverride.mock.calls.length ? mockSubmitOverride.mock.calls : 'NO POST';
  unmount();
}

afterAll(() => {
  if (process.env.BODY_OUT) fs.writeFileSync(process.env.BODY_OUT, JSON.stringify(out, null, 1));
});

it('attack hit with damage', async () => {
  await run('attack-hit', (h) => { h.target(); h.set(/Damage amount/i, '9'); });
  expect((out['attack-hit'] as unknown[][])[0][1]).toEqual({ kind: 'attack', actor_id: 'goblin-1', target_id: 'pc-1', outcome: { hit: true, critical_hit: false, damage: [{ amount: 9, type: 'slashing' }] }, reason: 'ruling' });
});
it('attack miss', async () => {
  await run('attack-miss', (h) => { h.target(); fireEvent.click(screen.getByLabelText(/^Hit$/)); });
  expect((out['attack-miss'] as unknown[][])[0][1]).toMatchObject({ outcome: { hit: false, critical_hit: false } });
});
it('attack without target refuses', async () => {
  await run('attack-no-target', () => {});
  expect(out['attack-no-target']).toBe('NO POST');
});
it('check', async () => {
  await run('check', (h) => { h.click(/Check/i); h.set(/^Total/i, '17'); });
  expect((out['check'] as unknown[][])[0][1]).toEqual({ kind: 'check', actor_id: 'goblin-1', target_id: null, outcome: { success: true, degree: 'success', total: 17 }, reason: 'ruling' });
});
it('save', async () => {
  await run('save', (h) => { h.click(/Save/i); h.set(/^Total/i, '4'); });
  expect((out['save'] as unknown[][])[0][1]).toEqual({ kind: 'save', actor_id: 'goblin-1', target_id: null, outcome: { success: true, degree: 'success', total: 4 }, reason: 'ruling' });
});
it('damage (contrast: base posts target_new_hp 0 untouched; fix posts 20)', async () => {
  await run('damage-untouched', (h) => { h.click(/Damage/i); h.target(); });
  await waitFor(() => expect(out['damage-untouched']).toBeDefined());
});

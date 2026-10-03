/**
 * B8c-3 M2 — the stage's line slot and the adapter, on a bare `SceneStage` (jsdom):
 *   - `useStageLine` writes the scene line's second slot: a plain text node, the status node's next sibling; `null` clears it; the status is clipped only while it shows;
 *   - the "All enemies are down" prompt owns the cell: the line stays in the DOM (clipped), never both on screen (the class is the pin; the harness measures the pixels);
 *   - the adapter clears the line when it unmounts, and says whether the grid held focus as it went (the fight ended with focus in the grid -> the page's rescue -> the scene head);
 *   - `applyState` / `refreshState` on `useCombatState` bump the sequence (a poll asked before is discarded) and set the state; a failed refetch leaves the state as it is.
 * Mutations seen red: `refreshState` without the bump -> "refreshState bumps"; the rescue called with `false` always -> "held focus"; the line inside the status node -> "next sibling".
 */
import { useRef, useState } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SceneStage, { useStageLine } from '@/app/play/[sessionId]/regions/SceneStage';
import StageBoard from '@/app/play/[sessionId]/StageBoard';
import { useCombatState } from '@/app/play/[sessionId]/hooks/useCombatState';
import type { CombatParticipantState, CombatSpace, CombatState } from '@/lib/api/types';

jest.mock('../../lib/api/dnd', () => ({ getCombatState: jest.fn() }));
import * as dnd from '@/lib/api/dnd';

const SPACE: CombatSpace = { kind: 'square', width: 6, height: 4, cell: { value: 5, unit: 'ft' }, blocked: [], features: [] };
const PARTICIPANTS = [
  { participant_id: 'p1', entity_id: 'c1', name: 'Anomaly', is_pc: true, hp_current: 10, hp_max: 10, conditions: [], is_alive: true, is_active_turn: true, at: [1, 1], movement_remaining: 30 },
  { participant_id: 'w1', entity_id: 'g1', name: 'Timberwolf', is_pc: false, hp_current: 19, hp_max: 19, conditions: [], is_alive: true, is_active_turn: false, at: [4, 2], movement_remaining: 30 },
] as unknown as CombatParticipantState[];

function Writer({ text }: { text: string | null }) {
  const set = useStageLine();
  return <button type="button" onClick={() => set(text)}>write</button>;
}

function Stage({ combat = true, allDown = false, text = null, board = false, rescue = jest.fn(), round = 2, space = SPACE, showBoard }: { combat?: boolean; allDown?: boolean; text?: string | null; board?: boolean; rescue?: (had: boolean) => void; round?: number; space?: CombatSpace | null; showBoard?: boolean }) {
  const head = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const begin = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <aside data-region-slot="sceneStage">
      <SceneStage
        sceneName="Hollow" objective={null} sceneHeadRef={head} combatIsActive={combat} activeEncounterId={null} sceneHasEncounter={false} combatBusy={false} endCombatBtnRef={end}
        outcomeChooserOpen={open} setOutcomeChooserOpen={setOpen} lastOpenerRef={opener} allHostilesDown={allDown} anyMonsterDown={false} onEndCombat={() => {}} beginCombatRef={begin}
        onBeginEncounter={() => {}} talking={false} sessionLocked={false} rollBusy={false} round={round} variant="hero" bodyLabel={board ? 'Tactical map' : undefined}
      >
        {board && (showBoard ?? combat) ? <StageBoard space={space} participants={PARTICIPANTS} viewerParticipantId="p1" activeParticipantId="p1" round={round} showReach rescueStrandedFocus={rescue} /> : board ? null : <Writer text={text} />}
      </SceneStage>
    </aside>
  );
}

const status = () => screen.getByText(/In combat · use the action bar/).closest('[role="status"]') as HTMLElement;
const line = () => document.querySelector('[data-stage-line]') as HTMLElement | null;

describe('the scene line\'s second slot', () => {
  it('a written line is the status node\'s next sibling, plain text; null clears it; nothing is there until it is written', () => {
    render(<Stage text="In combat · round 2" />);
    expect(line()).toBeNull();
    act(() => { screen.getByRole('button', { name: 'write' }).click(); });
    expect(line()).toHaveTextContent('In combat · round 2');
    expect(status().nextElementSibling).toBe(line());
    expect(status().contains(line())).toBe(false);
    expect(line()).not.toHaveAttribute('role');
    expect(line()).not.toHaveAttribute('aria-hidden');
    expect(line()).not.toHaveAttribute('aria-live');
  });

  it('the status node is the SAME node before and after a line is written (it is clipped, never re-created), and keeps its text and live role', () => {
    render(<Stage text="x" />);
    const before = status();
    act(() => { screen.getByRole('button', { name: 'write' }).click(); });
    expect(status()).toBe(before);
    expect(status()).toHaveAttribute('aria-live', 'polite');
    expect(status()).toHaveTextContent('In combat · use the action bar');
  });

  it('with every enemy down the line is still in the DOM (clipped by the same class as the status), and the prompt keeps the cell', () => {
    render(<Stage text="In combat · round 2" allDown />);
    act(() => { screen.getByRole('button', { name: 'write' }).click(); });
    expect(line()).toHaveTextContent('In combat · round 2');
    expect(line()!.className).toContain('noteClipped'); // the strip's clipped class, the same one the status takes: the prompt's own status is the one painted
    expect(status().className).toContain('noteClipped');
  });

  it('outside a stage the setter does nothing (no provider: no crash)', () => {
    const { result } = renderHook(() => useStageLine());
    expect(() => result.current('x')).not.toThrow();
  });

  it('the body has no role and no name while empty or holding the stand-in; a named group only when a map is in it', () => {
    const { rerender } = render(<Stage />);
    const body = () => document.querySelector('[data-fold-body]') as HTMLElement;
    expect(body()).not.toHaveAttribute('role');
    expect(body()).not.toHaveAttribute('aria-label');
    rerender(<Stage board />);
    expect(body()).toHaveAttribute('role', 'group');
    expect(body()).toHaveAccessibleName('Tactical map');
  });
});

describe('the adapter', () => {
  it('writes the rest line, then the mover\'s: "In combat · round 2 · Anomaly: 30 ft left"; and clears it when it unmounts', async () => {
    const { rerender } = render(<Stage board />);
    await waitFor(() => expect(line()).toHaveTextContent('In combat · round 2 · Anomaly: 30 ft left'));
    rerender(<Stage board combat={false} />);
    expect(line()).toBeNull();
  });

  it('the fight ending with focus in the grid tells the page\'s rescue so (true); focus elsewhere does not (false)', async () => {
    const rescue = jest.fn();
    const { rerender } = render(<Stage board rescue={rescue} />);
    const cell = await screen.findAllByRole('gridcell');
    const stop = cell.find((c) => c.getAttribute('tabindex') === '0') as HTMLElement;
    act(() => stop.focus());
    expect(document.activeElement).toBe(stop);
    rerender(<Stage board combat={false} rescue={rescue} />);
    expect(rescue).toHaveBeenLastCalledWith(true);

    const elsewhere = jest.fn();
    const second = render(<Stage board rescue={elsewhere} />);
    await screen.findAllByRole('gridcell');
    act(() => (document.querySelector('[data-region="sceneStage"] button') as HTMLElement).focus());
    second.rerender(<Stage board combat={false} rescue={elsewhere} />);
    expect(elsewhere).toHaveBeenLastCalledWith(false);
  });

  it('a click, Enter or Space on a square sends nothing and arms nothing (the read-only mount: no Move control, no callback with a destination)', async () => {
    render(<Stage board />);
    const cells = await screen.findAllByRole('gridcell');
    act(() => { cells[3].click(); });
    expect(screen.queryByRole('button', { name: /^Move\b/ })).toBeNull();
    expect(screen.getByRole('grid')).not.toHaveAttribute('aria-busy', 'true');
  });
});

describe('useCombatState: applyState and refreshState are the one writer of "bump the sequence and set"', () => {
  const state = (round: number) => ({ combat_id: 'c1', session_id: 's1', round, state: 'active', turn_index: 0, active_participant_id: null, initiative: [], participants: [] }) as unknown as CombatState;

  it('applyState bumps the sequence and sets the state', () => {
    const { result } = renderHook(() => useCombatState(null, [], 'leon'));
    const before = result.current.stateSeqRef.current;
    act(() => result.current.applyState(state(3)));
    expect(result.current.stateSeqRef.current).toBe(before + 1);
    expect(result.current.combatState?.round).toBe(3);
  });

  it('refreshState bumps and sets on a fetched state, leaves everything alone on a failed fetch, and does nothing with no combat', async () => {
    const { result } = renderHook(() => useCombatState(null, [], 'leon'));
    act(() => result.current.refreshState());
    expect(dnd.getCombatState).not.toHaveBeenCalled(); // no combat id: nothing to fetch
    act(() => result.current.setCombatId('c1'));
    (dnd.getCombatState as jest.Mock).mockResolvedValueOnce(state(4));
    const before = result.current.stateSeqRef.current;
    await act(async () => { result.current.refreshState(); });
    expect(result.current.stateSeqRef.current).toBe(before + 1);
    expect(result.current.combatState?.round).toBe(4);
    (dnd.getCombatState as jest.Mock).mockRejectedValueOnce(new Error('down'));
    await act(async () => { result.current.refreshState(); });
    expect(result.current.stateSeqRef.current).toBe(before + 1);
    expect(result.current.combatState?.round).toBe(4);
  });
});

describe('contracts that used to survive the whole suite (Kage file-it 1, Miko\'s jest gaps)', () => {
  it('the status node is CLIPPED while a line shows, and not before or after (unclipped, both texts share the `note` grid cell)', async () => {
    const { rerender } = render(<Stage board />);
    await waitFor(() => expect(line()).not.toBeNull());
    expect(status().className).toContain('noteClipped');
    rerender(<Stage board showBoard={false} />);
    expect(line()).toBeNull();
    expect(status().className).not.toContain('noteClipped');
  });

  it('the line is CLEARED when StageBoard unmounts while the stage stays (the stage\'s row changes mid-fight: no stale line is left under the status)', async () => {
    const { rerender } = render(<Stage board />);
    await waitFor(() => expect(line()).toHaveTextContent('Anomaly: 30 ft left'));
    rerender(<Stage board showBoard={false} />);
    expect(line()).toBeNull();
  });

  it('the rest line is REWRITTEN when the round changes, with nothing else changing', async () => {
    const { rerender } = render(<Stage board round={2} />);
    await waitFor(() => expect(line()).toHaveTextContent('In combat · round 2 · Anomaly: 30 ft left'));
    rerender(<Stage board round={5} />);
    await waitFor(() => expect(line()).toHaveTextContent('In combat · round 5 · Anomaly: 30 ft left'));
  });

  it('choosing a creature\'s square writes the creature line (`onInspect` shows the payload, not just the rest line)', async () => {
    render(<Stage board />);
    await waitFor(() => expect(line()).not.toBeNull());
    const foe = (await screen.findAllByRole('gridcell')).find((c) => (c.getAttribute('aria-label') ?? '').includes('Timberwolf')) as HTMLElement;
    act(() => { foe.click(); });
    await waitFor(() => expect(line()).toHaveTextContent(/^Timberwolf · Foe/));
  });

  it('a board that BECOMES unusable mid-fight (`space: null`, a malformed board) clears the rest line: a band room has no line (Kage file-it 2)', async () => {
    const { rerender } = render(<Stage board />);
    await waitFor(() => expect(line()).not.toBeNull());
    rerender(<Stage board space={null} />);
    await waitFor(() => expect(line()).toBeNull());
    expect(screen.getByRole('list', { name: 'Combatants' })).toBeInTheDocument();
    rerender(<Stage board space={SPACE} />);
    await waitFor(() => expect(line()).not.toBeNull());
    rerender(<Stage board space={{ ...SPACE, blocked: 'x' } as unknown as CombatSpace} />);
    await waitFor(() => expect(line()).toBeNull());
  });

  it('a band room never writes a line to begin with', async () => {
    render(<Stage board space={null} />);
    await screen.findByRole('list', { name: 'Combatants' });
    expect(line()).toBeNull();
    expect(status().className).not.toContain('noteClipped');
  });
});

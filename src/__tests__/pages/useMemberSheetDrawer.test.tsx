/** A9c C7 (build brief 5.2/5.3) -- the hook's docked contract and Kage S9. */
import { act, renderHook } from '@testing-library/react';
import { useMemberSheetDrawer } from '@/app/play/[sessionId]/hooks/useMemberSheetDrawer';
import type { CharacterSheet, Participant } from '@/lib/api/types';

jest.mock('../../lib/api/dnd', () => ({ getCharacterSheet: jest.fn(() => new Promise(() => {})) }));

const sheet = (name: string, hp: number) =>
  ({ character_id: 'c1', name, hp: { current: hp, max: 30, temp: 0 } }) as unknown as CharacterSheet;
const ME: Participant = {
  username: 'alice',
  is_dm: false,
  character: { character_id: 'c1', name: 'Torvin', char_class: 'Fighter', level: 1, current_hp: 30, max_hp: 30, ac: 10 },
};

describe('useMemberSheetDrawer', () => {
  it('docked: the panel gets NO onClose (the fold handle is the control); the Drawer close still exists', () => {
    const { result } = renderHook(() => useMemberSheetDrawer('alice', sheet('Torvin', 30), true, jest.fn()));
    expect(result.current.panelProps.onClose).toBeUndefined();
    expect(typeof result.current.onClose).toBe('function');
  });

  it('as a layer: the panel gets the Drawer close', () => {
    const { result } = renderHook(() => useMemberSheetDrawer('alice', sheet('Torvin', 30), false, jest.fn()));
    expect(result.current.panelProps.onClose).toBe(result.current.onClose);
  });

  it('docked: picking a member calls onReveal; as a layer it opens the Drawer instead', () => {
    const onReveal = jest.fn();
    const docked = renderHook(() => useMemberSheetDrawer('alice', sheet('Torvin', 30), true, onReveal));
    act(() => docked.result.current.onSelectMember(ME));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(docked.result.current.open).toBe(false);

    const onReveal2 = jest.fn();
    const layer = renderHook(() => useMemberSheetDrawer('alice', sheet('Torvin', 30), false, onReveal2));
    act(() => layer.result.current.onSelectMember(ME));
    expect(onReveal2).not.toHaveBeenCalled();
    expect(layer.result.current.open).toBe(true);
  });

  it('Kage S9: a self-selection follows the LIVE mySheet, not the click-time snapshot', () => {
    let mine = sheet('Torvin', 30);
    const { result, rerender } = renderHook(() => useMemberSheetDrawer('alice', mine, false, jest.fn()));
    act(() => result.current.onSelectMember(ME));
    expect(result.current.panelProps.sheet).toBe(mine);
    mine = sheet('Torvin', 12);
    rerender();
    expect(result.current.panelProps.sheet).toBe(mine);
    expect(result.current.panelProps.isSelf).toBe(true);
  });
});

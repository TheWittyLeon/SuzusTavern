/**
 * B8c-3 run 2 (Kage file-it 5): `StageBoard` is memoised. The page re-renders for every streamed narration chunk; `useBoard` hands the same stage props until the state, the viewer, the round, the
 * reach or the rescue changes (and the rescue is a `useCallback`), so a re-render of the page with the same props must NOT render the map again; a poll's new `participants` array must.
 * Mutation seen red: `export default memo(StageBoard)` back to the bare function -> "not re-rendered by the page" goes red (the map renders on every parent render).
 */
import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StageBoard from '@/app/play/[sessionId]/StageBoard';
import type { CombatParticipantState, CombatSpace } from '@/lib/api/types';

let mockRenders = 0;
jest.mock('../../components/tactical-map/TacticalMap', () => ({ __esModule: true, default: () => { mockRenders += 1; return <div data-testid="map" />; } }));

const SPACE = { kind: 'square', width: 6, height: 4, cell: { value: 5, unit: 'ft' }, blocked: [], features: [] } as unknown as CombatSpace;
const PARTICIPANTS = [{ participant_id: 'p1', name: 'A' }] as unknown as CombatParticipantState[];
const rescue = () => {};

function Parent({ participants }: { participants: CombatParticipantState[] }) {
  const [n, setN] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setN(n + 1)}>chunk {n}</button>
      <StageBoard space={SPACE} participants={participants} viewerParticipantId="p1" activeParticipantId="p1" round={2} showReach rescueStrandedFocus={rescue} />
    </div>
  );
}

describe('StageBoard is memoised', () => {
  beforeEach(() => { mockRenders = 0; });

  it('is not re-rendered by the page re-rendering with the same props; a new participants array (a poll) renders it', () => {
    const { rerender } = render(<Parent participants={PARTICIPANTS} />);
    expect(mockRenders).toBe(1);
    for (let i = 0; i < 3; i++) act(() => { screen.getByRole('button', { name: /chunk/ }).click(); });
    expect(mockRenders).toBe(1);
    rerender(<Parent participants={[...PARTICIPANTS]} />);
    expect(mockRenders).toBe(2);
  });
});

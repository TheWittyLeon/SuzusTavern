/**
 * A9b fix round 1, Min-7 -- the composer-refocus rescue on combat's falling
 * edge (`useFocusAnchors`) must only rescue STRANDED focus. It was moved
 * verbatim from Composer.tsx unconditional, so a human DM typing in another
 * field when combat ended had focus pulled into the composer textarea.
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useFocusAnchors } from '@/app/play/[sessionId]/hooks/useFocusAnchors';

jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

function Harness({ combatIsActive, showActionBar }: { combatIsActive: boolean; showActionBar: boolean }) {
  const { composerTextareaAnchorRef } = useFocusAnchors(false, false, null, { current: null }, combatIsActive, 'story');
  return (
    <div>
      <textarea aria-label="composer" ref={composerTextareaAnchorRef} />
      <input aria-label="dm field" />
      {showActionBar ? <button>Attack</button> : null}
    </div>
  );
}

describe('useFocusAnchors -- composer refocus on combat end', () => {
  it('human DM: focus already elsewhere is NOT stolen when combat ends', () => {
    const { rerender } = render(<Harness combatIsActive showActionBar />);
    screen.getByLabelText('dm field').focus();
    rerender(<Harness combatIsActive={false} showActionBar={false} />);
    expect(screen.getByLabelText('dm field')).toHaveFocus();
    expect(screen.getByLabelText('composer')).not.toHaveFocus();
  });

  it('player: focus stranded by the unmounting action bar lands on the composer', () => {
    const { rerender } = render(<Harness combatIsActive showActionBar />);
    screen.getByRole('button', { name: 'Attack' }).focus();
    rerender(<Harness combatIsActive={false} showActionBar={false} />);
    expect(document.activeElement).toBe(screen.getByLabelText('composer'));
  });

  it('nothing focused (body) when combat ends: the composer is the anchor', () => {
    const { rerender } = render(<Harness combatIsActive showActionBar={false} />);
    expect(document.activeElement).toBe(document.body);
    rerender(<Harness combatIsActive={false} showActionBar={false} />);
    expect(document.activeElement).toBe(screen.getByLabelText('composer'));
  });
});

/** Iro m-3 (Kage's candidate, kept under a behaviour name): on your own turn, a locked Move in the described form says why, from its own reason node; every other row says nothing new. */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActionBar, { type ActionBarProps } from '@/app/play/[sessionId]/regions/ActionBar';

const props = (over: Partial<ActionBarProps> = {}): ActionBarProps => ({ targets: [{ id: 'm1', name: 'Goblin' }], onAction: jest.fn(), isPlayerTurn: true, ...over });
const move = (reason?: string) => ({ pressed: false, disabled: true, reason, onToggle: jest.fn() }) as unknown as ActionBarProps['move'];
it('your turn, no feet left, described form: Move is described by "No movement left"', () => {
  render(<ActionBar {...props({ turnLine: 'Your turn!', move: move('No movement left') })} variant="bar" />);
  expect(screen.getByRole('button', { name: 'Move' })).toHaveAccessibleDescription('No movement left');
});
it('every other row (no turn line): no reason node, no description', () => {
  render(<ActionBar {...props({ move: move('No movement left') })} variant="bar" />);
  expect(screen.getByRole('button', { name: 'Move' })).not.toHaveAttribute('aria-describedby');
  expect(screen.queryByText('No movement left')).toBeNull();
});

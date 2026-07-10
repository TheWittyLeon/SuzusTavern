/**
 * ChatLog — TAV-19 (axe serious): the scroll container must be keyboard
 * focusable so non-pointer users can scroll the transcript. Locks tabIndex=0
 * alongside the pre-existing role="log" / aria-live="polite" contract (must
 * not regress either while fixing focusability).
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChatLog, { type LogRow } from '../../components/ChatLog';

function makeRows(): LogRow[] {
  return [
    { id: 'r1', who: 'leon', kind: 'player', text: 'I push open the door.', ts: '10:00' },
    { id: 'r2', who: 'Suzu', kind: 'narration', text: 'It creaks.', ts: '10:01' },
  ];
}

describe('ChatLog — keyboard focusability (TAV-19)', () => {
  it('the log container is a tab stop (tabIndex=0)', () => {
    render(<ChatLog rows={makeRows()} />);
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('tabindex', '0');
  });

  it('keeps role="log" and aria-live="polite" intact', () => {
    render(<ChatLog rows={makeRows()} />);
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');
  });

  it('the log container can actually receive focus', () => {
    render(<ChatLog rows={makeRows()} />);
    const log = screen.getByRole('log');
    log.focus();
    expect(log).toHaveFocus();
  });

  it('still renders rows normally', () => {
    render(<ChatLog rows={makeRows()} />);
    expect(screen.getByText('I push open the door.')).toBeInTheDocument();
    expect(screen.getByText('It creaks.')).toBeInTheDocument();
  });
});

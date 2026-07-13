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

describe('ChatLog — DM-NARRATION-MARKDOWN inline emphasis', () => {
  const narr = (text: string): LogRow[] => [
    { id: 'n', who: 'Suzu', kind: 'narration', text, ts: '10:00' },
  ];

  it('renders **bold** as <strong> in narration (the check-invite case)', () => {
    render(<ChatLog rows={narr('the ground reads wrong — make a **Perception** check')} />);
    expect(screen.getByText('Perception').tagName).toBe('STRONG');
  });

  it('renders *italic* as <em> in narration', () => {
    render(<ChatLog rows={narr('they seem bored, but not *completely* inattentive')} />);
    expect(screen.getByText('completely').tagName).toBe('EM');
  });

  it('does NOT parse markdown in player rows — user text stays literal', () => {
    render(
      <ChatLog rows={[{ id: 'p', who: 'leon', kind: 'player', text: 'I cast *magic*', ts: '1' }]} />,
    );
    expect(screen.getByText('I cast *magic*')).toBeInTheDocument();
    expect(screen.queryByText('magic')).toBeNull(); // not split into an <em>
  });

  it('is XSS-safe: HTML in narration is escaped as text, not injected', () => {
    const { container } = render(
      narrRender('beware <img src=x onerror="alert(1)"> the **dark**'),
    );
    // The tag must NOT become a real element — it renders as literal text.
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    // …and legitimate markdown around it still resolves.
    expect(screen.getByText('dark').tagName).toBe('STRONG');
  });

  it('leaves plain narration (no markers) unchanged', () => {
    render(<ChatLog rows={narr('It creaks, low and deliberate.')} />);
    expect(screen.getByText('It creaks, low and deliberate.')).toBeInTheDocument();
  });

  it('parses markdown in human-DM (dm_narration) rows too', () => {
    render(
      <ChatLog
        rows={[{ id: 'd', who: 'DM', kind: 'dm_narration', text: 'the door is **locked**', ts: '1' }]}
      />,
    );
    expect(screen.getByText('locked').tagName).toBe('STRONG');
  });

  it('parses markdown in dm_override rows too', () => {
    render(
      <ChatLog
        rows={[{ id: 'o', who: 'DM', kind: 'dm_override', text: 'ruling: that is *not* allowed', ts: '1' }]}
      />,
    );
    expect(screen.getByText('not').tagName).toBe('EM');
  });

  it('renders both **bold** and *italic* in one row', () => {
    render(<ChatLog rows={narr('make a **Stealth** check or move *carefully*')} />);
    expect(screen.getByText('Stealth').tagName).toBe('STRONG');
    expect(screen.getByText('carefully').tagName).toBe('EM');
  });

  it('renders a streaming partial marker literally (no crash, resolves later)', () => {
    // Mid-stream a row can hold an unclosed "**Perce" — must render literally.
    const { rerender } = render(
      <ChatLog rows={[{ id: 's', who: 'Suzu', kind: 'narration', text: 'make a **Perce', ts: '1', streaming: true }]} />,
    );
    expect(screen.getByText(/make a \*\*Perce/)).toBeInTheDocument();
    // …and once the closing marker arrives, it resolves to <strong>.
    rerender(
      <ChatLog rows={[{ id: 's2', who: 'Suzu', kind: 'narration', text: 'make a **Perception** check', ts: '1' }]} />,
    );
    expect(screen.getByText('Perception').tagName).toBe('STRONG');
  });

  function narrRender(text: string) {
    return <ChatLog rows={narr(text)} />;
  }
});

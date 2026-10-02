/**
 * A10 step 11 round 3 (Aoi's ruling): the composer's lock reason takes NO HEIGHT, and the input and Send share one row element.
 *
 * The lock reason was a visible banner above the field (40px for the length of a narration), which stepped the board, the log and the safety control. It is an ALWAYS-MOUNTED, visually hidden
 * live region now (an always-mounted region is what makes the announcement reliable), with the reason's visible marks in the placeholder, the title and a lock glyph at the field's trailing
 * edge. jsdom has no layout: this pins the structure (mounted always, `sr-only`, no banner class, the glyph decorative); the browser half is the harness's `c:lockLine` (the composer's box and its
 * neighbours' are identical locked and unlocked, in Story, Table and the phone).
 *
 * Controls: render the reason conditionally -> the "mounted when unlocked" case reds; give the region a visible class -> the hidden case reds; make the glyph a role=img -> the decorative case
 * reds; drop `.inputRow` -> the shared-row case reds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Composer from '@/components/Composer';

const base = { value: '', onChange: jest.fn(), onSend: jest.fn(), onMode: jest.fn(), mode: 'say' as const };
const region = (c: HTMLElement) => c.querySelector('[data-composer-lock]') as HTMLElement;

describe('the lock reason takes no height', () => {
  it('the live region is mounted when nothing is locked, empty, visually hidden and a status', () => {
    const { container } = render(<Composer {...base} />);
    const r = region(container);
    expect(r).toBeInTheDocument();
    expect(r).toHaveAttribute('role', 'status');
    expect(r).toHaveTextContent('');
    expect(r.className).toBe('sr-only');
    expect(container.querySelector('[data-composer-lock-glyph]')).toBeNull();
  });

  it('a narration lock sets the region\'s text and the glyph, stays OFF (its owner announces it), and no in-flow banner appears', () => {
    const { container, rerender } = render(<Composer {...base} />);
    const before = region(container);
    rerender(<Composer {...base} disabled disabledReason="Suzu is narrating — one moment…" />);
    const r = region(container);
    expect(r).toBe(before); // the same node: mounted always, never swapped in
    expect(r).toHaveTextContent('Suzu is narrating — one moment…');
    expect(r).toHaveAttribute('aria-live', 'off');
    const glyph = container.querySelector('[data-composer-lock-glyph]') as HTMLElement;
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph.querySelector('[role="img"]')).toBeNull();
    // the only role=status in the composer is the hidden region: no visible banner is rendered
    const statuses = container.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].className).toBe('sr-only');
    // the reason is still the placeholder and the title
    const field = screen.getByLabelText('Compose (say)');
    expect(field).toHaveAttribute('placeholder', 'Suzu is narrating — one moment…');
    expect(field).toHaveAttribute('title', 'Suzu is narrating — one moment…');
  });

  it('a send in flight is announced politely ("Sending…"), and clearing the lock clears the text in the same node', () => {
    const { container, rerender } = render(<Composer {...base} pending value="hello" />);
    const r = region(container);
    expect(r).toHaveTextContent('Sending…');
    expect(r).toHaveAttribute('aria-live', 'polite');
    rerender(<Composer {...base} value="" />);
    expect(region(container)).toBe(r);
    expect(r).toHaveTextContent('');
    expect(container.querySelector('[data-composer-lock-glyph]')).toBeNull();
  });

  it('a typed draft stays while locked (the placeholder is hidden, so the glyph and the story\'s composing row carry the reason)', () => {
    const { container } = render(<Composer {...base} value="a draft" disabled disabledReason="Session is paused." />);
    expect(screen.getByLabelText('Compose (say)')).toHaveValue('a draft');
    expect(container.querySelector('[data-composer-lock-glyph]')).toHaveAttribute('title', 'Session is paused.');
  });

  it('the send error stays IN FLOW as an alert (it must be read; it is rare; a named held cell in the harness)', () => {
    const { container } = render(<Composer {...base} sendError="The send failed." />);
    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    expect(alert).toHaveTextContent('The send failed.');
    expect(alert.className).toContain('sendError');
  });
});

describe('the input and Send share one row element (Kage suggestion 5)', () => {
  it('the textarea and Send have the same `.inputRow` ancestor, which is not the mode row\'s', () => {
    const { container } = render(<Composer {...base} variant="roll" tools={<button type="button">Roll</button>} />);
    const textarea = screen.getByLabelText('Compose (say)');
    const send = screen.getByRole('button', { name: 'Send' });
    const rowOf = (el: Element) => el.closest('[class*="inputRow"]');
    expect(rowOf(textarea)).not.toBeNull();
    expect(rowOf(textarea)).toBe(rowOf(send));
    expect(rowOf(screen.getByRole('button', { name: 'Roll' }))).toBeNull();
    expect(container.querySelectorAll('[class*="inputRow"]')).toHaveLength(1);
  });
});

describe('the stylesheet gives the lock no box', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/components/Composer.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // every rule of the selector, joined (the locked field has two: its look, and the end padding)
  const rule = (sel: string) => [...css.matchAll(new RegExp(`${sel.replace(/[.[\]()'=*^$+?{}|\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(' ');

  it('no `.lockStatus` banner rule is left, the glyph is out of flow and inert, and a locked field reserves 28px at its end', () => {
    expect(css).not.toMatch(/\.lockStatus/);
    expect(rule('.lockGlyph')).toMatch(/position:\s*absolute/);
    expect(rule('.lockGlyph')).toMatch(/pointer-events:\s*none/);
    expect(rule(".input[aria-disabled='true']")).toMatch(/padding-inline-end:\s*28px/);
    expect(rule('.field')).toMatch(/position:\s*relative/);
  });
});

/**
 * A9d-2 fix round 2 (Iro Minor-4): the phone's composer (`roll` variant) is ONE 44px row at 16px, where the long placeholders wrap and are cut at
 * their first line (the DM's 397px in 288 at 390; Say's 279px in 258 at 360). It takes a SHORT placeholder; the long text stays on the field as its
 * accessible description. The browser half is the harness's `r:placeholder` (measureText <= the field's inner width at every phone cell).
 *
 * Controls: use PLACEHOLDER for every variant -> the short-placeholder cases red; drop aria-describedby -> the description case reds; show the short
 * placeholder while locked -> the lock case reds.
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Composer, { type ComposeMode } from '@/components/Composer';

const LONG: Record<ComposeMode, string> = {
  say: 'Say something. Suzu will narrate back.',
  act: 'I climb the chimney quietly…',
  ooc: 'Out-of-character. Visible to the table, not the world.',
  dm_narration: 'Narrate the scene as DM… (or speak as an NPC above)',
};
const field = (mode: ComposeMode) => screen.getByLabelText(`Compose (${mode})`);
const base = { value: '', onChange: jest.fn(), onSend: jest.fn(), onMode: jest.fn() };

describe('Composer placeholder: short on the phone row, long everywhere else', () => {
  it.each(Object.keys(LONG) as ComposeMode[])('%s: the roll variant shows a short placeholder and keeps the long text as the field\'s description', (mode) => {
    render(<Composer {...base} mode={mode} variant="roll" availableModes={[[mode, 'M']]} />);
    const ph = field(mode).getAttribute('placeholder') ?? '';
    expect(ph.length).toBeGreaterThan(0);
    expect(ph.length).toBeLessThan(LONG[mode].length);
    expect(field(mode)).toHaveAccessibleDescription(LONG[mode]);
  });

  it.each(Object.keys(LONG) as ComposeMode[])('%s: the full variant (desktop) keeps the long placeholder and adds no description', (mode) => {
    render(<Composer {...base} mode={mode} variant="full" availableModes={[[mode, 'M']]} />);
    expect(field(mode)).toHaveAttribute('placeholder', LONG[mode]);
    expect(field(mode)).not.toHaveAttribute('aria-describedby');
  });

  it('the accessible NAME is unchanged on the phone (eight suites and the harness find the field by "Compose (say)")', () => {
    render(<Composer {...base} mode="say" variant="roll" />);
    expect(screen.getByRole('textbox', { name: 'Compose (say)' })).toBeInTheDocument();
  });

  it('a locked composer shows its lock reason whole, on the phone too, and does not describe itself twice', () => {
    render(<Composer {...base} mode="say" variant="roll" disabled disabledReason="Suzu is narrating — one moment…" />);
    expect(field('say')).toHaveAttribute('placeholder', 'Suzu is narrating — one moment…');
    expect(field('say')).not.toHaveAttribute('aria-describedby');
  });
});

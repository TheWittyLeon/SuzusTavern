/** A9c C7 (build brief 5.2) -- FoldDock is a disclosure with ONE handle. */
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FoldDock from '@/components/FoldDock';

function dock(props: Partial<React.ComponentProps<typeof FoldDock>> = {}) {
  const onToggle = jest.fn();
  const ui = (p: Partial<React.ComponentProps<typeof FoldDock>> = {}) => (
    <FoldDock folded={false} onToggle={onToggle} label="Character sheet" icon="Scroll" {...props} {...p}>
      <h2 id="h">Sheet</h2>
    </FoldDock>
  );
  return { onToggle, ui, ...render(ui()) };
}

describe('FoldDock', () => {
  it('open: one handle with a stable name, aria-expanded true, aria-controls the panel, Fold title', () => {
    dock();
    const handle = screen.getByRole('button', { name: 'Character sheet' });
    expect(handle).toHaveAttribute('aria-expanded', 'true');
    expect(handle).toHaveAttribute('title', 'Fold character sheet');
    const panel = document.getElementById(handle.getAttribute('aria-controls') as string);
    expect(panel).toContainElement(screen.getByRole('heading', { name: 'Sheet' }));
    expect(panel).not.toHaveAttribute('hidden');
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('the handle precedes the panel in the DOM, open and folded (Kage 4 / Iro MINOR-1)', () => {
    const { rerender, ui } = dock();
    for (const folded of [false, true]) {
      rerender(ui({ folded }));
      const handle = screen.getByRole('button', { name: 'Character sheet' });
      const panel = document.getElementById(handle.getAttribute('aria-controls') as string) as HTMLElement;
      expect(handle.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('folded: the SAME handle node says Open, the children stay mounted but hidden', () => {
    const { rerender, ui } = dock();
    const handle = screen.getByRole('button', { name: 'Character sheet' });
    rerender(ui({ folded: true }));
    expect(screen.getByRole('button', { name: 'Character sheet' })).toBe(handle);
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    expect(handle).toHaveAttribute('title', 'Open character sheet');
    expect(document.getElementById('h')).toBeInTheDocument();
    expect(document.getElementById('h')).not.toBeVisible();
  });

  it('pressing the handle calls onToggle and keeps focus on it', () => {
    const { onToggle } = dock();
    const handle = screen.getByRole('button', { name: 'Character sheet' });
    handle.focus();
    fireEvent.click(handle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveFocus();
  });

  it('the panel is a labelled region only when labelledBy is given (Iro MINOR-4)', () => {
    const { rerender, ui } = dock();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    rerender(ui({ labelledBy: 'h' }));
    expect(screen.getByRole('region', { name: 'Sheet' })).toBeInTheDocument();
  });

  it('foldable={false} is inert: no handle, never hidden, no landmark, same tree position', () => {
    const { rerender, ui } = dock({ labelledBy: 'h' });
    const heading = screen.getByRole('heading', { name: 'Sheet' });
    rerender(ui({ foldable: false, folded: true, labelledBy: 'h' }));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sheet' })).toBe(heading);
    expect(heading).toBeVisible();
  });
});

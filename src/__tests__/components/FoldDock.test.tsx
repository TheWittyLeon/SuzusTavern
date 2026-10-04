/** A9c C7 (build brief 5.2) -- FoldDock is a disclosure with ONE handle. */
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FoldDock, { FoldHandleSlot, useFoldBody } from '@/components/FoldDock';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

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

  describe('with a fold body (A9d-2 F1)', () => {
    function bodyDock(folded: boolean) {
      return render(
        <FoldDock folded={folded} onToggle={() => {}} label="Scene stage" icon="Map" body="the-body">
          <p id="head">head</p>
          <FoldHandleSlot />
          <div id="the-body" data-fold-body>picture</div>
          <button type="button">End</button>
        </FoldDock>,
      );
    }

    it('aria-controls names the BODY, and folding never hides the panel or anything outside the body', () => {
      bodyDock(true);
      const handle = screen.getByRole('button', { name: 'Scene stage' });
      expect(handle).toHaveAttribute('aria-expanded', 'false');
      expect(handle).toHaveAttribute('aria-controls', 'the-body');
      // The panel is not hidden: head and End stay rendered and in the AX tree.
      expect(document.querySelector('[hidden]')).toBeNull();
      expect(screen.getByRole('button', { name: 'End' })).toBeVisible();
      expect(document.getElementById('head')).toBeVisible();
      // The stylesheet hides only the body, keyed on the dock's folded state.
      expect(document.querySelector('[data-folded="true"] [data-fold-body]')).toBe(document.getElementById('the-body'));
    });

    it('without a body the whole panel folds, as before (control: the `body` prop is what changes it)', () => {
      render(
        <FoldDock folded onToggle={() => {}} label="Scene stage" icon="Map">
          <button type="button">End</button>
        </FoldDock>,
      );
      expect(screen.getByRole('button', { name: 'Scene stage' }).getAttribute('aria-controls')).not.toBe('the-body');
      expect(document.querySelector('[hidden]')).not.toBeNull();
    });
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
    // MINOR-3: the type of thing is part of the name, not the bare heading
    expect(screen.getByRole('region', { name: 'Character sheet: Sheet' })).toBeInTheDocument();
  });

  it('the name prefix is ONE text node, so no engine joins "Character sheet" and ":" with a space (Iro MINOR-4)', () => {
    const { container, rerender, ui } = dock();
    rerender(ui({ labelledBy: 'h' }));
    const prefix = container.querySelector('span[hidden]');
    expect(prefix?.childNodes).toHaveLength(1);
    expect(prefix?.textContent).toBe('Character sheet:');
  });

  it('foldable={false} is inert: no handle, never hidden, no landmark, same tree position', () => {
    const { rerender, ui } = dock({ labelledBy: 'h' });
    const heading = screen.getByRole('heading', { name: 'Sheet' });
    rerender(ui({ foldable: false, folded: true, labelledBy: 'h' }));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sheet' })).toBe(heading);
    expect(heading).toBeVisible();
    // MINOR-3 guard: an inert dock takes no role, no name and renders no name node, folded or not
    const panel = heading.parentElement as HTMLElement;
    expect(panel).not.toHaveAttribute('role');
    expect(panel).not.toHaveAttribute('aria-labelledby');
    expect(document.querySelector('[hidden]')).toBeNull();
  });
});

// A9d-2 N5 (named exception, Kage S2): `data-has-body` used to mean BOTH "only a part folds" and "content-sized" (a rule that sized the dock
// to its content so the stage's tenants followed it). The content-sized rule is deleted: step 12's map is a body that wants to FILL its
// track. `data-has-body` still means only the first. What pins the deletion: the last assertion here.
describe('FoldDock with a body: data-has-body says only that a part folds (it no longer sizes the dock)', () => {
  it('the dock carries data-has-body only when a body is declared, and the stylesheet carries no sizing rule keyed on it', () => {
    const { container, rerender } = render(
      <FoldDock folded={false} onToggle={() => {}} label="Scene stage" icon="Map" body="b"><FoldHandleSlot /><div id="b" data-fold-body /></FoldDock>,
    );
    expect(container.querySelector('[data-foldable]')).toHaveAttribute('data-has-body', 'true');
    rerender(<FoldDock folded={false} onToggle={() => {}} label="Character sheet" icon="Scroll"><div /></FoldDock>);
    expect(container.querySelector('[data-foldable]')).not.toHaveAttribute('data-has-body');
    const css = readFileSync(resolvePath(process.cwd(), 'src/components/FoldDock.module.css'), 'utf8');
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/data-has-body/);
  });
});

// B8c-4 P0 (Amendment H.3, H.4): in body mode the dock PROVIDES its handle and the region PLACES it; the dock provides the folded state and the region hides its body.
describe('FoldDock body mode: the handle is placed by the region, the folded state is provided (B8c-4 P0)', () => {
  function Region() {
    const folded = useFoldBody();
    return (
      <>
        <button type="button">End</button>
        <FoldHandleSlot />
        <div id="b" data-fold-body hidden={folded}><button type="button">sq</button></div>
      </>
    );
  }
  const mount = (p: Partial<React.ComponentProps<typeof FoldDock>> = {}) =>
    render(<FoldDock folded={false} onToggle={jest.fn()} label="Map" icon="Map" body="b" text="Map" {...p}><Region /></FoldDock>);

  it('the slot draws the handle where the region put it (after End, before the body); the dock paints none of its own', () => {
    const { container } = mount();
    expect(container.querySelectorAll('button[aria-expanded]')).toHaveLength(1);
    const handle = screen.getByRole('button', { name: 'Map' });
    expect(screen.getByRole('button', { name: 'End' }).compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(handle.compareDocumentPosition(document.getElementById('b') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(handle).toHaveTextContent('Map');
    expect(handle).toHaveAttribute('aria-controls', 'b');
  });

  it('the same handle node in both states; the body takes the hidden attribute from the provided state', () => {
    const { rerender } = mount();
    const handle = screen.getByRole('button', { name: 'Map' });
    rerender(<FoldDock folded onToggle={jest.fn()} label="Map" icon="Map" body="b" text="Map"><Region /></FoldDock>);
    expect(screen.getByRole('button', { name: 'Map' })).toBe(handle);
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('b')).toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: 'End' })).toBeVisible();
  });

  it('lockedReason: aria-disabled, still focusable, aria-expanded false, described by the reason, and a press is deaf', () => {
    const onToggle = jest.fn();
    mount({ onToggle, lockedReason: 'Folded while the safety card is showing' });
    const handle = screen.getByRole('button', { name: 'Map' });
    expect(handle).toHaveAttribute('aria-disabled', 'true');
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(handle.getAttribute('aria-describedby') as string)).toHaveTextContent('Folded while the safety card is showing');
    handle.focus();
    expect(handle).toHaveFocus();
    fireEvent.click(handle);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('a locked handle\'s tooltip is its reason, never "Open map" over a press that does nothing (Iro m-4)', () => {
    mount({ onToggle: jest.fn(), lockedReason: 'Folded while the safety card is showing' });
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('title', 'Folded while the safety card is showing');
  });

  it('the handle takes touch-action: manipulation (a second tap inside the 400ms guard must not be a double-tap zoom) and the corner-float rule never matches a body handle (Tora MINOR-4, Iro m-5)', () => {
    const css = readFileSync(resolvePath(process.cwd(), 'src/components/FoldDock.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (sel: string) => { const at = css.indexOf(`${sel} {`); return at < 0 ? '' : css.slice(at, css.indexOf('}', at)); };
    expect(rule('.handle')).toMatch(/touch-action:\s*manipulation/);
    expect(rule(".dock:not([data-folded='true']) .handle:not(.handleBody)")).toMatch(/position:\s*absolute/);
  });

  it('a body dock whose region renders no slot throws in development', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<FoldDock folded={false} onToggle={jest.fn()} label="Map" icon="Map" body="b"><div id="b" data-fold-body /></FoldDock>)).toThrow(/FoldHandleSlot/);
    spy.mockRestore();
  });

  it('outside a dock: no state is provided (false) and the slot renders nothing, so a region used alone never hides its body', () => {
    const { container } = render(<Region />);
    expect(container.querySelectorAll('button[aria-expanded]')).toHaveLength(0);
    expect(document.getElementById('b')).not.toHaveAttribute('hidden');
  });

  it('an inert body dock (foldable false) paints no handle and needs no slot', () => {
    const { container } = render(<FoldDock folded={false} foldable={false} onToggle={jest.fn()} label="Map" icon="Map" body="b"><div id="b" data-fold-body /></FoldDock>);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});

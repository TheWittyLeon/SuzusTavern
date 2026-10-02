/**
 * A9d-2 fix round QA (Miko, 2026-10-02) -- the popover surface's own stylesheet had no pin: removing `overscroll-behavior: contain`
 * (a clamped popover would hand its scroll to the page behind it, Tora's rule), raising its `z-index` over the drawers' scrim and a modal
 * (a popover open UNDER a modal swallows the modal's buttons: the dismissing click is consumed), or dropping `overflow-y: auto` (a clamped
 * popover would clip instead of scrolling) each survived the whole jest tree. Text-shape guards: jsdom computes no cascade, so the browser
 * halves are the harness's v:scrollCue and the popover legs.
 */
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const block = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};

describe('AnchoredPopover.module.css', () => {
  const css = read('src/components/AnchoredPopover.module.css');
  const pop = block(css, '.popover');

  it('a clamped popover scrolls inside and never hands the scroll to the page: overflow-y auto + overscroll-behavior contain', () => {
    expect(pop).toMatch(/overflow-y:\s*auto/);
    expect(pop).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('it stacks above the page and the header but BELOW the drawers\' scrim (899) and a modal (1000): never open under one', () => {
    const z = Number(/z-index:\s*(\d+)/.exec(pop)?.[1]);
    const drawerScrim = Number(/\.scrim\s*\{[^}]*z-index:\s*(\d+)/.exec(read('src/components/Drawer.module.css'))?.[1]);
    const modal = Number(/z-index:\s*(\d+)/.exec(read('src/components/ConfirmDialog.module.css'))?.[1]);
    expect(Number.isFinite(z) && Number.isFinite(drawerScrim) && Number.isFinite(modal)).toBe(true);
    expect(z).toBeLessThan(drawerScrim);
    expect(z).toBeLessThan(modal);
    expect(z).toBeGreaterThan(100); // above every slot / the header (isolation: isolate owners sit in the tens)
  });

  it('closed (keepMounted) it is display: none: out of the layout and the accessibility tree, not just transparent', () => {
    expect(block(css, '.closed')).toMatch(/display:\s*none/);
  });

  it('it paints the scroll cue only while there is more to scroll: the local-attachment cover over a scroll-attached shadow, in the shared `.scrollCue` class the popover composes', () => {
    // A9d-2 fix round 2: the cue moved out of `.popover` into `.scrollCue` so the Attack menu (its own DOM position) shares ONE. This case read `.popover`.
    expect(pop).toMatch(/composes:\s*scrollCue/);
    expect(block(css, '.scrollCue')).toMatch(/background-attachment:\s*local,\s*local,\s*scroll,\s*scroll/);
  });

  it('the Attack menu (Composer.module.css `.pop`) takes the same cue and contains its scroll, and does not reset it with the `background` shorthand', () => {
    const composer = read('src/components/Composer.module.css');
    const popRule = block(composer, '.pop');
    expect(popRule).toMatch(/overscroll-behavior:\s*contain/);
    expect(popRule).not.toMatch(/background:\s/);
    expect(read('src/app/play/[sessionId]/regions/ActionBar.tsx')).toMatch(/popoverStyles\.scrollCue/);
  });
});

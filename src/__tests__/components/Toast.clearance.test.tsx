/**
 * A9d-2 fix round 4 (Kage C-1, a safety finding; round 2 was Tora MAJOR-1 = Iro MAJOR-2): the toast host is placed by EXCLUSION on every layout.
 * The page marks what a toast must never cover (`data-toast-avoid`: the safety block and the composer) and what it should clear when it can
 * (`data-toast-clear`: the header, party band and scene strip); the host tries the bottom edge, then the top under the clear marks, then the top
 * edge, and keeps the first whose own box overlaps no avoid mark. Round 2 keyed it on a width query that never reached the desktop: above 880px the
 * host sat on the X-card and took its click. The browser pin is the harness's `toast-xcard*` legs (a hit test at three centres + one tap, phone and
 * desktop, Story and Table); these are the pure halves: the placement the host is given, and the stylesheet text that reads it.
 */
import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '@/components/Toast';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function Fire() {
  const { toast } = useToast();
  return <button onClick={() => toast({ message: 'Hello toast', tone: 'warn' })}>fire</button>;
}

type Box = [left: number, top: number, right: number, bottom: number];
const domRect = ([left, top, right, bottom]: Box) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} }) as DOMRect;

/**
 * Render the provider with `clear` and `avoid` boxes (elements carrying data-toast-clear / data-toast-avoid), a screen and a stack height. The host's
 * own box is computed from the placement the code asked for, the way the stylesheet would place it: bottom = 24px above the screen's bottom, top =
 * `--toast-top` + 8px below the screen's top. Nothing in this harness knows a width: a phone and a desktop differ only by their boxes.
 */
function open({ clear = [] as Box[], avoid = [] as Box[], width = 390, height = 844, stack = 103 } = {}) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  const left = Math.max(12, width - 400 - 24);
  const spy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.getAttribute('data-component') === 'ToastViewport') {
      if (el.getAttribute('data-placement') === 'top') {
        const top = Number.parseFloat(el.style.getPropertyValue('--toast-top') || '0') + 8;
        return domRect([left, top, width - 12, top + stack]);
      }
      return domRect([left, height - 24 - stack, width - 12, height - 24]);
    }
    const m = el.dataset?.box;
    return domRect(m ? (m.split(',').map(Number) as Box) : [0, 0, 0, 0]);
  });
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('data-component') === 'ToastViewport' ? stack : 0;
  });
  render(
    <ToastProvider>
      {clear.map((b, i) => <div key={`c${i}`} data-toast-clear="" data-box={b.join(',')} />)}
      {avoid.map((b, i) => <div key={`a${i}`} data-toast-avoid="" data-box={b.join(',')} />)}
      <Fire />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByText('fire'));
  const host = document.querySelector('[data-component="ToastViewport"]') as HTMLElement;
  return { host, placement: () => host.getAttribute('data-placement'), top: () => host.style.getPropertyValue('--toast-top'), spy };
}

describe('Toast host placement (data-placement, --toast-top)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => { jest.runAllTimers(); });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('control: nothing to avoid, the host stays at the bottom', () => {
    const { placement } = open({ clear: [[0, 0, 390, 224]] });
    expect(placement()).toBe('bottom');
  });

  it('a phone: the composer and the safety block fill the bottom, so the host sits below the LOWEST clear mark (header, party band, scene strip stay clear)', () => {
    const { placement, top } = open({ clear: [[0, 0, 390, 56], [0, 56, 390, 160], [0, 160, 390, 224]], avoid: [[0, 700, 390, 790], [0, 790, 390, 844]] });
    expect(placement()).toBe('top');
    expect(top()).toBe('224px');
  });

  it('THE DESKTOP SHAPE (C-1): the safety block is bottom-right under where a bottom host would stand, with no width anywhere in the decision: the host leaves the bottom', () => {
    // 1440x900: the X-card block is at 833..1138 x 842..896 and the composer above it; the right column's party strip and scene strip end at 365
    const { placement, top } = open({
      width: 1440, height: 900, stack: 84,
      clear: [[22, 16, 1138, 129], [1182, 16, 1418, 95], [1182, 161, 1418, 365]],
      avoid: [[833, 842, 1138, 896], [100, 770, 1160, 830]],
    });
    expect(placement()).toBe('top');
    expect(top()).toBe('365px');
  });

  it('an avoid mark that is NOT under the bottom edge leaves the host there (the composer scrolled out of a reflow page)', () => {
    expect(open({ avoid: [[0, 1200, 390, 1300]] }).placement()).toBe('bottom');
  });

  it('a short screen (a 400% zoom, 256px): the stack does not fit under the lower marks, so it takes the top, never below the fold and never over the composer', () => {
    const { placement, top } = open({ width: 320, height: 256, stack: 103, clear: [[0, 0, 320, 56], [0, 56, 320, 160], [0, 160, 320, 300]], avoid: [[0, 200, 320, 256]] });
    expect(placement()).toBe('top');
    expect(Number.parseFloat(top()) + 8 + 103).toBeLessThanOrEqual(256 - 0);
  });

  it('control: the same screen with room (the stack ends at 160+8+83 = 251 of 256) sits under the clear marks when that box overlaps no avoid mark', () => {
    const { top } = open({ width: 320, height: 256, stack: 83, clear: [[0, 0, 320, 56], [0, 56, 320, 160]], avoid: [[0, 140, 320, 150]] });
    expect(top()).toBe('160px');
  });

  it('when no placement is clear of every avoid mark, the least-overlapped one is kept', () => {
    // two full-width blocks: one over the whole screen but a 50px band at 100..150, one at the bottom. Every candidate touches one of them; the smaller overlap wins.
    const { placement } = open({ stack: 83, clear: [], avoid: [[0, 0, 390, 100], [0, 150, 390, 844]] });
    expect(placement()).toBe('top');
  });

  // Kage round-4 N-1: the raised safety banner is a never-cover mark too, and the fallback is RANKED, not summed.
  it('THE BANNER (Table 1440x900): the top edge would sit on the banner, the bottom on the composer and the X-card block: neither is taken, the host goes UNDER the banner', () => {
    const banner: Box = [168, 72, 1118, 130];
    const { placement, top } = open({
      width: 1440, height: 900, stack: 84,
      clear: [[168, 8, 613, 72], [1182, 16, 1418, 95], [1182, 161, 1418, 365]],
      avoid: [banner, [282, 755, 1118, 822], [1113, 842, 1418, 896]],
    });
    expect(placement()).toBe('top');
    expect(Number.parseFloat(top())).toBeGreaterThanOrEqual(banner[3]);
  });

  it('RANKED: a candidate that touches a never-cover mark loses to one that does not, however much more of the clear marks it covers', () => {
    // the bottom and the top edge each touch a never-cover mark; the line under the top one touches none and covers the big clear block: it wins despite that
    const { placement, top } = open({
      width: 390, height: 844, stack: 100,
      clear: [[0, 100, 390, 700]],
      avoid: [[0, 0, 390, 90], [0, 760, 390, 844]],
    });
    expect(placement()).toBe('top');
    expect(Number.parseFloat(top())).toBe(90);
  });

  it('the placement is dropped with the last toast (nothing is left on the host)', () => {
    const { host } = open({ clear: [[0, 0, 390, 224]], avoid: [[0, 700, 390, 844]] });
    expect(host.getAttribute('data-placement')).toBe('top');
    expect(host.style.getPropertyValue('--toast-top')).toBe('224px');
    act(() => { jest.runAllTimers(); });
    expect(host.getAttribute('data-placement')).toBeNull();
    expect(host.style.getPropertyValue('--toast-top')).toBe('');
  });
});

describe('Toast.module.css: the placements', () => {
  const css = stripComments(read('src/components/Toast.module.css'));

  it('the base host is bottom-right; the top placement is a data-placement rule that releases the bottom and reads --toast-top', () => {
    expect(css).toMatch(/\.viewport\s*\{[^}]*bottom:\s*24px/);
    expect(css).toMatch(/\.viewport\[data-placement='top'\]\s*\{[^}]*top:\s*calc\([^;]*var\(--toast-top/);
    expect(css).toMatch(/\.viewport\[data-placement='top'\]\s*\{[^}]*bottom:\s*auto/);
    expect(css).toMatch(/\.viewport\[data-placement='top'\]\s*\{[^}]*flex-direction:\s*column\s*;/);
  });

  it('placement is NOT a width query: no media block touches .viewport (the 880px one that kept the desktop on the X-card is gone)', () => {
    for (const m of css.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)) expect(m[1]).not.toMatch(/\.viewport/);
  });

  it('the card is still compact on a phone (12px padding and gap, not the density\'s 22 / 16), in a block AFTER the base .toast rule: at 320x256 it must end above the composer\'s first row', () => {
    const base = css.indexOf('.toast {');
    const at = css.indexOf('@media (max-width: 880px)');
    expect(base).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(base);
    const block = css.slice(at, css.indexOf('\n}\n', at));
    expect(block).toMatch(/\.toast\s*\{[^}]*padding:\s*var\(--space-6\)/);
    expect(block).toMatch(/\.toast\s*\{[^}]*gap:\s*var\(--space-6\)/);
  });
});

describe('Toast.module.css: the card is SOLID (Iro round-4 MAJOR-1)', () => {
  const css = stripComments(read('src/components/Toast.module.css'));
  const rule = css.slice(css.indexOf('.toast {'), css.indexOf('\n}\n', css.indexOf('.toast {')));

  it('.toast paints on --card-solid, not on --card (4% white: it only reads as a card over a blur the Chromium build does not keep)', () => {
    expect(rule).toMatch(/background:\s*var\(--card-solid\)/);
    expect(rule).not.toMatch(/background:\s*var\(--card\)/);
  });
});

describe('the /play regions mark themselves for the host', () => {
  it.each([
    ['TopBar', 'src/app/play/[sessionId]/regions/TopBar.tsx', 'data-region="topBar"'],
    ['PartyStrip', 'src/app/play/[sessionId]/regions/PartyStrip.tsx', 'data-region="partyStrip"'],
    ['SceneStage', 'src/app/play/[sessionId]/regions/SceneStage.tsx', 'data-region="sceneStage"'],
  ])('%s carries data-toast-clear on its root', (_name, file, root) => {
    expect(read(file)).toMatch(new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+data-toast-clear=""`));
  });

  it.each([
    ['SafetyControls (the X-card block)', 'src/app/play/[sessionId]/tenants/SafetyControls.tsx', 'data-tenant="safetyControls"'],
    ['Composer (Send, the textarea)', 'src/components/Composer.tsx', 'data-region="composer"'],
  ])('%s carries data-toast-avoid on its root', (_name, file, root) => {
    const src = read(file);
    const at = src.indexOf(root);
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, src.indexOf('>', at))).toMatch(/data-toast-avoid=""/);
  });
});

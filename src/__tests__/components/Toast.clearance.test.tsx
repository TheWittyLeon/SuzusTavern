/**
 * A9d-2 fix round 2 (Tora MAJOR-1 = Iro MAJOR-2, a safety finding): on a phone the toast host sits UNDER what the page marks `data-toast-clear`
 * (the /play header, party band and scene strip), never at the bottom where it covered the X-card, Send and the textarea and took the X-card's
 * tap. The browser pin is the harness's `toast-xcard` leg (hit test at three centres + one tap, both engines); these are the pure halves: the
 * number the host is given, and the stylesheet text that reads it.
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

const rect = (bottom: number) => ({ left: 0, right: 390, top: 0, bottom, width: 390, height: bottom, x: 0, y: 0, toJSON() {} }) as DOMRect;

/** Render the provider with `marks` (bottoms of elements carrying data-toast-clear), a phone or not, a screen height and a stack height. */
function open({ phone = true, marks = [] as number[], innerHeight = 844, stack = 103 } = {}) {
  window.matchMedia = jest.fn().mockReturnValue({ matches: phone, addEventListener: jest.fn(), removeEventListener: jest.fn() });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
  const spy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const i = Number((this as HTMLElement).dataset?.markIndex);
    return Number.isFinite(i) ? rect(marks[i]) : rect(0);
  });
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('data-component') === 'ToastViewport' ? stack : 0;
  });
  render(
    <ToastProvider>
      {marks.map((_, i) => (
        <div key={i} data-toast-clear="" data-mark-index={i} />
      ))}
      <Fire />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByText('fire'));
  const host = document.querySelector('[data-component="ToastViewport"]') as HTMLElement;
  return { host, top: () => host.style.getPropertyValue('--toast-top'), spy };
}

describe('Toast host clearance (--toast-top)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => { jest.runAllTimers(); });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('a phone: the host sits below the LOWEST marked element (the header, the party band and the scene strip stay clear)', () => {
    const { top } = open({ marks: [56, 160, 224] });
    expect(top()).toBe('224px');
  });

  it('control: with nothing marked the host is at the top edge (0px)', () => {
    expect(open({ marks: [] }).top()).toBe('0px');
  });

  it('the desktop (not the phone query): 0px, the bottom-right placement is untouched', () => {
    expect(open({ phone: false, marks: [56, 160, 224] }).top()).toBe('0px');
  });

  it('a short screen (a 400% zoom, 256px): the stack would not fit on the screen under the marks, so it takes the top edge, not below the fold', () => {
    expect(open({ innerHeight: 256, marks: [56, 160, 300], stack: 103 }).top()).toBe('0px');
  });

  it('control: the same screen with room (the stack ends at 160+8+83 = 251 of 256) sits under the marks', () => {
    expect(open({ innerHeight: 256, marks: [56, 160], stack: 83 }).top()).toBe('160px');
  });

  it('the offset is dropped with the last toast (nothing is left on the host)', () => {
    const { host } = open({ marks: [224] });
    expect(host.style.getPropertyValue('--toast-top')).toBe('224px');
    act(() => { jest.runAllTimers(); });
    expect(host.style.getPropertyValue('--toast-top')).toBe('');
  });
});

describe('Toast.module.css: the phone placement', () => {
  const css = stripComments(read('src/components/Toast.module.css'));
  const at = css.indexOf('@media (max-width: 880px)');

  it('at 880px and under the host is anchored to the TOP by --toast-top and releases the bottom: it can never sit over the last block of the page', () => {
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf('\n}\n', at));
    expect(block).toMatch(/\.viewport\s*\{[^}]*top:\s*calc\([^;]*var\(--toast-top/);
    expect(block).toMatch(/bottom:\s*auto/);
    expect(block).toMatch(/flex-direction:\s*column\s*;/);
  });

  it('and the card is compact there (12px padding and gap, not the density\'s 22 / 16), in a block AFTER the base .toast rule (equal specificity: the later wins): at 320x256 it must end above the composer\'s first row', () => {
    const base = css.indexOf('.toast {');
    const second = css.indexOf('@media (max-width: 880px)', at + 1);
    expect(base).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(base);
    const block = css.slice(second, css.indexOf('\n}\n', second));
    expect(block).toMatch(/\.toast\s*\{[^}]*padding:\s*var\(--space-6\)/);
    expect(block).toMatch(/\.toast\s*\{[^}]*gap:\s*var\(--space-6\)/);
  });

  it('the bottom-right placement stays the base rule (desktop)', () => {
    expect(css.slice(0, at)).toMatch(/\.viewport\s*\{[^}]*bottom:\s*24px/);
  });
});

describe('the /play regions above the story log mark themselves for the host to clear', () => {
  it.each([
    ['TopBar', 'src/app/play/[sessionId]/regions/TopBar.tsx', 'data-region="topBar"'],
    ['PartyStrip', 'src/app/play/[sessionId]/regions/PartyStrip.tsx', 'data-region="partyStrip"'],
    ['SceneStage', 'src/app/play/[sessionId]/regions/SceneStage.tsx', 'data-region="sceneStage"'],
  ])('%s carries data-toast-clear on its root', (_name, file, root) => {
    expect(read(file)).toMatch(new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+data-toast-clear=""`));
  });
});

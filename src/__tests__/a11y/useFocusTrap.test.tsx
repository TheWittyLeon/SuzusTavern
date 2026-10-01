/**
 * useFocusTrap — Iro A9c-2 IMPORTANT-2. The hand-rolled trap in TweaksPanel wrapped
 * only at the first/last of every `input, button`; a radio group is ONE tab stop
 * (the checked member), so the real last stop was the checked Layout radio ("Auto",
 * the FIRST of its group) and Tab from it walked out of the dialog.
 *
 * Mutation control: put the old `querySelectorAll('input, button')` first/last test
 * back in TweaksPanel and "Tab on the last real stop wraps" reds (jsdom does not move
 * focus on Tab, so the assertion is on the keydown's preventDefault + activeElement).
 * The real-browser pin is the harness's `focus-trap` probe (Tab x N, never leaves).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TweaksPanel from '@/components/TweaksPanel';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { PLAY_PHONE_QUERY } from '@/lib/breakpoints';
import { tabStops } from '@/lib/a11y/useFocusTrap';

const realMatchMedia = window.matchMedia;
function setPhone(isPhone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isPhone && query === PLAY_PHONE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  window.localStorage.clear();
  setPhone(false);
});
afterAll(() => {
  window.matchMedia = realMatchMedia;
});

describe('tabStops (what Tab actually visits)', () => {
  function mount(html: string) {
    const c = document.createElement('div');
    c.innerHTML = html;
    document.body.appendChild(c);
    return c;
  }
  afterEach(() => { document.body.innerHTML = ''; });

  it('collapses a radio group to its checked member, or the first when none is checked', () => {
    const c = mount(`
      <input type="radio" name="a" id="a1"><input type="radio" name="a" id="a2" checked><input type="radio" name="a" id="a3">
      <input type="radio" name="b" id="b1"><input type="radio" name="b" id="b2">
      <button id="x">x</button>`);
    expect(tabStops(c).map((e) => e.id)).toEqual(['a2', 'b1', 'x']);
  });

  it('drops disabled controls, fieldset[disabled] descendants and tabindex=-1', () => {
    const c = mount(`
      <button id="ok">ok</button>
      <button id="dis" disabled>d</button>
      <fieldset disabled><input type="radio" name="g" id="g1" checked></fieldset>
      <button id="roved" tabindex="-1">r</button>
      <a id="lnk" href="#x">l</a>`);
    expect(tabStops(c).map((e) => e.id)).toEqual(['ok', 'lnk']);
  });

  it('a group whose members are all inoperable contributes no stop', () => {
    const c = mount(`<fieldset disabled><input type="radio" name="g" checked><input type="radio" name="g"></fieldset><button id="b">b</button>`);
    expect(tabStops(c).map((e) => e.id)).toEqual(['b']);
  });
});

describe('TweaksPanel focus trap', () => {
  function open() {
    render(
      <ThemeProvider>
        <TweaksPanel />
      </ThemeProvider>,
    );
    const trigger = screen.getByRole('button', { name: /appearance settings/i });
    trigger.focus();
    fireEvent.click(trigger);
    return { trigger, dialog: screen.getByRole('dialog') };
  }
  const stops = (dialog: HTMLElement) => tabStops(dialog);

  it('Tab on the last REAL stop (the checked Layout radio, not the last in the DOM) wraps to the first', () => {
    const { dialog } = open();
    const s = stops(dialog);
    expect(s).toHaveLength(3); // palette, density, layout: one stop per group
    const last = s[s.length - 1];
    expect(last).toHaveAccessibleName(/^Auto$/); // first-in-group, last stop
    last.focus();
    const notPrevented = fireEvent.keyDown(last, { key: 'Tab' });
    expect(notPrevented).toBe(false); // the trap handled it
    expect(document.activeElement).toBe(s[0]);
  });

  it('Shift+Tab on the first stop wraps to the last', () => {
    const { dialog } = open();
    const s = stops(dialog);
    s[0].focus();
    expect(fireEvent.keyDown(s[0], { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(s[s.length - 1]);
  });

  it('a middle stop is left to the browser (not prevented)', () => {
    const { dialog } = open();
    const s = stops(dialog);
    s[1].focus();
    expect(fireEvent.keyDown(s[1], { key: 'Tab' })).toBe(true);
  });

  it('roving to another radio in the group still counts as that group\'s stop', () => {
    const { dialog } = open();
    const s = stops(dialog);
    // Focus a NON-representative member of the last group: arrow-keying checks it in a
    // browser, but a test (or AT) can land focus without checking. It must still wrap.
    const layoutRadios = screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).name === 'tavern-layout');
    layoutRadios[2].focus();
    expect(s[s.length - 1]).toBe(layoutRadios[0]);
    expect(fireEvent.keyDown(layoutRadios[2], { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(s[0]);
  });

  it('on a phone the Layout group is disabled, so the last stop is the checked Density radio', () => {
    setPhone(true);
    const { dialog } = open();
    const s = stops(dialog);
    expect(s).toHaveLength(2);
    const last = s[1];
    expect((last as HTMLInputElement).name).toBe('tavern-density');
    last.focus();
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(s[0]);
  });

  it('focus that lands outside the open dialog is pulled back in (focusin backstop)', () => {
    const { dialog } = open();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      outside.focus();
      expect(dialog.contains(document.activeElement)).toBe(true);
    } finally {
      outside.remove();
    }
  });

  it('every close path returns focus to the trigger: Escape, backdrop (Iro MINOR-2), and the trigger itself', () => {
    for (const how of ['escape', 'backdrop'] as const) {
      const { trigger, dialog } = open();
      if (how === 'escape') fireEvent.keyDown(dialog, { key: 'Escape' });
      else fireEvent.click(document.body.querySelector('div[aria-hidden="true"]')!);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      document.body.innerHTML = '';
    }
  });

  it('after close the backstop is gone: focus can leave the page region freely', () => {
    const { dialog } = open();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    expect(outside).toHaveFocus();
    outside.remove();
  });
});

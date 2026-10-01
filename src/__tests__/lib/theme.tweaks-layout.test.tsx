/**
 * TweaksPanel — the Layout group (A9c-2 D3, R23/R16). Mirrors the palette and
 * density tests in theme.test.tsx: Auto is the default and is never stored,
 * Story/Table write the key and `data-layout`, picking Auto clears both, and a
 * phone (one layout) sees the group disabled with the note.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import TweaksPanel from '@/components/TweaksPanel';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { PLAY_PHONE_QUERY } from '@/lib/breakpoints';
import {
  LAYOUT_KEY,
  LAYOUT_PHONE_NOTE,
  LAYOUT_PREFS,
  LAYOUT_PREF_HINTS,
  LAYOUT_PREF_LABELS,
} from '@/lib/theme/theme';

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

function open() {
  render(
    <ThemeProvider>
      <TweaksPanel />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /appearance settings/i }));
  return screen.getByRole('group', { name: 'Layout' }) as HTMLFieldSetElement;
}

const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}$`) });

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-layout');
  setPhone(false);
});
afterAll(() => {
  window.matchMedia = realMatchMedia;
});

describe('TweaksPanel — Layout group', () => {
  it('offers Auto / Story / Table from the theme constants, Auto checked, nothing stored', () => {
    const group = open();
    const names = LAYOUT_PREFS.map((l) => LAYOUT_PREF_LABELS[l]);
    expect(names).toEqual(['Auto', 'Story', 'Table']);
    for (const n of names) expect(radio(n)).toBeInTheDocument();
    expect(radio('Auto')).toBeChecked();
    expect(group).not.toBeDisabled();
    expect(window.localStorage.getItem(LAYOUT_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute('data-layout')).toBe(false);
    expect(screen.getByText(LAYOUT_PREF_HINTS.auto)).toBeInTheDocument();
  });

  it('Story writes the key and data-layout', () => {
    open();
    act(() => {
      fireEvent.click(radio('Story'));
    });
    expect(radio('Story')).toBeChecked();
    expect(window.localStorage.getItem(LAYOUT_KEY)).toBe('story');
    expect(document.documentElement.dataset.layout).toBe('story');
    expect(screen.getByText(LAYOUT_PREF_HINTS.story)).toBeInTheDocument();
  });

  it('Table writes the key and data-layout', () => {
    open();
    act(() => {
      fireEvent.click(radio('Table'));
    });
    expect(window.localStorage.getItem(LAYOUT_KEY)).toBe('table');
    expect(document.documentElement.dataset.layout).toBe('table');
  });

  it('picking Auto clears the key and the attribute (a default is never written)', () => {
    open();
    act(() => {
      fireEvent.click(radio('Table'));
    });
    act(() => {
      fireEvent.click(radio('Auto'));
    });
    expect(radio('Auto')).toBeChecked();
    expect(window.localStorage.getItem(LAYOUT_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute('data-layout')).toBe(false);
  });

  it('on a phone the group is disabled and says why', () => {
    setPhone(true);
    const group = open();
    expect(group).toBeDisabled();
    expect(screen.getByText(LAYOUT_PHONE_NOTE)).toBeInTheDocument();
    expect(LAYOUT_PHONE_NOTE).toBe('Phones use one layout.');
    expect(screen.queryByText(LAYOUT_PREF_HINTS.auto)).not.toBeInTheDocument();
    expect(radio('Table')).toBeDisabled();
    expect(radio('Auto')).toBeChecked();
    // The palette and density groups are not the phone's concern.
    expect(screen.getByRole('radio', { name: /aetheric/i })).not.toBeDisabled();
  });
});

describe('TweaksPanel — portaled, fixed, placed from the trigger (A9c-2 D3)', () => {
  it('renders the panel and backdrop under document.body, outside the trigger wrapper', () => {
    const { container } = render(
      <ThemeProvider>
        <TweaksPanel />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /appearance settings/i }));
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    expect(document.body.querySelectorAll(':scope > div[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it('is positioned under the trigger, right-aligned, and clamped into the viewport', () => {
    render(
      <ThemeProvider>
        <TweaksPanel />
      </ThemeProvider>,
    );
    const trigger = screen.getByRole('button', { name: /appearance settings/i });
    trigger.getBoundingClientRect = () =>
      ({ top: 6, bottom: 50, left: 456, right: 500, width: 44, height: 44, x: 456, y: 6, toJSON() {} }) as DOMRect;
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.top).toBe('60px'); // bottom 50 + 10
    expect(dialog.style.left).toBe('200px'); // right 500 - 300

    // A trigger near the left edge cannot push the panel off-screen.
    fireEvent.click(screen.getByRole('button', { name: /appearance settings/i, expanded: true }));
    trigger.getBoundingClientRect = () =>
      ({ top: 6, bottom: 50, left: 0, right: 44, width: 44, height: 44, x: 0, y: 6, toJSON() {} }) as DOMRect;
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog').style.left).toBe('12px');
  });

  it('consumes Escape: it closes, refocuses the trigger, and never reaches document', () => {
    const atDocument = jest.fn();
    document.addEventListener('keydown', atDocument);
    render(
      <ThemeProvider>
        <TweaksPanel />
      </ThemeProvider>,
    );
    const trigger = screen.getByRole('button', { name: /appearance settings/i });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    document.removeEventListener('keydown', atDocument);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(atDocument).not.toHaveBeenCalled();
  });

  it('Tab wraps within the panel past a disabled (phone) Layout group', () => {
    setPhone(true);
    open();
    const last = screen.getByRole('radio', { name: /airy/i });
    last.focus();
    // `airy` is the last ENABLED control; Tab must wrap to the first, not into the inert group.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(screen.getByRole('radio', { name: /^system/i })).toHaveFocus();
  });
});

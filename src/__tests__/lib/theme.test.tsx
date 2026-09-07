import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  DEFAULT_DENSITY,
  DEFAULT_VIBE,
  DENSITY_KEY,
  NO_FLASH_SCRIPT,
  VIBE_KEY,
  VIBES,
  isDensity,
  isVibe,
  isVibePref,
  prefersLight,
  resolveVibe,
} from '@/lib/theme/theme';
import { ThemeProvider, useTheme } from '@/lib/theme/ThemeProvider';
import TweaksPanel from '@/components/TweaksPanel';

describe('theme constants', () => {
  it('validates known vibes/densities and rejects junk', () => {
    expect(isVibe('candlelit')).toBe(true);
    expect(isVibe('nope')).toBe(false);
    expect(isVibe(null)).toBe(false);
    // undefined is a valid call-site value (e.g. dataset.vibe when attr absent)
    expect(isVibe(undefined)).toBe(false);
    expect(isDensity('airy')).toBe(true);
    expect(isDensity('huge')).toBe(false);
    expect(isDensity(undefined)).toBe(false);
  });

  it('no-flash script references the storage keys and validates values', () => {
    expect(NO_FLASH_SCRIPT).toContain(VIBE_KEY);
    expect(NO_FLASH_SCRIPT).toContain(DENSITY_KEY);
    // Guards every vibe so a tampered localStorage can't inject an attribute.
    expect(NO_FLASH_SCRIPT).toContain('hearthlight');
    expect(NO_FLASH_SCRIPT).toContain('dusk-tavern');
    expect(NO_FLASH_SCRIPT).toContain('candlelit');
    expect(NO_FLASH_SCRIPT).toContain('aetheric');
    expect(NO_FLASH_SCRIPT).toContain('moonlit-grove');
    // Guards every density.
    expect(NO_FLASH_SCRIPT).toContain('compact');
    expect(NO_FLASH_SCRIPT).toContain('cozy');
    expect(NO_FLASH_SCRIPT).toContain('airy');
    expect(NO_FLASH_SCRIPT).toContain('try');
    // UIR2-TAV-4: falls back to the OS scheme when no concrete palette is saved.
    expect(NO_FLASH_SCRIPT).toContain('prefers-color-scheme');
  });
});

function Probe() {
  const { vibe, density } = useTheme();
  return (
    <span data-testid="probe">
      {vibe}/{density}
    </span>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-vibe');
    document.documentElement.removeAttribute('data-density');
  });

  it('falls back to defaults when nothing is stored', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent(
      `${DEFAULT_VIBE}/${DEFAULT_DENSITY}`,
    );
  });

  it('seeds from the html dataset already painted by the no-flash script', () => {
    document.documentElement.dataset.vibe = 'aetheric';
    document.documentElement.dataset.density = 'airy';
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('aetheric/airy');
  });

  it('seeds from localStorage when dataset is absent but localStorage is set', async () => {
    // Simulates the edge case where the no-flash script ran but localStorage
    // held a valid value and the dataset attribute was never written (e.g. the
    // script encountered a guard miss or the user manually cleared the dataset).
    // dataset is already clear from beforeEach; set localStorage only.
    window.localStorage.setItem(VIBE_KEY, 'moonlit-grove');
    window.localStorage.setItem(DENSITY_KEY, 'compact');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    // useEffect fires after mount; wait one tick for state to settle.
    await act(async () => {});
    expect(screen.getByTestId('probe')).toHaveTextContent('moonlit-grove/compact');
    // DDX-THEME-MOUNT-DOM: this is the CSP-blocked/no-flash-skipped scenario
    // — the dataset attribute was never painted, so React resolved the vibe
    // from storage alone. The mount effect must mirror that resolution back
    // onto <html data-vibe>, not just React state, or the DOM stays on the
    // SSR default while the picker/UI think a different vibe is active.
    expect(document.documentElement.dataset.vibe).toBe('moonlit-grove');
  });

  it('throws if useTheme is used outside a provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
    spy.mockRestore();
  });
});

describe('TweaksPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-vibe');
    document.documentElement.removeAttribute('data-density');
  });

  function setup() {
    return render(
      <ThemeProvider>
        <TweaksPanel />
      </ThemeProvider>,
    );
  }

  it('opens the popover from the labelled trigger', () => {
    setup();
    const trigger = screen.getByRole('button', { name: /appearance settings/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: /appearance/i })).toBeInTheDocument();
  });

  it('selecting a palette applies it live and persists it', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /appearance settings/i }));
    const aetheric = screen.getByRole('radio', { name: /aetheric/i });
    act(() => {
      fireEvent.click(aetheric);
    });
    expect(document.documentElement.dataset.vibe).toBe('aetheric');
    expect(window.localStorage.getItem(VIBE_KEY)).toBe('aetheric');
  });

  it('selecting a density applies + persists it', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /appearance settings/i }));
    const airy = screen.getByRole('radio', { name: /airy/i });
    act(() => {
      fireEvent.click(airy);
    });
    expect(document.documentElement.dataset.density).toBe('airy');
    expect(window.localStorage.getItem(DENSITY_KEY)).toBe('airy');
  });

  it('Escape closes the panel and restores focus to the trigger', () => {
    setup();
    const trigger = screen.getByRole('button', { name: /appearance settings/i });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

// ---- UIR2-TAV-4: honoring the OS prefers-color-scheme -----------------------

type MockMql = {
  matches: boolean;
  media: string;
  addEventListener: (t: string, cb: () => void) => void;
  removeEventListener: (t: string, cb: () => void) => void;
  addListener: (cb: () => void) => void;
  removeListener: (cb: () => void) => void;
  onchange: null;
  dispatchEvent: () => boolean;
};

/** Install a jsdom `matchMedia` shim (jsdom ships none) that reports the given
 *  OS light preference and can fire a live change to registered listeners. */
function installMatchMedia(prefersLightMode: boolean) {
  const listeners = new Set<() => void>();
  const mql: MockMql = {
    matches: prefersLightMode,
    media: '(prefers-color-scheme: light)',
    addEventListener: (_t, cb) => void listeners.add(cb),
    removeEventListener: (_t, cb) => void listeners.delete(cb),
    addListener: (cb) => void listeners.add(cb),
    removeListener: (cb) => void listeners.delete(cb),
    onchange: null,
    dispatchEvent: () => true,
  };
  (window as unknown as { matchMedia: (q: string) => MockMql }).matchMedia = () => mql;
  return {
    setLight(nowLight: boolean) {
      mql.matches = nowLight;
      listeners.forEach((cb) => cb());
    },
  };
}

function uninstallMatchMedia() {
  // `delete` silently no-ops here instead of removing the property: jest.setup.ts
  // installs window.matchMedia via Object.defineProperty with `writable: true`
  // but no explicit `configurable`, which defaults to `false` — confirmed
  // empirically (delete returns `false`, doesn't throw, and the previously
  // installed mock is still live afterward, still returning its last mocked
  // value). A plain assignment to `undefined` DOES work: `writable: true` still
  // permits the value to change even though the property can't be deleted or
  // made configurable, and `undefined` is exactly the "absent" shape every call
  // site actually checks for (`typeof window.matchMedia === 'function'` /
  // truthiness) — so this achieves the contract this helper's name promises.
  (window as unknown as { matchMedia: undefined }).matchMedia = undefined;
}

/** Exposes both the resolved concrete vibe and the stored preference. */
function PrefProbe() {
  const { vibe, vibePref } = useTheme();
  return (
    <span data-testid="probe">
      {vibePref}:{vibe}
    </span>
  );
}

describe('ThemeProvider — honors OS prefers-color-scheme (UIR2-TAV-4)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-vibe');
  });
  afterEach(uninstallMatchMedia);

  it('resolves the system default to candlelit when the OS prefers light', async () => {
    installMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe')).toHaveTextContent('candlelit/');
  });

  it('resolves the system default to hearthlight when the OS prefers dark', async () => {
    installMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe')).toHaveTextContent('hearthlight/');
  });

  it('follows a live OS light→dark change while in system mode', async () => {
    const mm = installMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe')).toHaveTextContent('candlelit/');
    await act(async () => {
      mm.setLight(false);
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('hearthlight/');
    expect(document.documentElement.dataset.vibe).toBe('hearthlight');
  });

  it('does NOT override an explicit palette when the OS changes', async () => {
    const mm = installMatchMedia(false);
    window.localStorage.setItem(VIBE_KEY, 'aetheric');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe')).toHaveTextContent('aetheric/');
    await act(async () => {
      mm.setLight(true);
    });
    // Still aetheric — the user pinned it, so the OS listener is inert.
    expect(screen.getByTestId('probe')).toHaveTextContent('aetheric/');
  });
});

describe('TweaksPanel — System palette option (UIR2-TAV-4)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-vibe');
    installMatchMedia(false); // OS dark
  });
  afterEach(uninstallMatchMedia);

  function setup() {
    return render(
      <ThemeProvider>
        <TweaksPanel />
      </ThemeProvider>,
    );
  }

  it('offers System and selects it by default when nothing is pinned', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /appearance settings/i }));
    expect(screen.getByRole('radio', { name: /system/i })).toBeChecked();
  });

  it('choosing System clears any pinned palette (back to following the OS)', () => {
    window.localStorage.setItem(VIBE_KEY, 'aetheric');
    setup();
    fireEvent.click(screen.getByRole('button', { name: /appearance settings/i }));
    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: /system/i }));
    });
    expect(window.localStorage.getItem(VIBE_KEY)).toBeNull();
    // OS is dark in this test → resolves to the dark default.
    expect(document.documentElement.dataset.vibe).toBe('hearthlight');
  });
});

// ---- Miko adversarial pass: UIR2-TAV-4 coverage gaps ------------------------
// storage-disabled/private-mode, tampered VIBE_KEY, matchMedia absent, density
// interplay, rapid pref switching, listener leak on unmount.

describe('theme.ts pure functions — resolveVibe / isVibePref / prefersLight (UIR2-TAV-4)', () => {
  afterEach(uninstallMatchMedia);

  it('resolveVibe: system resolves per the OS flag; concrete vibes ignore the OS flag entirely', () => {
    expect(resolveVibe('system', true)).toBe('candlelit');
    expect(resolveVibe('system', false)).toBe('hearthlight');
    expect(resolveVibe('aetheric', true)).toBe('aetheric');
    expect(resolveVibe('aetheric', false)).toBe('aetheric');
    expect(resolveVibe('moonlit-grove', true)).toBe('moonlit-grove');
  });

  it('isVibePref: accepts "system" and every concrete vibe, rejects junk/empty/null/undefined', () => {
    expect(isVibePref('system')).toBe(true);
    for (const v of VIBES) expect(isVibePref(v)).toBe(true);
    expect(isVibePref('nonsense')).toBe(false);
    expect(isVibePref('')).toBe(false);
    expect(isVibePref(null)).toBe(false);
    expect(isVibePref(undefined)).toBe(false);
  });

  it('prefersLight: reflects matchMedia().matches when a matchMedia implementation is present', () => {
    installMatchMedia(true);
    expect(prefersLight()).toBe(true);
    installMatchMedia(false);
    expect(prefersLight()).toBe(false);
  });

  it('prefersLight: returns false, never throws, when matchMedia does not exist at all', () => {
    uninstallMatchMedia();
    expect(window.matchMedia).toBeUndefined();
    expect(prefersLight()).toBe(false);
  });

  it('prefersLight: returns false, never throws, when matchMedia itself throws when called', () => {
    // A hostile/locked-down implementation, distinct from "absent" — some
    // enterprise/embedded webviews define matchMedia as a throwing stub rather
    // than omitting it.
    (window as unknown as { matchMedia: () => unknown }).matchMedia = () => {
      throw new Error('SecurityError: matchMedia disabled by policy');
    };
    expect(() => prefersLight()).not.toThrow();
    expect(prefersLight()).toBe(false);
  });
});

describe('NO_FLASH_SCRIPT — actually executed, not just inspected as text (UIR2-TAV-4)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-vibe');
    document.documentElement.removeAttribute('data-density');
  });
  afterEach(uninstallMatchMedia);

  type MinimalStorage = { getItem(key: string): string | null };

  /**
   * Executes the real NO_FLASH_SCRIPT string against explicit window/document/
   * localStorage args (rather than ambient globals, to sidestep any jsdom
   * realm quirks). The existing tests above only assert the script's *source
   * text* contains the right substrings — these prove what it actually DOES
   * to the DOM, which is the only thing that matters for AC #1/#4.
   */
  function runNoFlashScript(storageOverride?: MinimalStorage) {
    const storage = storageOverride ?? window.localStorage;
    // This string IS the pre-paint script shipped to the browser; executing
    // it (not grepping its source) is the only way to prove its actual DOM
    // behavior.
    const fn = new Function('window', 'document', 'localStorage', NO_FLASH_SCRIPT);
    fn(window, document, storage);
  }

  it('applies a concrete stored vibe verbatim, even when the OS disagrees', () => {
    installMatchMedia(true); // OS light — must be ignored; a concrete choice wins
    window.localStorage.setItem(VIBE_KEY, 'aetheric');
    runNoFlashScript();
    expect(document.documentElement.dataset.vibe).toBe('aetheric');
  });

  it('resolves to candlelit when nothing is stored and the OS prefers light', () => {
    installMatchMedia(true);
    runNoFlashScript();
    expect(document.documentElement.dataset.vibe).toBe('candlelit');
  });

  it('resolves to hearthlight when nothing is stored and the OS prefers dark', () => {
    installMatchMedia(false);
    runNoFlashScript();
    expect(document.documentElement.dataset.vibe).toBe('hearthlight');
  });

  it('resolves to the dark default when matchMedia does not exist at all (old browser)', () => {
    uninstallMatchMedia();
    expect(window.matchMedia).toBeUndefined();
    runNoFlashScript();
    expect(document.documentElement.dataset.vibe).toBe('hearthlight');
  });

  it('discards a tampered/garbage VIBE_KEY value instead of writing it to the attribute verbatim', () => {
    installMatchMedia(false); // OS dark, so the fallback outcome is deterministic
    const payload = '"><img src=x onerror=alert(1)>';
    window.localStorage.setItem(VIBE_KEY, payload);
    runNoFlashScript();
    // Not a script-injection vector (setAttribute never parses its value as
    // HTML) — the real risk is a garbage value becoming the literal data-vibe,
    // which no globals.css block selects on, leaving the page unstyled.
    expect(document.documentElement.dataset.vibe).toBe('hearthlight');
    expect(document.documentElement.dataset.vibe).not.toBe(payload);
    expect(document.documentElement.getAttribute('data-vibe')).not.toContain('<img');
  });

  it('never throws, and leaves the attribute untouched, when localStorage.getItem itself throws', () => {
    document.documentElement.setAttribute('data-vibe', 'hearthlight'); // the build-time default baked into layout.tsx
    const throwingStorage: MinimalStorage = {
      getItem() {
        throw new Error('SecurityError: storage disabled');
      },
    };
    expect(() => runNoFlashScript(throwingStorage)).not.toThrow();
    // The `var d=…, v=localStorage.getItem(…), n=…` statement aborts entirely
    // on the first getItem() throw, so setAttribute never runs at all — the
    // attribute is left exactly as it was pre-script.
    expect(document.documentElement.dataset.vibe).toBe('hearthlight');
  });

  it('applies a valid density independently of the vibe fallback branch', () => {
    installMatchMedia(false);
    window.localStorage.setItem(VIBE_KEY, 'not-a-real-vibe'); // forces the vibe fallback branch
    window.localStorage.setItem(DENSITY_KEY, 'airy');
    runNoFlashScript();
    expect(document.documentElement.dataset.vibe).toBe('hearthlight');
    expect(document.documentElement.dataset.density).toBe('airy');
  });

  it('leaves data-density unset when no valid density is stored (pre-existing behavior, still true)', () => {
    installMatchMedia(false);
    runNoFlashScript();
    expect(document.documentElement.hasAttribute('data-density')).toBe(false);
  });
});

describe('globals.css — color-scheme tracks data-vibe (UIR2-TAV-4)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../app/globals.css'), 'utf8');

  function ruleBlockContaining(selectorSubstring: string): string {
    const idx = css.indexOf(selectorSubstring);
    expect(idx).toBeGreaterThan(-1); // sanity: the selector actually exists
    const end = css.indexOf('}', idx);
    return css.slice(idx, end);
  }

  it('declares color-scheme: light on the sole light palette (candlelit)', () => {
    expect(ruleBlockContaining('[data-vibe="candlelit"]')).toMatch(/color-scheme:\s*light/);
  });

  it('declares color-scheme: dark on every dark palette (hearthlight, dusk-tavern, aetheric, moonlit-grove)', () => {
    expect(ruleBlockContaining('[data-vibe="hearthlight"]')).toMatch(/color-scheme:\s*dark/);
    expect(ruleBlockContaining('[data-vibe="dusk-tavern"]')).toMatch(/color-scheme:\s*dark/);
    expect(ruleBlockContaining('[data-vibe="aetheric"]')).toMatch(/color-scheme:\s*dark/);
    expect(ruleBlockContaining('[data-vibe="moonlit-grove"]')).toMatch(/color-scheme:\s*dark/);
  });

  // NOTE: this only proves the stylesheet TEXT declares the right property.
  // jsdom has no real CSS cascade / UA-widget renderer, so it cannot prove
  // native controls (scrollbars, date pickers, form widgets) actually paint
  // light/dark correctly — that needs a real-browser check (flagged for the
  // deploy/browser pass, not silently skipped).
});

describe('ThemeProvider — storage disabled / private mode (UIR2-TAV-4)', () => {
  let originalGetItem: Storage['getItem'];
  let originalSetItem: Storage['setItem'];
  let originalRemoveItem: Storage['removeItem'];

  beforeEach(() => {
    originalGetItem = window.localStorage.getItem.bind(window.localStorage);
    originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
    document.documentElement.removeAttribute('data-vibe');
  });
  afterEach(() => {
    window.localStorage.getItem = originalGetItem;
    window.localStorage.setItem = originalSetItem;
    window.localStorage.removeItem = originalRemoveItem;
    window.localStorage.clear();
    uninstallMatchMedia();
  });

  it('mount does not crash and falls back to the OS-resolved default when localStorage.getItem throws', async () => {
    installMatchMedia(true); // OS light
    window.localStorage.getItem = () => {
      throw new Error('SecurityError: storage disabled');
    };
    render(
      <ThemeProvider>
        <PrefProbe />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe')).toHaveTextContent('system:candlelit');
  });

  it('setVibe does not crash and still updates DOM/state this session when localStorage.setItem throws', async () => {
    function Switcher() {
      const { vibe, setVibe } = useTheme();
      return (
        <div>
          <span data-testid="probe">{vibe}</span>
          <button onClick={() => setVibe('aetheric')}>pin</button>
        </div>
      );
    }
    render(
      <ThemeProvider>
        <Switcher />
      </ThemeProvider>,
    );
    await act(async () => {});
    window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => {
      act(() => {
        fireEvent.click(screen.getByText('pin'));
      });
    }).not.toThrow();
    expect(screen.getByTestId('probe')).toHaveTextContent('aetheric');
    expect(document.documentElement.dataset.vibe).toBe('aetheric');
  });

  it('choosing System does not crash when localStorage.removeItem throws (fails safe, not silently)', async () => {
    window.localStorage.setItem(VIBE_KEY, 'aetheric');
    installMatchMedia(false); // OS dark
    function Switcher() {
      const { vibe, setVibe } = useTheme();
      return (
        <div>
          <span data-testid="probe">{vibe}</span>
          <button onClick={() => setVibe('system')}>system</button>
        </div>
      );
    }
    render(
      <ThemeProvider>
        <Switcher />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe')).toHaveTextContent('aetheric');
    window.localStorage.removeItem = () => {
      throw new Error('SecurityError');
    };
    expect(() => {
      act(() => {
        fireEvent.click(screen.getByText('system'));
      });
    }).not.toThrow();
    // Resolves live even though the key removal itself silently failed.
    expect(screen.getByTestId('probe')).toHaveTextContent('hearthlight');
  });
});

describe('ThemeProvider — OS-listener lifecycle, no leak (UIR2-TAV-4)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-vibe');
  });
  afterEach(uninstallMatchMedia);

  it('removes the OS-change listener on unmount (a post-unmount OS flip is inert)', async () => {
    const mm = installMatchMedia(false); // OS dark
    const { unmount } = render(
      <ThemeProvider>
        <PrefProbe />
      </ThemeProvider>,
    );
    await act(async () => {});
    // Establish the listener is genuinely live BEFORE unmounting (the mount
    // effect itself only ever sets React state, never document.documentElement
    // — only a live OS-change event writes dataset.vibe — so we prove the
    // listener's DOM-writing effect exists at all before proving it stops).
    act(() => {
      mm.setLight(true);
    });
    expect(document.documentElement.dataset.vibe).toBe('candlelit');
    unmount();
    // If the listener had leaked, this would flip data-vibe back to hearthlight.
    act(() => {
      mm.setLight(false);
    });
    expect(document.documentElement.dataset.vibe).toBe('candlelit');
  });

  it('CHARACTERIZATION: an already-present data-vibe attribute wins on mount over BOTH the stored preference and the live OS setting — not a crash, but the fallback-resolve branch never fires if the DOM already looks "valid"', async () => {
    // Mirrors production if the no-flash inline script fails to execute for any
    // reason (e.g. an extension that blocks inline scripts but not the main JS
    // bundle) — layout.tsx's <html data-vibe="hearthlight"> hardcoded default
    // is itself a syntactically valid Vibe string, so the mount effect's
    // `isVibe(domVibe)` check can't distinguish "the script already resolved
    // this correctly" from "the script never ran, this is just the static
    // default." Not reachable via any CSP this app currently sets (none
    // configured — checked next.config.ts/middleware.ts) so this is a NOTE,
    // not a MUST-FIX; the shape itself is pre-existing (unchanged by this
    // diff — the old code had the same "trust domVibe, never re-derive"
    // mount-effect shape), it's just that a stale value used to always be
    // 'dusk-tavern', which used to always be the right answer regardless.
    document.documentElement.dataset.vibe = 'hearthlight'; // stands in for the un-rewritten SSR default
    installMatchMedia(true); // OS light — a fresh resolve would say candlelit
    window.localStorage.setItem(VIBE_KEY, 'moonlit-grove'); // user's actual pin, also ignored
    render(
      <ThemeProvider>
        <PrefProbe />
      </ThemeProvider>,
    );
    await act(async () => {});
    // vibePref correctly reads the real stored pin (moonlit-grove) — only the
    // PAINTED vibe stays stuck at the stale DOM value, a picker/paint mismatch.
    expect(screen.getByTestId('probe')).toHaveTextContent('moonlit-grove:hearthlight');
  });

  it('stops reacting to OS changes once the user pins away from system mid-session', async () => {
    const mm = installMatchMedia(false); // OS dark
    function Switcher() {
      const { vibe, setVibe } = useTheme();
      return (
        <div>
          <span data-testid="probe">{vibe}</span>
          <button onClick={() => setVibe('aetheric')}>pin</button>
        </div>
      );
    }
    render(
      <ThemeProvider>
        <Switcher />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe')).toHaveTextContent('hearthlight'); // system + OS dark
    act(() => {
      fireEvent.click(screen.getByText('pin'));
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('aetheric');
    act(() => {
      // If the old system-mode listener leaked, this would wrongly override
      // the user's explicit pin back to a system-resolved value.
      mm.setLight(true);
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('aetheric');
    expect(document.documentElement.dataset.vibe).toBe('aetheric');
  });

  it('re-subscribes to live OS changes after returning to system a second time (not a one-shot effect)', async () => {
    const mm = installMatchMedia(false); // OS dark
    function Switcher() {
      const { vibe, setVibe } = useTheme();
      return (
        <div>
          <span data-testid="probe">{vibe}</span>
          <button onClick={() => setVibe('aetheric')}>pin</button>
          <button onClick={() => setVibe('system')}>system</button>
        </div>
      );
    }
    render(
      <ThemeProvider>
        <Switcher />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe')).toHaveTextContent('hearthlight');
    act(() => {
      fireEvent.click(screen.getByText('pin'));
    });
    act(() => {
      fireEvent.click(screen.getByText('system'));
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('hearthlight'); // system + OS still dark
    act(() => {
      mm.setLight(true);
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('candlelit');
  });
});

describe('ThemeProvider / TweaksPanel — matchMedia genuinely absent (UIR2-TAV-4)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-vibe');
    uninstallMatchMedia();
  });

  it('resolves to the dark default and stays in system pref, without crashing, when matchMedia does not exist', async () => {
    expect(window.matchMedia).toBeUndefined(); // sanity: genuinely absent, not just "OS dark"
    render(
      <ThemeProvider>
        <PrefProbe />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe')).toHaveTextContent('system:hearthlight');
  });

  it('TweaksPanel still opens and shows System checked with no matchMedia present', () => {
    expect(window.matchMedia).toBeUndefined();
    render(
      <ThemeProvider>
        <TweaksPanel />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /appearance settings/i }));
    expect(screen.getByRole('radio', { name: /system/i })).toBeChecked();
  });
});

describe('ThemeProvider — density interplay with a live system-vibe change (UIR2-TAV-4)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-vibe');
    document.documentElement.removeAttribute('data-density');
  });
  afterEach(uninstallMatchMedia);

  function BothProbe() {
    const { vibe, density } = useTheme();
    return (
      <span data-testid="probe">
        {vibe}/{density}
      </span>
    );
  }

  it('an OS scheme change while in system vibe mode never touches an already-set density', async () => {
    const mm = installMatchMedia(true); // OS light
    window.localStorage.setItem(DENSITY_KEY, 'airy');
    document.documentElement.dataset.density = 'airy'; // mirrors what the no-flash script would have painted
    render(
      <ThemeProvider>
        <BothProbe />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe')).toHaveTextContent('candlelit/airy');
    await act(async () => {
      mm.setLight(false);
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('hearthlight/airy');
    expect(document.documentElement.dataset.density).toBe('airy');
  });
});

describe('TweaksPanel — rapid palette switching via the real UI (UIR2-TAV-4)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-vibe');
  });
  afterEach(uninstallMatchMedia);

  it('cycles aetheric -> system -> candlelit -> system(live), keeping storage/DOM/checked-radio in sync at every step', async () => {
    const mm = installMatchMedia(false); // OS dark
    render(
      <ThemeProvider>
        <TweaksPanel />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /appearance settings/i }));

    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: /aetheric/i }));
    });
    expect(screen.getByRole('radio', { name: /aetheric/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /system/i })).not.toBeChecked();
    expect(window.localStorage.getItem(VIBE_KEY)).toBe('aetheric');
    expect(document.documentElement.dataset.vibe).toBe('aetheric');

    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: /system/i }));
    });
    expect(screen.getByRole('radio', { name: /system/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /aetheric/i })).not.toBeChecked();
    expect(window.localStorage.getItem(VIBE_KEY)).toBeNull();
    expect(document.documentElement.dataset.vibe).toBe('hearthlight'); // OS dark

    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: /candlelit/i }));
    });
    expect(screen.getByRole('radio', { name: /candlelit/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /system/i })).not.toBeChecked();
    expect(window.localStorage.getItem(VIBE_KEY)).toBe('candlelit');
    expect(document.documentElement.dataset.vibe).toBe('candlelit');

    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: /system/i }));
    });
    expect(document.documentElement.dataset.vibe).toBe('hearthlight');
    act(() => {
      // Back in system mode — the live OS listener must be re-engaged.
      mm.setLight(true);
    });
    expect(document.documentElement.dataset.vibe).toBe('candlelit');
    expect(screen.getByRole('radio', { name: /system/i })).toBeChecked();
  });
});

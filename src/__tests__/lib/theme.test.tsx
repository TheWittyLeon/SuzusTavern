import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  DEFAULT_DENSITY,
  DEFAULT_VIBE,
  DENSITY_KEY,
  NO_FLASH_SCRIPT,
  VIBE_KEY,
  isDensity,
  isVibe,
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
    expect(NO_FLASH_SCRIPT).toContain('dusk-tavern');
    expect(NO_FLASH_SCRIPT).toContain('candlelit');
    expect(NO_FLASH_SCRIPT).toContain('aetheric');
    expect(NO_FLASH_SCRIPT).toContain('moonlit-grove');
    // Guards every density.
    expect(NO_FLASH_SCRIPT).toContain('compact');
    expect(NO_FLASH_SCRIPT).toContain('cozy');
    expect(NO_FLASH_SCRIPT).toContain('airy');
    expect(NO_FLASH_SCRIPT).toContain('try');
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

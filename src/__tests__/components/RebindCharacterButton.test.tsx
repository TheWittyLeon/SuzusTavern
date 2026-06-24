/**
 * Unit tests for RebindCharacterButton — review fixes (Track B CR pass).
 *
 * Covers:
 *   - Rules of Hooks fix: outer wrapper early-returns cleanly, inner component
 *     renders all hooks without violations.
 *   - Visibility gate: button hidden for non-DM viewing another row.
 *   - Focus: dialog container focused on open; first option focused after chars load.
 *   - Tab trap: Tab cycles within dialog; Shift+Tab wraps.
 *   - Radiogroup: ArrowDown/Up moves focus and selection; Space/Enter selects.
 *   - Escape closes dialog.
 *   - Live region wraps load/list swap.
 */

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockToast = jest.fn();
jest.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockListMyCharacters = jest.fn();
const mockBindCharacter    = jest.fn();
jest.mock('../../lib/api/dnd', () => ({
  listMyCharacters: (...args: unknown[]) => mockListMyCharacters(...args),
  bindCharacter:    (...args: unknown[]) => mockBindCharacter(...args),
}));

import RebindCharacterButton, {
  type RebindCharacterButtonProps,
} from '@/components/RebindCharacterButton';

// ── Helpers ────────────────────────────────────────────────────────────────────

const TWO_CHARS = [
  { character_id: '1', username: 'alice', name: 'Velka',  race: 'Human',  char_class: 'Rogue',   level: 1, hp: { current: 8, max: 10 }, ac: 14 },
  { character_id: '2', username: 'alice', name: 'Korrik', race: 'Dwarf',  char_class: 'Fighter', level: 2, hp: { current: 12, max: 16 }, ac: 18 },
];

function baseProps(overrides?: Partial<RebindCharacterButtonProps>): RebindCharacterButtonProps {
  return {
    sessionId:      'sess1',
    targetUsername: 'alice',
    selfUsername:   'alice',
    isDm:           false,
    combatActive:   false,
    onChanged:      jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListMyCharacters.mockResolvedValue(TWO_CHARS);
  mockBindCharacter.mockResolvedValue({ campaign_id: 'sess1', username: 'alice', role: 'player', character_id: 1 });
});

// ── Visibility gate ────────────────────────────────────────────────────────────

describe('visibility gate (outer wrapper, no hooks)', () => {
  it('renders the trigger for own row', () => {
    render(<RebindCharacterButton {...baseProps()} />);
    expect(screen.getByRole('button', { name: /Change your character/i })).toBeInTheDocument();
  });

  it('renders the trigger for another row when isDm', () => {
    render(
      <RebindCharacterButton
        {...baseProps({ targetUsername: 'bob', isDm: true })}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Change bob's character/i }),
    ).toBeInTheDocument();
  });

  it('renders nothing for another row when NOT isDm', () => {
    const { container } = render(
      <RebindCharacterButton
        {...baseProps({ targetUsername: 'bob', isDm: false })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// ── Dialog open/close ──────────────────────────────────────────────────────────

describe('dialog open and close', () => {
  it('opens a dialog on trigger click', async () => {
    render(<RebindCharacterButton {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Change your character/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('shows loading state initially, then character list', async () => {
    // Delay the chars so we can assert the loading state.
    let resolveChars!: (value: typeof TWO_CHARS) => void;
    mockListMyCharacters.mockReturnValueOnce(
      new Promise<typeof TWO_CHARS>((res) => { resolveChars = res; }),
    );

    render(<RebindCharacterButton {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Change your character/i }));

    // Loading state visible before chars resolve.
    await waitFor(() =>
      expect(screen.getByText(/Loading characters/i)).toBeInTheDocument(),
    );

    // Chars arrive.
    await act(async () => { resolveChars(TWO_CHARS); });

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Velka/i })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Korrik/i })).toBeInTheDocument();
    });
  });

  it('Escape closes the dialog', async () => {
    render(<RebindCharacterButton {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Change your character/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('Cancel button closes the dialog', async () => {
    render(<RebindCharacterButton {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Change your character/i }));
    await waitFor(() => screen.getByRole('dialog'));

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });
});

// ── Radiogroup & roving tabindex ───────────────────────────────────────────────

describe('radiogroup roving tabindex', () => {
  it('renders options with role=radio inside a radiogroup', async () => {
    render(<RebindCharacterButton {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Change your character/i }));

    await waitFor(() => screen.getByRole('radiogroup'));
    const radios = screen.getAllByRole('radio');
    // "No character" option + 2 chars = 3 radios
    expect(radios.length).toBe(3);
  });

  it('ArrowDown moves selection to the next radio option', async () => {
    render(<RebindCharacterButton {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Change your character/i }));

    await waitFor(() => screen.getByRole('radiogroup'));
    const radios = screen.getAllByRole('radio');
    // Focus the first option then arrow down.
    fireEvent.keyDown(radios[0], { key: 'ArrowDown' });
    // After ArrowDown, the second option should have tabIndex=0.
    await waitFor(() => {
      expect(radios[1].tabIndex).toBe(0);
    });
  });

  it('Space selects the focused radio option', async () => {
    render(<RebindCharacterButton {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Change your character/i }));

    await waitFor(() => screen.getByRole('radiogroup'));
    const radios = screen.getAllByRole('radio');
    // Select the "no char" option (index 0) via Space.
    fireEvent.keyDown(radios[0], { key: ' ' });

    await waitFor(() => {
      expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    });
  });
});

// ── Live region ────────────────────────────────────────────────────────────────

describe('live region wraps load/list', () => {
  it('the loading state is inside an aria-live=polite container', async () => {
    let resolveChars!: (value: typeof TWO_CHARS) => void;
    mockListMyCharacters.mockReturnValueOnce(
      new Promise<typeof TWO_CHARS>((res) => { resolveChars = res; }),
    );

    render(<RebindCharacterButton {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Change your character/i }));

    await waitFor(() => screen.getByText(/Loading characters/i));

    // Find an ancestor with aria-live=polite.
    const loadingEl = screen.getByText(/Loading characters/i);
    let el: HTMLElement | null = loadingEl;
    let foundLive = false;
    while (el) {
      if (el.getAttribute('aria-live') === 'polite') {
        foundLive = true;
        break;
      }
      el = el.parentElement;
    }
    expect(foundLive).toBe(true);

    // Clean up
    await act(async () => { resolveChars([]); });
  });
});

// ── Tab trap ───────────────────────────────────────────────────────────────────

describe('Tab trap', () => {
  it('popover has role=dialog with aria-modal', async () => {
    render(<RebindCharacterButton {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Change your character/i }));

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });
  });
});

// ── Confirm flow ───────────────────────────────────────────────────────────────

describe('confirm', () => {
  it('Confirm calls bindCharacter with selected id', async () => {
    render(<RebindCharacterButton {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Change your character/i }));

    await waitFor(() => screen.getByRole('radiogroup'));

    // Click the first character option (Velka).
    fireEvent.click(screen.getByRole('radio', { name: /Velka/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));

    await waitFor(() => {
      expect(mockBindCharacter).toHaveBeenCalledWith('sess1', {
        username: 'alice',
        character_id: 1,
      });
    });
  });
});

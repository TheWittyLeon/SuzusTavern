/**
 * A9d-2 fix round N7 (Sora lever brief 2.3; Tora 4a-4b, 5; Iro 4, 5, 6) — the phone's Roll control and the tray's popover layout.
 * The browser harness (roll-popover, -closes, -modifier legs and z:modeRow) is the real pin for geometry; jsdom has none.
 */
import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import RollControl from '@/components/RollControl';
import DiceTray, { type Advantage, type QuickCheck } from '@/components/DiceTray';

const CHECKS: QuickCheck[] = [{ name: 'Perception', skill: 'perception', mod: 6 }, { name: 'Stealth', skill: 'stealth', mod: 5 }];
const rolled = jest.fn();

function Harness({ initial = 'none' as Advantage, disabled = false, withHead = false }) {
  const [advantage, setAdvantage] = useState<Advantage>(initial);
  return (
    <div>
      {withHead && <div tabIndex={-1} data-testid="head">head</div>}
      <RollControl onRoll={rolled} quickChecks={CHECKS} advantage={advantage} onAdvantage={setAdvantage} disabled={disabled} fallbackFocus={() => document.querySelector<HTMLElement>('[data-testid="head"]')} />
    </div>
  );
}

const rollBtn = () => document.querySelector('[data-roll-control]') as HTMLButtonElement;
const dialog = () => screen.getByRole('dialog', { name: 'Roll dice' });
beforeEach(() => rolled.mockClear());

describe('the Roll button', () => {
  it('is a labelled control with the die icon and the text "Roll", marked for the harness', () => {
    render(<Harness />);
    expect(rollBtn()).toHaveTextContent('Roll');
    expect(rollBtn()).toHaveAccessibleName('Roll');
    expect(rollBtn().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(rollBtn()).toHaveAttribute('data-roll-control');
    expect(rollBtn()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(rollBtn()).toHaveAttribute('aria-expanded', 'false');
  });

  it.each([['adv', 'Roll · Adv', 'Roll · Advantage'], ['dis', 'Roll · Dis', 'Roll · Disadvantage']] as const)(
    'with %s on it says so in TEXT, and its accessible name begins with the visible text and says the modifier in full (WCAG 2.5.3)',
    (advantage, visible, name) => {
      render(<Harness initial={advantage} />);
      expect(rollBtn()).toHaveTextContent(visible);
      expect(rollBtn()).toHaveAccessibleName(name);
      expect(name.startsWith(visible)).toBe(true);
    },
  );
});

describe('the popover', () => {
  it('opens a named dialog (portalled, never aria-modal) whose tray is ordered quick checks, roll modifier, dice; focus goes to the FIRST DIE', () => {
    render(<Harness />);
    fireEvent.click(rollBtn());
    const d = dialog();
    expect(d).not.toHaveAttribute('aria-modal');
    expect(d.parentElement).toBe(document.body);
    expect(rollBtn()).toHaveAttribute('aria-expanded', 'true');
    expect(rollBtn()).toHaveAttribute('aria-controls', d.id);
    const toolbars = Array.from(d.querySelectorAll('[role="toolbar"]')).map((t) => t.getAttribute('aria-label'));
    expect(toolbars).toEqual(['Quick checks', 'Roll modifier', 'Dice']);
    expect(within(d).getByRole('button', { name: 'Roll d4' })).toHaveFocus();
    expect(within(d).queryByText('Roll', { selector: 'div' })).toBeNull(); // the tray's "Roll" label is the stage form's; the dialog is named instead
  });

  it('a die rolled closes it ON THAT CLICK, calls onRoll once with the die, and returns focus to Roll', () => {
    render(<Harness />);
    fireEvent.click(rollBtn());
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Roll d20' }));
    expect(rolled).toHaveBeenCalledTimes(1);
    expect(rolled).toHaveBeenCalledWith({ kind: 'die', sides: 20 });
    expect(screen.queryByRole('dialog', { name: 'Roll dice' })).toBeNull();
    expect(rollBtn()).toHaveFocus();
  });

  it('a quick check rolled does the same', () => {
    render(<Harness />);
    fireEvent.click(rollBtn());
    fireEvent.click(within(dialog()).getByRole('button', { name: /Roll Perception check/ }));
    expect(rolled).toHaveBeenCalledWith({ kind: 'check', skill: 'perception', label: 'Perception' });
    expect(screen.queryByRole('dialog', { name: 'Roll dice' })).toBeNull();
    expect(rollBtn()).toHaveFocus();
  });

  it('a modifier change does NOT close it, and the button says so in text once it does', () => {
    render(<Harness />);
    fireEvent.click(rollBtn());
    fireEvent.click(within(dialog()).getByRole('button', { name: 'disadvantage' }));
    expect(dialog()).toBeInTheDocument();
    expect(rolled).not.toHaveBeenCalled();
    expect(rollBtn()).toHaveTextContent('Roll · Dis');
    expect(rollBtn()).toHaveAccessibleName('Roll · Disadvantage');
  });

  it('while a roll is busy the dice stay aria-disabled and a click on one rolls nothing and closes nothing', () => {
    render(<Harness disabled />);
    fireEvent.click(rollBtn());
    const die = within(dialog()).getByRole('button', { name: 'Roll d20' });
    expect(die).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(die);
    expect(rolled).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
  });

  it('Escape closes it and returns focus to Roll', () => {
    render(<Harness />);
    fireEvent.click(rollBtn());
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Roll dice' })).toBeNull();
    expect(rollBtn()).toHaveFocus();
  });

  it('closed, the tray is not mounted at all (no keepMounted: its dice are not in the page until Roll is pressed)', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Roll d20' })).toBeNull();
  });
});

describe('one node, two homes: the tray remounts when the row changes; the modifier survives (it lives in the page)', () => {
  function Switch({ phone }: { phone: boolean }) {
    const [advantage, setAdvantage] = useState<Advantage>('none');
    return phone ? (
      <RollControl onRoll={rolled} quickChecks={CHECKS} advantage={advantage} onAdvantage={setAdvantage} />
    ) : (
      <div data-tenant="diceTray"><DiceTray onRoll={rolled} quickChecks={CHECKS} advantage={advantage} onAdvantage={setAdvantage} /></div>
    );
  }
  it('adv chosen in the desktop tray reads "Roll · Adv" on the phone, and back', () => {
    // Switch owns the state in ONE component whose branch changes, as page.tsx's `advantage` does across the two homes
    const { rerender } = render(<Switch phone={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'advantage' }));
    expect(screen.getByRole('button', { name: 'advantage' })).toHaveAttribute('aria-pressed', 'true');
    rerender(<Switch phone />);
    expect(rollBtn()).toHaveTextContent('Roll · Adv');
    rerender(<Switch phone={false} />);
    expect(screen.getByRole('button', { name: 'advantage' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Roll goes away under an OPEN popover (the row switched): focus falls to the fallback (the scene head), never <body>', () => {
    function Gone() {
      const [phone, setPhone] = useState(true);
      const [advantage, setAdvantage] = useState<Advantage>('none');
      return (
        <div>
          <div tabIndex={-1} data-testid="head">head</div>
          <button type="button" onClick={() => setPhone(false)}>switch</button>
          {phone && <RollControl onRoll={rolled} quickChecks={CHECKS} advantage={advantage} onAdvantage={setAdvantage} fallbackFocus={() => document.querySelector<HTMLElement>('[data-testid="head"]')} />}
        </div>
      );
    }
    render(<Gone />);
    fireEvent.click(rollBtn());
    expect(dialog()).toBeInTheDocument();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'switch' })); });
    expect(screen.queryByRole('dialog', { name: 'Roll dice' })).toBeNull();
    expect(document.body).not.toHaveFocus();
  });
});

describe('DiceTray layout', () => {
  it('`tray` (the default, the stage tenant) is Roll label, dice, quick checks, modifier: today\'s order, no popover class', () => {
    const { container } = render(<DiceTray onRoll={() => {}} quickChecks={CHECKS} />);
    const order = Array.from(container.querySelectorAll('[role="toolbar"]')).map((t) => t.getAttribute('aria-label'));
    expect(order).toEqual(['Dice', 'Quick checks', 'Roll modifier']);
    expect(container.firstElementChild?.className).not.toMatch(/trayPopover/);
    expect(container.querySelector('[style*="--dice-columns"]')).not.toBeNull();
  });

  it('`popover` orders quick checks, roll modifier, dice (the dice nearest the thumb) and sets no inline column count', () => {
    const { container } = render(<DiceTray layout="popover" onRoll={() => {}} quickChecks={CHECKS} />);
    const order = Array.from(container.querySelectorAll('[role="toolbar"]')).map((t) => t.getAttribute('aria-label'));
    expect(order).toEqual(['Quick checks', 'Roll modifier', 'Dice']);
    expect(container.firstElementChild?.className).toMatch(/trayPopover/);
    expect(container.querySelector('[style*="--dice-columns"]')).toBeNull();
    expect(container.querySelector('[role="toolbar"][aria-label="Dice"]')?.className).toMatch(/diceGridPopover/);
  });

  it('with no quick checks the popover is the modifier, then the dice', () => {
    const { container } = render(<DiceTray layout="popover" onRoll={() => {}} />);
    expect(Array.from(container.querySelectorAll('[role="toolbar"]')).map((t) => t.getAttribute('aria-label'))).toEqual(['Roll modifier', 'Dice']);
  });
});

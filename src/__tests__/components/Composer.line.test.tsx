/**
 * A10 step 11 tail, S6 (Sora's amendment 1.1; Aoi's drawing; Iro 6; Tora C-6 / S-3; the coordinator's focus ruling): the phone's `line` composer. jsdom has no layout: the geometry is the
 * harness's z:modeRow `line` arm and its text200 leg; this pins the DOM, the menu, the focus rules and the helper.
 * Mutations seen red (S6 run): the menu filtering a mode; the menu cycling instead of opening; focus moved into the field after a choice; pointerdown not prevented on Roll, Mode or Send;
 * the mode record's short placeholder over 14 characters; the tab list back on `line`; Roll's tag outside its box.
 */
import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import Composer, { type ComposeMode } from '@/components/Composer';
import RollControl from '@/components/RollControl';
import { DEFAULT_MODES, MODE_RECORD } from '@/components/composeModes';
import type { Advantage } from '@/components/DiceTray';

const PLAYER = DEFAULT_MODES;
const HUMAN_DM: [ComposeMode, string][] = [['dm_narration', 'DM Narration'], ['ooc', 'OOC']];

function Harness({ modes = PLAYER, initial = 'say' as ComposeMode, advantage = 'none' as Advantage, onChange = jest.fn(), onModeSpy = jest.fn(), value = 'a draft I typed' }) {
  const [mode, setMode] = useState<ComposeMode>(initial);
  return (
    <Composer
      value={value}
      onChange={onChange}
      mode={mode}
      onMode={(m) => { onModeSpy(m); setMode(m); }}
      onSend={jest.fn()}
      availableModes={modes}
      variant="line"
      tools={<RollControl onRoll={jest.fn()} quickChecks={[]} advantage={advantage} onAdvantage={jest.fn()} keepFieldFocus />}
    />
  );
}

const field = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const roll = () => document.querySelector('[data-roll-control]') as HTMLButtonElement;
const modeBtn = () => document.querySelector('[data-mode-menu]') as HTMLButtonElement;
const send = () => screen.getByRole('button', { name: 'Send' });
const menu = () => screen.getByRole('menu', { name: 'Compose mode' });
const items = () => within(menu()).getAllByRole('menuitemradio');
// A press: pointerdown, then the click a pointer makes (detail 1). A keyboard activation is a click with detail 0.
const press = (el: Element) => { fireEvent.pointerDown(el); fireEvent.click(el, { detail: 1 }); };
const keyClick = (el: Element) => fireEvent.click(el, { detail: 0 });

describe('the `line` composer: four controls, in order, no tab list', () => {
  it('Roll, the Mode menu button, the field and Send, in DOM order; no tablist', () => {
    render(<Harness />);
    const order = Array.from(document.querySelectorAll('[data-region="composer"] button, [data-region="composer"] textarea'))
      .map((e) => (e === roll() ? 'roll' : e === modeBtn() ? 'mode' : e === field() ? 'field' : e === send() ? 'send' : 'other'));
    expect(order).toEqual(['roll', 'mode', 'field', 'send']);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('the Mode button is a menu button named "<mode>, compose mode" (the visible word first), collapsed at rest', () => {
    render(<Harness />);
    expect(modeBtn()).toHaveAccessibleName('Say, compose mode');
    expect(modeBtn()).toHaveAttribute('aria-haspopup', 'menu');
    expect(modeBtn()).toHaveAttribute('aria-expanded', 'false');
    expect(modeBtn()).toHaveTextContent('Say');
  });

  it('the field keeps its name "Compose (<mode>)", asks for a Send key (enterkeyhint) and takes the mode\'s short placeholder; the long text is its description', () => {
    render(<Harness value="" />);
    expect(field()).toHaveAccessibleName('Compose (say)');
    expect(field()).toHaveAttribute('enterkeyhint', 'send');
    expect(field()).toHaveAttribute('placeholder', MODE_RECORD.say.placeholderShort);
    expect(field()).toHaveAccessibleDescription(MODE_RECORD.say.placeholderLong);
  });

  it('every mode\'s short placeholder is 14 characters or fewer (it must fit the 122px of text the field has at 360 wide), and each mode says label and hint', () => {
    for (const [k, r] of Object.entries(MODE_RECORD)) {
      expect([k, r.placeholderShort.length <= 14]).toEqual([k, true]);
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.hint.length).toBeGreaterThan(0);
      expect(r.placeholderLong.length).toBeGreaterThan(r.placeholderShort.length);
    }
  });
});

describe('the menu', () => {
  it('lists EXACTLY the page\'s availableModes (three for a player), the current one checked', () => {
    render(<Harness />);
    press(modeBtn());
    expect(items().map((i) => i.textContent)).toEqual(['Say' + MODE_RECORD.say.hint, 'Act' + MODE_RECORD.act.hint, 'OOC' + MODE_RECORD.ooc.hint]);
    expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(modeBtn()).toHaveAttribute('aria-expanded', 'true');
  });

  it('lists exactly TWO for a human DM, in the page\'s order, and adds none', () => {
    render(<Harness modes={HUMAN_DM} initial="dm_narration" />);
    press(modeBtn());
    expect(items().map((i) => i.querySelector('b')?.textContent)).toEqual(['Narrate', 'OOC']);
    expect(items()[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('is a menu of radio items, not a control that cycles: one press opens it and changes nothing', () => {
    const spy = jest.fn();
    render(<Harness onModeSpy={spy} />);
    press(modeBtn());
    press(modeBtn()); // a second press closes it
    expect(spy).not.toHaveBeenCalled();
    expect(modeBtn()).toHaveAttribute('aria-expanded', 'false');
  });

  it('choosing a mode sets it, closes the menu, and the button and the field say the new mode; the draft is untouched', () => {
    const onChange = jest.fn();
    const spy = jest.fn();
    render(<Harness onChange={onChange} onModeSpy={spy} />);
    press(modeBtn());
    press(items()[1]);
    expect(spy).toHaveBeenCalledWith('act');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(modeBtn()).toHaveAccessibleName('Act, compose mode');
    expect(field()).toHaveAccessibleName('Compose (act)');
    expect(field().value).toBe('a draft I typed');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('arrows, Home and End move between items; Escape closes it and returns focus to the button (opened from the keyboard)', () => {
    render(<Harness />);
    keyClick(modeBtn());
    expect(document.activeElement).toBe(items()[0]); // the current one is focused
    fireEvent.keyDown(items()[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.keyDown(items()[1], { key: 'End' });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(items()[2], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(items()[0], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(items()[2], { key: 'Home' });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(items()[0], { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(modeBtn());
  });
});

describe('focus after a choice (the coordinator\'s binding ruling): back to WHERE IT WAS; never INTO the field because a mode was chosen', () => {
  it('typing with the keyboard up, the menu opened by touch: focus never leaves the field, the choice keeps it there', () => {
    render(<Harness />);
    act(() => field().focus());
    press(modeBtn());
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(document.activeElement).toBe(field()); // the menu did not take the focus: the keyboard stays up
    press(items()[2]);
    expect(modeBtn()).toHaveAccessibleName('OOC, compose mode');
    expect(document.activeElement).toBe(field());
  });

  it('opened from the keyboard: focus goes into the menu and comes back to the BUTTON, whose name carries the new mode', () => {
    render(<Harness />);
    act(() => modeBtn().focus());
    keyClick(modeBtn());
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.click(items()[1], { detail: 0 });
    expect(document.activeElement).toBe(modeBtn());
    expect(modeBtn()).toHaveAccessibleName('Act, compose mode');
    expect(document.activeElement).not.toBe(field());
  });

  it('a tap with the field NOT focused: the menu takes focus and the choice returns it to the button, never to the field', () => {
    render(<Harness />);
    expect(document.activeElement).not.toBe(field());
    press(modeBtn());
    expect(menu()).toBeInTheDocument();
    expect(items().some((i) => i === document.activeElement)).toBe(true);
    press(items()[1]);
    expect(document.activeElement).toBe(modeBtn());
    expect(document.activeElement).not.toBe(field());
  });
});

describe('the keep-keyboard helper: pointerdown on Roll, Mode, Send and every menu item is default-prevented', () => {
  it('Roll, Mode and Send', () => {
    render(<Harness />);
    for (const el of [roll(), modeBtn(), send()]) expect([el.getAttribute('aria-label'), fireEvent.pointerDown(el)]).toEqual([el.getAttribute('aria-label'), false]);
    for (const el of [roll(), modeBtn(), send()]) expect(fireEvent.mouseDown(el)).toBe(false);
  });

  it('the menu items', () => {
    render(<Harness />);
    press(modeBtn());
    for (const i of items()) expect(fireEvent.pointerDown(i)).toBe(false);
  });

  it('the field itself is NOT prevented (a press on it focuses it)', () => {
    render(<Harness />);
    expect(fireEvent.pointerDown(field())).toBe(true);
  });
});

describe('Roll in the `line` composer', () => {
  it('still opens the dice from Roll (a dialog named "Roll dice")', () => {
    render(<Harness />);
    press(roll());
    expect(screen.getByRole('dialog', { name: 'Roll dice' })).toBeInTheDocument();
  });

  it('is the same box with and without a modifier: the tag is a node INSIDE the button\'s one label, the name is "Roll · Advantage" and begins with the visible word', () => {
    const none = render(<Harness />);
    const noneNodes = roll().querySelectorAll('span').length;
    expect(roll()).toHaveAccessibleName('Roll');
    none.unmount();
    render(<Harness advantage="adv" />);
    expect(roll()).toHaveAccessibleName('Roll · Advantage');
    expect(roll()).toHaveTextContent('Roll · Adv');
    const tag = Array.from(roll().querySelectorAll('span')).find((e) => e.textContent === 'Adv') as HTMLElement;
    expect(tag).toBeDefined();
    expect(roll().contains(tag)).toBe(true);
    expect(roll().querySelectorAll('span').length).toBeGreaterThan(noneNodes); // it ADDS nodes inside the one button; the stylesheet fixes the box (RollControl.module.css, pinned in composer-roll-row.css.test)
    expect(roll()).toHaveAttribute('data-advantage', 'adv');
  });
});

describe('the `line` field grows with its text to three lines (92px) and an EMPTY field is the 44px row', () => {
  it('empty: no inline height (a wrapping placeholder, the lock reason, must not size it); typed: the scroll height plus the border, capped at 92px', () => {
    const scroll = jest.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get');
    scroll.mockReturnValue(67);
    const { rerender } = render(<Composer value="" onChange={jest.fn()} mode="say" onMode={jest.fn()} onSend={jest.fn()} variant="line" />);
    expect(field().style.height).toBe('');
    rerender(<Composer value="a line that wraps to three lines" onChange={jest.fn()} mode="say" onMode={jest.fn()} onSend={jest.fn()} variant="line" />);
    expect(field().style.height).toBe('69px');
    scroll.mockReturnValue(300);
    rerender(<Composer value="a very long draft indeed" onChange={jest.fn()} mode="say" onMode={jest.fn()} onSend={jest.fn()} variant="line" />);
    expect(field().style.height).toBe('92px');
    rerender(<Composer value="" onChange={jest.fn()} mode="say" onMode={jest.fn()} onSend={jest.fn()} variant="line" />);
    expect(field().style.height).toBe('');
    scroll.mockRestore();
  });
  it('the other variants never set an inline height', () => {
    const scroll = jest.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockReturnValue(80);
    render(<Composer value="some text" onChange={jest.fn()} mode="say" onMode={jest.fn()} onSend={jest.fn()} variant="roll" />);
    expect(field().style.height).toBe('');
    scroll.mockRestore();
  });
});

describe('the other variants are untouched', () => {
  it('`roll` and `full` still render the tab list and no menu button', () => {
    for (const variant of ['roll', 'full'] as const) {
      const { unmount } = render(<Composer value="" onChange={jest.fn()} mode="say" onMode={jest.fn()} onSend={jest.fn()} variant={variant} />);
      expect(screen.getByRole('tablist', { name: 'Compose mode' })).toBeInTheDocument();
      expect(document.querySelector('[data-mode-menu]')).toBeNull();
      expect(screen.getByRole('textbox')).not.toHaveAttribute('enterkeyhint');
      unmount();
    }
  });
});

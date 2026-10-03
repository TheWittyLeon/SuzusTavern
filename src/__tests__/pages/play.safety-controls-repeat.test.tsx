/**
 * Round 9 (Miko-QA F2, a safety control): the X-card must be immune to a key-repeat activation. A native button clicks on the Enter KEYDOWN, so a held Enter (auto-repeat)
 * sent one /x-card POST per repeat (reproduced via a keyboard Dismiss that handed focus to the X-card; the harness leg toast-dismiss-xcard-repeat is the browser proof, red at
 * edb0b66 with 2-3 POSTs). jsdom does not synthesize the click from a keydown, so the pin is the default being prevented. Take the onKeyDown off -> reds.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SafetyControls from '@/app/play/[sessionId]/tenants/SafetyControls';

const setup = () => {
  const onRaiseXCard = jest.fn();
  render(<SafetyControls xCardBusy={false} onRaiseXCard={onRaiseXCard} />);
  return { onRaiseXCard, button: screen.getByRole('button', { name: 'X-card' }) };
};
const key = (button: HTMLElement, init: KeyboardEventInit) => !fireEvent.keyDown(button, { bubbles: true, cancelable: true, ...init }); // true = default prevented

describe('SafetyControls: the X-card takes one press, never a held key', () => {
  it('an Enter keydown that is a REPEAT is prevented (no click is synthesized from it)', () => {
    const { button } = setup();
    expect(key(button, { key: 'Enter', repeat: true })).toBe(true);
    expect(key(button, { key: ' ', repeat: true })).toBe(true);
  });
  it('the FIRST Enter is not prevented (the native click still happens), and neither are other keys, even repeating', () => {
    const { button } = setup();
    expect(key(button, { key: 'Enter', repeat: false })).toBe(false);
    expect(key(button, { key: 'Tab', repeat: true })).toBe(false);
    expect(key(button, { key: 'ArrowRight', repeat: true })).toBe(false);
  });
  it('a click raises it once', () => {
    const { button, onRaiseXCard } = setup();
    fireEvent.click(button);
    expect(onRaiseXCard).toHaveBeenCalledTimes(1);
  });
});

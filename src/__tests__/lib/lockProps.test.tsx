/**
 * lib/a11y/lockProps — a transient lock that keeps keyboard focus (Iro A9c-2
 * IMPORTANT-1, Kage IMPORTANT-2). jsdom cannot see the focus loss itself (it applies
 * no "focus fixup" on `disabled`), so the harness's `t3-focus-kept` and `send-keeps-focus`
 * are the browser pin; THIS pins the mechanism: a locked control is never natively
 * disabled, announces `aria-disabled`, and its activation is swallowed.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { guardLocked, lockProps } from '@/lib/a11y/lockProps';
import Composer from '@/components/Composer';
import { expectLocked, expectUnlocked } from '@/test-utils/locked';

describe('lockProps', () => {
  it('unlocked adds nothing; locked adds aria-disabled + aria-busy (and readOnly for a text input)', () => {
    expect(lockProps(false)).toEqual({ 'aria-disabled': undefined, 'aria-busy': undefined });
    expect(lockProps(true)).toEqual({ 'aria-disabled': true, 'aria-busy': true });
    expect(lockProps(true, { textInput: true })).toEqual({ 'aria-disabled': true, 'aria-busy': true, readOnly: true });
    expect(lockProps(false, { textInput: true }).readOnly).toBeUndefined();
  });

  it('busy follows `locked` unless a lock that is not "working" says otherwise', () => {
    expect(lockProps(true, { busy: false })['aria-busy']).toBeUndefined();
    expect(lockProps(true, { busy: true })['aria-busy']).toBe(true);
    expect(lockProps(false, { busy: true })['aria-busy']).toBe(true);
  });

  it('never emits a native `disabled`', () => {
    expect(lockProps(true, { textInput: true })).not.toHaveProperty('disabled');
  });
});

describe('guardLocked', () => {
  it('swallows (and preventDefaults) while locked, forwards while unlocked', () => {
    const handler = jest.fn();
    const e = { preventDefault: jest.fn() } as unknown as React.SyntheticEvent;
    guardLocked(true, handler)(e);
    expect(handler).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    guardLocked(false, handler)(e);
    expect(handler).toHaveBeenCalledWith(e);
  });
});

describe('Composer holds its lock without native `disabled` (focus survives a send)', () => {
  const base = { value: 'hi', onChange: jest.fn(), mode: 'say' as const, onMode: jest.fn(), onSend: jest.fn() };

  it('focus on the textarea survives the lock engaging (pending) and releasing', () => {
    const { rerender } = render(<Composer {...base} />);
    const ta = screen.getByLabelText('Compose (say)');
    ta.focus();
    expect(ta).toHaveFocus();
    rerender(<Composer {...base} pending />);
    expectLocked(ta);
    expect(ta).toHaveAttribute('readonly');
    expect(ta).toHaveFocus();
    rerender(<Composer {...base} />);
    expectUnlocked(ta);
    expect(ta).not.toHaveAttribute('readonly');
    expect(ta).toHaveFocus();
  });

  it('a `disabled` lock (Suzu narrating / paused) is the same: locked, read-only, still focused', () => {
    const { rerender } = render(<Composer {...base} />);
    const ta = screen.getByLabelText('Compose (say)');
    ta.focus();
    rerender(<Composer {...base} disabled disabledReason="Suzu is narrating — one moment…" />);
    expectLocked(ta);
    expect(ta).toHaveAttribute('readonly');
    expect(ta).toHaveFocus();
  });

  it('Send is aria-disabled (focusable) when empty or locked, and its click does nothing', () => {
    const onSend = jest.fn();
    const { rerender } = render(<Composer {...base} value="" onSend={onSend} />);
    const send = screen.getByRole('button', { name: 'Send' });
    send.focus();
    expectLocked(send);
    expect(send).toHaveFocus();
    fireEvent.click(send);
    rerender(<Composer {...base} value="hi" pending onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sending…' }));
    expect(onSend).not.toHaveBeenCalled();
    // Positive control: the same click DOES send once nothing locks it.
    rerender(<Composer {...base} value="hi" onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('Enter in a locked textarea sends nothing', () => {
    const onSend = jest.fn();
    render(<Composer {...base} pending onSend={onSend} />);
    fireEvent.keyDown(screen.getByLabelText('Compose (say)'), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });
});

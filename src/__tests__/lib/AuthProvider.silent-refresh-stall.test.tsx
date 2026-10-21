/**
 * @jest-environment <rootDir>/src/test-utils/jsdom-with-fetch-env.js
 *
 * Kage I1 — after the root layout's 2.5 s /auth/me deadline hands the page to silentRefresh, a stalled
 * auth server must end in the "offline" prompt, not a skeleton forever. Real auth client; only fetch
 * (which honours its AbortSignal, like a browser's) is faked.
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/dashboard',
}));

import { AuthProvider, useAuth } from '../../lib/auth/AuthProvider';

function Probe() {
  const a = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(a.loading)}</span>
      <span data-testid="authError">{String(a.authError)}</span>
    </div>
  );
}

it('a stalled refresh is abandoned at the retry bound and classified offline', async () => {
  const ctl = new AbortController();
  const timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(ctl.signal);
  const seen: string[] = [];
  global.fetch = jest.fn((url: string, init?: RequestInit) => {
    seen.push(url);
    return new Promise<Response>((_res, rej) => {
      const sig = init?.signal;
      if (!sig) return; // no deadline -> hangs forever (the bug)
      sig.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    });
  }) as unknown as typeof fetch;

  render(<AuthProvider initialUser={null} initialMaybeAuthed><Probe /></AuthProvider>);
  await waitFor(() => expect(seen).toEqual(['/api/auth/refresh']));
  expect(screen.getByTestId('loading')).toHaveTextContent('true');
  expect(timeoutSpy).toHaveBeenCalledWith(12_000);

  await act(async () => { ctl.abort(new DOMException('timed out', 'TimeoutError')); });

  await waitFor(() => expect(screen.getByTestId('authError')).toHaveTextContent('offline'));
  expect(screen.getByTestId('loading')).toHaveTextContent('false');
  timeoutSpy.mockRestore();
});

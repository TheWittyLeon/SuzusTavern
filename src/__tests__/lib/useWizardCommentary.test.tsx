import { renderHook, waitFor, act } from '@testing-library/react';

jest.mock('../../lib/stream', () => ({
  streamNarration: jest.fn(),
}));

import { streamNarration } from '../../lib/stream';
import { useWizardCommentary } from '../../lib/dnd/useWizardCommentary';

const mStream = streamNarration as jest.MockedFunction<typeof streamNarration>;

beforeEach(() => mStream.mockReset());

describe('useWizardCommentary', () => {
  it('is DISABLED and makes NO narration request when ai is off', async () => {
    const { result } = renderHook(() =>
      useWizardCommentary({ aiAssistLevel: 'off', username: 'leon', commentaryKey: '0', prompt: 'p' }),
    );
    expect(result.current.enabled).toBe(false);
    await act(async () => {});
    expect(mStream).not.toHaveBeenCalled();
  });

  it('is DISABLED and makes NO request when aiAssistLevel is undefined', async () => {
    const { result } = renderHook(() =>
      useWizardCommentary({ username: 'leon', commentaryKey: '0', prompt: 'p' }),
    );
    expect(result.current.enabled).toBe(false);
    await act(async () => {});
    expect(mStream).not.toHaveBeenCalled();
  });

  it('streams the commentary incrementally when assist is on', async () => {
    mStream.mockImplementation(async function* () {
      yield { kind: 'chunk' as const, text: 'A rogue' };
      yield { kind: 'chunk' as const, text: 'A rogue, naturally.' };
    });
    const { result } = renderHook(() =>
      useWizardCommentary({ aiAssistLevel: 'full', username: 'leon', commentaryKey: '1', prompt: 'react' }),
    );
    expect(result.current.enabled).toBe(true);
    await waitFor(() => expect(result.current.text).toBe('A rogue, naturally.'));
    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(mStream).toHaveBeenCalledTimes(1);
  });

  // NEKONOVA-WIZARD-COMMENTARY-CONTEXT-BLEED (2026-09-09): this hook is a
  // one-shot flavor-text caller, so it must opt out of the narrator's
  // username-keyed context entirely. The engine default is stateful, so the
  // flag has to be sent explicitly on every request from here.
  it('sends stateless:true so the one-shot commentary reads/writes no user context', async () => {
    mStream.mockImplementation(async function* () {
      yield { kind: 'chunk' as const, text: 'A rogue, naturally.' };
    });
    renderHook(() =>
      useWizardCommentary({ aiAssistLevel: 'full', username: 'leon', commentaryKey: '9', prompt: 'p' }),
    );
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(1));
    expect(mStream.mock.calls[0][0]).toEqual(
      expect.objectContaining({ username: 'leon', channel: 'character-creation', stateless: true }),
    );
  });

  it('handles the [DONE] sentinel — keeps the text, stops streaming', async () => {
    mStream.mockImplementation(async function* () {
      yield { kind: 'chunk' as const, text: 'A halfling. Bold.' };
      yield { kind: 'done' as const };
    });
    const { result } = renderHook(() =>
      useWizardCommentary({ aiAssistLevel: 'full', username: 'leon', commentaryKey: '3', prompt: 'p' }),
    );
    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.text).toBe('A halfling. Bold.');
  });

  it('aborts the prior stream when commentaryKey changes (no orphan)', async () => {
    mStream.mockImplementation(async function* () {
      yield { kind: 'chunk' as const, text: 'first' };
    });
    const { rerender } = renderHook(
      ({ k }: { k: string }) =>
        useWizardCommentary({ aiAssistLevel: 'full', username: 'leon', commentaryKey: k, prompt: 'p' }),
      { initialProps: { k: '0' } },
    );
    rerender({ k: '1' });
    await waitFor(() => expect(mStream).toHaveBeenCalledTimes(2));
    // the first run's signal was aborted by the cleanup before the second run
    expect(mStream.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('does not crash and stops streaming when the stream errors', async () => {
    mStream.mockImplementation(async function* () {
      yield { kind: 'error' as const, error: 'network' };
    });
    const { result } = renderHook(() =>
      useWizardCommentary({ aiAssistLevel: 'assist', username: 'leon', commentaryKey: '2', prompt: 'react' }),
    );
    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.text).toBe(''); // caller falls back to its deterministic line
  });
});

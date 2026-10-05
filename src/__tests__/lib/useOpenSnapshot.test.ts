import { renderHook } from '@testing-library/react';
import { useOpenSnapshot } from '@/lib/useOpenSnapshot';

describe('useOpenSnapshot: a dialog\'s words are read once, when it opens', () => {
  it('open: the value at the moment of opening, whatever it becomes; closed: the live value; reopened: the new present', () => {
    const { result, rerender } = renderHook(({ open, v }: { open: boolean; v: string }) => useOpenSnapshot(open, v), { initialProps: { open: false, v: 'a' } });
    expect(result.current).toBe('a');
    rerender({ open: true, v: 'a' });
    expect(result.current).toBe('a');
    rerender({ open: true, v: 'b' });
    expect(result.current).toBe('a');
    rerender({ open: false, v: 'b' });
    expect(result.current).toBe('b');
    rerender({ open: true, v: 'c' });
    expect(result.current).toBe('c');
    rerender({ open: true, v: 'd' });
    expect(result.current).toBe('c');
  });
});

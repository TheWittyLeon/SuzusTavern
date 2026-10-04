/**
 * B8c-4 P0 fix round 2 (Kage I-3; his probe, kept under a behaviour name): a handle press clears the reveal on EVERY fold, not only the map's: the character sheet's old two-state fold goes through the
 * same press path now. Red before: with the sheet stored folded and then revealed, press 1 wrote "none" and press 2 wrote "folded" while the panel stayed open both times.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PlayShell from '@/app/play/[sessionId]/PlayShell';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { FOLDS_KEY, FOLDS_OPEN_KEY } from '@/lib/theme/theme';
import { useRegionFolds } from '@/app/play/[sessionId]/hooks/useRegionFolds';
import { LAYOUT_ROWS_BY_ID } from '@/app/play/[sessionId]/presets';
import { FOLD_SPECS } from '@/app/play/[sessionId]/foldSpecs';

const holder: { current: ReturnType<typeof useRegionFolds> | null } = { current: null };
function Page() {
  const f = useRegionFolds('combat');
  holder.current = f; // eslint-disable-line react-hooks/immutability
  return <PlayShell row={LAYOUT_ROWS_BY_ID.table} moment="combat" facts={{ room: 'board' }} regions={{ characterBlock: <div><h2 id="member-sheet-heading">Sheet</h2><p>body</p></div> }} tenants={{}} foldSpecs={FOLD_SPECS} {...f.shellProps} />;
}
beforeEach(() => { window.localStorage.removeItem(FOLDS_KEY); window.localStorage.removeItem(FOLDS_OPEN_KEY); });
it('legacy fold: control — a press folds it with no reveal', () => {
  render(<ThemeProvider><Page /></ThemeProvider>);
  const h = screen.getByRole('button', { name: 'Character sheet' });
  expect(h).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(h);
  expect(h).toHaveAttribute('aria-expanded', 'false');
});
it('legacy fold: stored folded -> reveal -> press 1 FOLDS it, press 2 opens it again (the reveal is gone, the stored choice rules, nothing is dead)', () => {
  window.localStorage.setItem(FOLDS_KEY, '["characterBlock"]');
  render(<ThemeProvider><Page /></ThemeProvider>);
  const h = screen.getByRole('button', { name: 'Character sheet' });
  expect(h).toHaveAttribute('aria-expanded', 'false');
  act(() => holder.current!.reveal('characterBlock'));
  expect(h).toHaveAttribute('aria-expanded', 'true'); // the reveal opened it
  fireEvent.click(h);
  expect(h).toHaveAttribute('aria-expanded', 'false'); // RED before: the reveal outranked what the press wrote
  fireEvent.click(h);
  expect(h).toHaveAttribute('aria-expanded', 'true');
  expect(window.localStorage.getItem(FOLDS_KEY) ?? '[]').not.toContain('characterBlock'); // the legacy fold stores "none" for open, as it always did
});

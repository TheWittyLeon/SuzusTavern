/**
 * B8c-4 P0 (Sora's phone-mount brief 2.3, Amendment H.1-H.3) — the fold as a FACT. Pure: no DOM, no React, no region names. The shell reports `fold:<regionId>` for every
 * region that has a live fold; a row answers it with `--play-*` values (`LayoutRow.factVars`), exactly as it answers `room`. A row that has no table for it is not affected, which is
 * why P0 moves no pixel: no row emits one until P1.
 *
 * Three values, one meaning each: `auto` (the default is still being measured: the row answers with a floor the page can be judged at), `open`, `folded`.
 */
export const FOLD_FACT_VALUES = ['auto', 'open', 'folded'] as const;
export type FoldFact = (typeof FOLD_FACT_VALUES)[number];

/** What the user stored for a fold: `folded` (tavern.folds), `open` (tavern.foldsOpen: an explicit open, which a measured default may never override) or nothing. */
export type FoldChoice = 'folded' | 'open' | 'none';

export interface FoldInputs {
  /** A safety banner is up AND this fold has a body: the banner folds it at once, on every page. */
  banner: boolean;
  /** The page asked for this fold open for THIS fight only (`reveal`); never stored. */
  revealed: boolean;
  stored: FoldChoice;
  /** `Placement.foldDefault === 'fits'`: the default is measured, not declared. */
  fits: boolean;
  /** What the measured default decided this fight, if it has. */
  decided: 'open' | 'folded' | undefined;
}

/**
 * The fold's value, in this order (brief 2.3):
 *   a banner is up and the fold has a body       -> folded   (a banner outranks everything: the X-card is never covered)
 *   revealed this fight                          -> open     (Move on a folded map opens it; it outranks a stored FOLD, which is the only case a reveal exists for)
 *   stored: folded                               -> folded
 *   stored: open                                 -> open
 *   the default is not measured                  -> open
 *   decided this fight                           -> the decision
 *   otherwise                                    -> auto
 * (The brief's table lists a reveal beside "stored: open", below "stored: folded". Read literally a reveal could then never open a map the user had folded, and Move on a folded map must
 * open it: so the reveal sits above the stored fold. A reveal never writes storage; the next fight starts as the stored choice says.)
 */
export function foldValue({ banner, revealed, stored, fits, decided }: FoldInputs): FoldFact {
  if (banner) return 'folded';
  if (revealed) return 'open';
  if (stored === 'folded') return 'folded';
  if (stored === 'open') return 'open';
  if (!fits) return 'open';
  return decided ?? 'auto';
}

/** `FoldSpec.when`: the facts under which a fold exists. Every named fact must hold. Absent = always. */
export function whenMatches(when: Readonly<Record<string, string | undefined>> | undefined, facts: Readonly<Record<string, string | undefined>> | undefined): boolean {
  if (!when) return true;
  return Object.entries(when).every(([k, v]) => facts?.[k] === v);
}

/** The scroll step's size (brief 4.3, addendum): opening scrolls the page by what the body added, but never so far that the handle leaves the viewport; folding scrolls back by what it removed. Pure. */
export function scrollStep({ dir, added, handleTop, handleBottom, viewport }: { dir: 'open' | 'fold'; added: number; handleTop: number; handleBottom: number; viewport: number }): number {
  if (!(added > 0)) return 0;
  if (dir === 'fold') return -added;
  // Scrolling down moves the handle UP the screen: it may go as far as the top edge and no further. A handle that is not wholly in view now cannot be kept in view (0: the caller refuses).
  if (handleTop < 0 || handleBottom > viewport) return 0;
  return Math.min(added, handleTop);
}

/** True when an editable control holds focus (a soft keyboard may be up): the automatic scroll never runs then (addendum). */
export function isEditable(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes((el as HTMLInputElement).type);
  return (el as HTMLElement).isContentEditable === true;
}

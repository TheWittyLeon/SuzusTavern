/**
 * A9c C4 (build brief §6, Amendment C.5) — the variant VOCABULARY, in a file
 * that holds no preset id. `presets.ts` re-exports it (no test import moves);
 * `regions/*.tsx` import it from here, because Guard 2 forbids a region
 * importing `../presets` (a region must not know which row placed it).
 *
 * The prop type of a consuming region IS the registry's:
 * `RegionVariant<'topBar'>` is `'full' | 'compact'` because the array below
 * says so, never because a component hand-wrote the same union a second time
 * (Kage S3). `topBar` joins in C4 (`full` = the two-row header, Story;
 * `compact` = the one-line header, Table over the stage and the phone).
 */

/**
 * Amendment B.3 (2026-09-30, Sora-Arch — answers Kage-CR 🟡-5/6/7): the
 * three `variant` unions, reconciled. `Placement.variant` is deliberately
 * opaque to the shell (Guard 1, plan §3.5, "an opaque string to the shell
 * and a union inside the region") — this table is the missing record of
 * which values are legal for which region, so a typo or an unsupported
 * value is caught by the guard below instead of being undetectable by
 * `tsc` and by every test.
 *  - `suzuPresence: ['compact','full']` — Kage's option (i). The B.1 rename
 *    removes the objection that excluded it at A9a ("its real prop is
 *    `size`, so validating it against a *density* union asserts the wrong
 *    thing") — presence size **is** a presentational variant: Story's
 *    "figure beside the story" and Table's "framed speaker portrait" differ
 *    in LOOK, not on the size axis. A third value with one emitter would
 *    repeat the `'vitals'` mistake below.
 *  - `characterBlock: ['compact','full']` — R20's FOLDED state is NOT a
 *    variant (A9c C7, Amendment C.4): the fold is the shell's generic
 *    mechanism (`collapsible` + a `FoldDock`, state in ThemeProvider `folds`),
 *    so a folded sheet is the same CharacterBlock behind its handle. A
 *    `'rail'` value would be a second, sheet-only mechanism with no reader.
 *  - `actionBar: ['chips','bar']` — 🟡-7 taken whole. `'vitals'` was the
 *    name of a DATA prop (`ActionBarProps.vitals`), not a variant; `'full'`
 *    had no emitter. "Vitals only while exploring" is the bar's own
 *    response to an empty `actions` array (data), which is what it already
 *    does — R16's "phone gains the action bar in combat" is therefore
 *    expressed by the bar's CONTENT, and the registry stops claiming a
 *    moment difference it cannot deliver.
 * A9b/A9c derive each region's own prop union from this
 * (`(typeof REGION_VARIANTS)['offers'][number]`) instead of hand-writing it
 * a second time.
 */
export const REGION_VARIANTS = {
  partyStrip: ['strip', 'rail'],
  sceneStage: ['inline', 'panel', 'hero'],
  // A10 fix round F3: `list` (one full-width button per offer, Table's, in a 120px scrolling track) is gone: Table's offers are `chips`, as Story's, and the track is content-sized.
  offers: ['chips', 'rows'],
  characterBlock: ['compact', 'full'],
  actionBar: ['chips', 'bar'],
  suzuPresence: ['compact', 'full'],
  topBar: ['full', 'compact'],
  // A9d-2 N7 (Amendment E.4): `full` is the composer as it always was; `roll` (the phone, and since A10 S1 every row x moment whose stage is a `hero`: Story's combat, Table) carries the Roll control at the end of its mode row
  // and the stage carries no dice tenant: the dice open from Roll in an anchored popover.
  composer: ['full', 'roll'],
} as const satisfies Record<string, readonly string[]>;

export type VariantRegionId = keyof typeof REGION_VARIANTS;
export type RegionVariant<R extends VariantRegionId> = (typeof REGION_VARIANTS)[R][number];

/** Narrows an opaque `Placement.variant` string to region `r`'s own union. */
export function isRegionVariant<R extends VariantRegionId>(
  r: R,
  v: string | undefined,
): v is RegionVariant<R> {
  return v !== undefined && (REGION_VARIANTS[r] as readonly string[]).includes(v);
}

/**
 * A9c C4 (build brief §6, Amendment C.5) — the variant VOCABULARY, in a file
 * that holds no preset id. `presets.ts` re-exports it (no test import moves);
 * `regions/*.tsx` import it from here, because Guard 2 forbids a region
 * importing `../presets` (a region must not know which row placed it).
 *
 * The prop type of a consuming region IS the registry's:
 * `RegionVariant<'topBar'>` is `'band' | 'overlay'` because the array below
 * says so, never because a component hand-wrote the same union a second time
 * (Kage S3). `topBar` joins in C4 (`band` = today's markup, Story and Phone;
 * `overlay` = the one-line header over the stage, Table).
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
 *  - `characterBlock: ['compact','full','rail']` — `'rail'` is R20's
 *    FOLDED state, reached at runtime from the persisted fold pref (A9c),
 *    and declared in `VARIANTS_NOT_EMITTED_BY_PRESETS` below as not emitted
 *    by any preset row — a declaration, not the accident that killed
 *    `actionBar`'s `'full'`.
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
  offers: ['chips', 'list'],
  characterBlock: ['compact', 'full', 'rail'],
  actionBar: ['chips', 'bar'],
  suzuPresence: ['compact', 'full'],
  topBar: ['band', 'overlay'],
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

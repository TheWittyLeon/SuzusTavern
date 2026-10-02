/**
 * TAV-PLAY-SHELL step 6a — pure-data tests for
 * `src/app/play/[sessionId]/presets.ts`. No rendering, no RTL: the registry
 * is data + one pure resolver function, so these are plain assertions over
 * the exported constants, following the raw-data-assertion family already
 * established by `play-data-region-contract.test.ts` /
 * `play-region-import-direction.test.ts` (source/data checks, not mounts).
 *
 * Five things this file pins, per the item brief:
 *  (a) row-completeness — every RegionId has a `default` Placement in every
 *      LayoutRow (the "tenth region costs one row edit" guard: a RegionId
 *      added to the union without a row entry must fail here).
 *  (b) the R3 render-matrix rule at the data level — every
 *      `ANNOUNCING_REGIONS` member is never `visible: false` in any row ×
 *      moment (see presets.ts's own header for why this holds by design,
 *      not by exception).
 *  (c) lives in theme.test.tsx, beside `resolveVibe`'s own tests (plan
 *      §3.3: "same file, same test file, same mental model").
 *  (d) likewise lives in theme.test.tsx (ThemeProvider/NO_FLASH_SCRIPT).
 *  (e) area/placement consistency — a row's `areas` string names exactly
 *      the set of areas its regions place, in both directions (no orphan
 *      grid area, no region pointing at a missing area).
 *
 * Plus one bonus structural check (not in the lettered list, but the same
 * concern one level down): every `areas` string is syntactically valid
 * `grid-template-areas` — uniform column count per row, and every named
 * area forms exactly one rectangle. A hand-authored template string that
 * violates this would be invisible to (e) (which only checks token SETS,
 * not shape) and would be rejected by a real browser silently (an invalid
 * grid-template-areas value falls back to the initial 'none').
 */
import {
  ANCHORS,
  ANNOUNCING_REGIONS,
  FACTS,
  LAYOUT_ROWS,
  LAYOUT_ROWS_BY_ID,
  REGION_VARIANTS,
  REGION_IDS,
  REGION_TENANTS,
  VARIANTS_NOT_EMITTED_BY_PRESETS,
  FOLDABLE_ANNOUNCERS,
  FOLDABLE_REGIONS,
  getPlacement,
  isRegionVariant,
  type LayoutId,
  type LayoutRow,
  type Moment,
  type Placement,
  type RegionId,
} from '../../app/play/[sessionId]/presets';

const MOMENTS: readonly Moment[] = ['exploring', 'combat'];

/** Every non-'.' token used across a `grid-template-areas` value's quoted rows. */
function areaTokens(areasValue: string): Set<string> {
  const rows = [...areasValue.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  const tokens = new Set<string>();
  for (const row of rows) {
    for (const tok of row.trim().split(/\s+/)) {
      if (tok !== '.') tokens.add(tok);
    }
  }
  return tokens;
}

/** The set of areas actually placed by SOME region in `row` for `moment`. */
function placedAreas(row: LayoutRow, moment: Moment): Set<string> {
  const out = new Set<string>();
  for (const id of REGION_IDS) {
    const area = getPlacement(row, id, moment).area;
    if (area) out.add(area);
  }
  return out;
}

/** Parses a `grid-template-areas` value into its row-of-tokens grid, and
 *  validates it is syntactically well-formed: every row has the same
 *  column count, and every named token's occurrences form one rectangle
 *  (CSS's own requirement — an area that isn't a rectangle is invalid and
 *  the whole property falls back to `none` in a real browser). Returns the
 *  list of validation problems (empty = valid). */
function gridTemplateAreaProblems(areasValue: string): string[] {
  const rows = [...areasValue.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim().split(/\s+/));
  const problems: string[] = [];
  if (rows.length === 0) return ['no quoted rows found'];
  const cols = rows[0].length;
  rows.forEach((r, i) => {
    if (r.length !== cols) problems.push(`row ${i} has ${r.length} columns, expected ${cols}`);
  });

  const cells = new Map<string, Array<[number, number]>>();
  rows.forEach((row, r) => {
    row.forEach((tok, c) => {
      if (tok === '.') return;
      const list = cells.get(tok) ?? [];
      list.push([r, c]);
      cells.set(tok, list);
    });
  });

  for (const [tok, coords] of cells) {
    const rs = coords.map(([r]) => r);
    const cs = coords.map(([, c]) => c);
    const minR = Math.min(...rs);
    const maxR = Math.max(...rs);
    const minC = Math.min(...cs);
    const maxC = Math.max(...cs);
    const expectedCount = (maxR - minR + 1) * (maxC - minC + 1);
    if (coords.length !== expectedCount) {
      problems.push(`"${tok}" occurrences (${coords.length}) do not form one rectangle (bounding box needs ${expectedCount})`);
    }
  }
  return problems;
}

describe('TAV-PLAY-SHELL presets.ts — row completeness (a)', () => {
  it('REGION_IDS is non-empty (guards the test itself against a silently-empty union)', () => {
    expect(REGION_IDS.length).toBeGreaterThan(0);
  });

  it('LAYOUT_ROWS covers all three presets', () => {
    expect(LAYOUT_ROWS.map((r) => r.id).sort()).toEqual(['phone', 'story', 'table']);
  });

  for (const row of LAYOUT_ROWS) {
    for (const id of REGION_IDS) {
      it(`${row.id}: "${id}" has a default Placement`, () => {
        expect(row.regions[id]).toBeDefined();
        expect(row.regions[id].default).toBeDefined();
        expect(typeof row.regions[id].default.area === 'string' || row.regions[id].default.area === null).toBe(
          true,
        );
      });
    }
  }
});

describe('TAV-PLAY-SHELL presets.ts — announces render-matrix (b, plan R3)', () => {
  it('ANNOUNCING_REGIONS is non-empty and every member is a real RegionId', () => {
    expect(ANNOUNCING_REGIONS.size).toBeGreaterThan(0);
    for (const id of ANNOUNCING_REGIONS) expect(REGION_IDS).toContain(id);
  });

  // Kage-CR CRITICAL-1 (2026-09-30): the old guard read ONE field
  // (`visible`) and missed the undefined third state where `area: null`
  // with no `layer` means the region has no mount point at all —
  // silently never rendered anywhere. R3 requires a mount point, not
  // merely the absence of `visible: false`. (A9d E2 retired `host`, the third
  // kind of mount point: every region is now grid-placed or a layer.)
  for (const row of LAYOUT_ROWS) {
    for (const region of ANNOUNCING_REGIONS) {
      for (const moment of MOMENTS) {
        it(`${row.id}/${moment}: "${region}" has a mount point and is never hidden`, () => {
          const placement = getPlacement(row, region, moment);
          expect(placement.visible).not.toBe(false);
          // R3: an announcing region must have a mount point — a grid
          // area or a layer.
          expect(placement.area !== null || placement.layer === true).toBe(true);
        });
      }
    }
  }
});

describe('TAV-PLAY-SHELL presets.ts — Amendment A pinned positively (CRITICAL-1)', () => {
  // The old suite only pinned "never visible:false" for ANNOUNCING_REGIONS,
  // which never covers `offers` (not announcing) — so Amendment A's literal
  // requirement (`regions.offers.combat = { visible: false }`, plan §3.2)
  // was never actually asserted anywhere. Pin it positively, per row.
  for (const row of LAYOUT_ROWS) {
    it(`${row.id}/combat: "offers" is area:null and visible:false (Amendment A)`, () => {
      const placement = getPlacement(row, 'offers', 'combat');
      expect(placement.area).toBeNull();
      expect(placement.visible).toBe(false);
    });
  }
});

describe('TAV-PLAY-SHELL presets.ts — area/placement consistency (e)', () => {
  for (const row of LAYOUT_ROWS) {
    for (const moment of MOMENTS) {
      it(`${row.id}/${moment}: every area named in the areas string is placed by some region`, () => {
        const tokens = areaTokens(row.areas[moment]);
        const placed = placedAreas(row, moment);
        const orphanAreas = [...tokens].filter((t) => !placed.has(t));
        expect(orphanAreas).toEqual([]);
      });

      it(`${row.id}/${moment}: every region-placed area appears in the areas string`, () => {
        const tokens = areaTokens(row.areas[moment]);
        const placed = placedAreas(row, moment);
        const missingAreas = [...placed].filter((a) => !tokens.has(a));
        expect(missingAreas).toEqual([]);
      });
    }
  }
});

/** C1-b as a function of a row, so the controls below can feed it mutated rows. */
function coOccupancyViolations(row: LayoutRow, moment: Moment): string[] {
  const out: string[] = [];
  const byArea = new Map<string, { id: RegionId; anchor?: string }[]>();
  for (const id of REGION_IDS) {
    const p = getPlacement(row, id, moment);
    if (p.area == null) continue;
    const list = byArea.get(p.area) ?? [];
    list.push({ id, anchor: p.anchor });
    byArea.set(p.area, list);
  }
  for (const [area, members] of byArea) {
    const owners = members.filter((m) => m.anchor === undefined);
    if (owners.length !== 1) out.push(`"${area}": ${owners.length} owners (${owners.map((o) => o.id).join(', ')})`);
    const seen = new Set<string>();
    for (const m of members) {
      if (m.anchor === undefined) continue;
      if (seen.has(m.anchor)) out.push(`"${area}": two overlays at ${m.anchor}`);
      seen.add(m.anchor);
    }
  }
  return out;
}

/** C1-a. `anchor` needs an area to sit in and excludes `layer` (no slot). */
function anchorShapeViolations(row: LayoutRow, moment: Moment): string[] {
  const out: string[] = [];
  for (const id of REGION_IDS) {
    const p = getPlacement(row, id, moment);
    if (p.anchor === undefined) continue;
    if (!(ANCHORS as readonly string[]).includes(p.anchor)) out.push(`${id}: unknown anchor ${p.anchor}`);
    if (p.area == null) out.push(`${id}: anchor without an area`);
    if (p.layer === true) out.push(`${id}: anchor on a layer`);
  }
  return out;
}

/** C1-c. The owner of an anchored area is placed and never visible:false (C1-b separately demands exactly one). */
function anchorOwnerViolations(row: LayoutRow, moment: Moment): string[] {
  const out: string[] = [];
  for (const id of REGION_IDS) {
    const p = getPlacement(row, id, moment);
    if (p.anchor === undefined || p.area == null) continue;
    for (const o of REGION_IDS) {
      const q = getPlacement(row, o, moment);
      if (q.area === p.area && q.anchor === undefined && q.visible === false) {
        out.push(`${id} overlays ${o}, which is visible:false`);
      }
    }
  }
  return out;
}

/**
 * C1-d (A9d E2, Kage S8). The owner of an anchored area is never collapsible:
 * folded, the owner shrinks to its handle row, so any corner of the overlay
 * collides with the handle. Zero violations on the real rows.
 */
function anchorCollapsibleOwnerViolations(row: LayoutRow, moment: Moment): string[] {
  const out: string[] = [];
  for (const id of REGION_IDS) {
    const p = getPlacement(row, id, moment);
    if (p.anchor === undefined || p.area == null) continue;
    for (const o of REGION_IDS) {
      const q = getPlacement(row, o, moment);
      if (q.area === p.area && q.anchor === undefined && q.collapsible === true) {
        out.push(`${id} overlays ${o}, which is collapsible`);
      }
    }
  }
  return out;
}

describe('TAV-PLAY-SHELL presets.ts — grid co-occupancy (CRITICAL-2, rewritten by C1-b): one owner per area, the rest anchored', () => {
  // Kage-CR CRITICAL-2 (2026-09-30): `area` used to be overloaded — a
  // duplicate `area: 'x'` string across two regions was indistinguishable
  // from a typo, with nothing in the data marking it intentional. `anchor`
  // makes the declared share explicit. Written as "everything except declared
  // exemptions" rather than a list of known violators, so a NEW accidental
  // share reds the same way a known one does:
  for (const row of LAYOUT_ROWS) {
    for (const moment of MOMENTS) {
      // A9c C4 guard C1-b (Amendment C.1), replacing A9b's "unless one
      // declares the other as host" (retired with `host`, A9d E2): per row x moment, each non-null area
      // has exactly ONE owner (a placement with no `anchor`); every other
      // region naming it carries an `anchor`, and the anchors on one area
      // are pairwise distinct (two overlays on one corner would stack on
      // each other).
      // Written as "everything except the declared overlay", so a NEW
      // accidental share reds the same way a known one does.
      it(`${row.id}/${moment}: each area has exactly one owner; every other region on it is an anchored overlay with a distinct anchor (C1-b)`, () => {
        const violations = coOccupancyViolations(row, moment);
        expect(violations).toEqual([]);
      });

      // C1-a: `anchor` means "an overlay in somebody's area": it needs an
      // area to sit in, and it is exclusive of the two other ways a region
      // can ride another one (`layer` has no slot at all).
      it(`${row.id}/${moment}: an anchored region has an area and is not a layer (C1-a)`, () => {
        expect(anchorShapeViolations(row, moment)).toEqual([]);
      });

      it(`${row.id}/${moment}: the owner of an anchored area is placed and never visible:false (C1-c)`, () => {
        expect(anchorOwnerViolations(row, moment)).toEqual([]);
      });
    }
  }
});

/**
 * Controls for C1-a/b/c: each guard must go RED on the mutation named in the
 * build brief (section 2), on a clone of the real row (a guard that stays green
 * on its own control is aimed at the wrong thing).
 */
describe('A9c C4 — guards C1-a/b/c go red on their controls', () => {
  const table = LAYOUT_ROWS_BY_ID.table;
  const story = LAYOUT_ROWS_BY_ID.story;
  const patch = (row: LayoutRow, id: RegionId, p: Placement, moment?: Moment): LayoutRow => ({
    ...row,
    regions: {
      ...row.regions,
      [id]: moment ? { ...row.regions[id], [moment]: p } : { ...row.regions[id], default: p },
    },
  });

  it('the real rows are the green baseline', () => {
    for (const row of LAYOUT_ROWS) {
      for (const m of MOMENTS) {
        expect([...coOccupancyViolations(row, m), ...anchorShapeViolations(row, m), ...anchorOwnerViolations(row, m)]).toEqual([]);
      }
    }
  });

  it('C1-a: an anchor on a layer, or without an area, -> red', () => {
    expect(anchorShapeViolations(patch(table, 'topBar', { area: 'sceneStage', anchor: 'top-start', layer: true }), 'combat')).toContain('topBar: anchor on a layer');
    expect(anchorShapeViolations(patch(table, 'topBar', { area: null, anchor: 'top-start' }), 'combat')).toContain('topBar: anchor without an area');
  });

  it('C1-d: no row x moment overlays a collapsible owner (A9d E2)', () => {
    for (const row of LAYOUT_ROWS) {
      for (const m of MOMENTS) {
        expect(anchorCollapsibleOwnerViolations(row, m)).toEqual([]);
      }
    }
  });

  it('C1-d: table.sceneStage collapsible with the anchored topBar on it -> red', () => {
    const mutated = patch(table, 'sceneStage', { ...getPlacement(table, 'sceneStage', 'exploring'), collapsible: true });
    expect(anchorCollapsibleOwnerViolations(mutated, 'exploring')).toContain('topBar overlays sceneStage, which is collapsible');
  });

  it('C1-b: dropping `anchor` from table.topBar -> red (two owners of sceneStage)', () => {
    const mutated = patch(table, 'topBar', { area: 'sceneStage', variant: 'compact' });
    expect(coOccupancyViolations(mutated, 'exploring').join('\n')).toMatch(/"sceneStage": 2 owners/);
  });

  it('C1-b: story.composer = {area:storyLog} -> red (CRITICAL-2 fifth-share control)', () => {
    const mutated = patch(story, 'composer', { area: 'storyLog' });
    expect(coOccupancyViolations(mutated, 'exploring').join('\n')).toMatch(/"storyLog": 2 owners/);
  });

  it('C1-b: two overlays on one corner of one area -> red', () => {
    const mutated = patch(patch(table, 'topBar', { area: 'sceneStage', anchor: 'top-start' }), 'suzuPresence', { area: 'sceneStage', anchor: 'top-start' });
    expect(coOccupancyViolations(mutated, 'exploring').join('\n')).toMatch(/two overlays at top-start/);
  });

  it('C1-b: two overlays on DIFFERENT corners are fine (anchors are pairwise distinct, not unique per area)', () => {
    const mutated = patch(patch(table, 'topBar', { area: 'sceneStage', anchor: 'top-start' }), 'suzuPresence', { area: 'sceneStage', anchor: 'top-end' });
    expect(coOccupancyViolations(mutated, 'exploring')).toEqual([]);
  });

  it('C1-c: table.sceneStage.combat.visible=false -> red', () => {
    const mutated = patch(table, 'sceneStage', { area: 'sceneStage', variant: 'hero', visible: false }, 'combat');
    expect(anchorOwnerViolations(mutated, 'combat')).toEqual(['topBar overlays sceneStage, which is visible:false']);
    expect(anchorOwnerViolations(mutated, 'exploring')).toEqual([]);
  });
});

/**
 * Kage-CR IMPORTANT-3 (2026-09-30): none of the checks above pin row
 * CONTENT — a region↔area swap satisfies every structural check (both
 * tokens still exist, both directions of (e) still hold) and stays
 * invisible. This is the full literal pin: every RegionId's resolved
 * value in every row × moment, compared with `toEqual` against a
 * hand-written object (not derived from the data being tested). A value
 * is the area string, or `null` for a layer/no-placement. A swap, a drop, or an
 * accidental addition all go red in the same assertion.
 */
/**
 * Kage-CR 🟡-4 (2026-09-30 fix round, carried to A9b): folds variant/
 * layer/visible/collapsible into ONE composite string per placement, in a
 * fixed field order, instead of `pinnedValue`'s old area-or-null.
 * A DROPPED field (not just a wrong one) now changes the string, so the
 * full row pin below reds on it too — this is what N4 needs, since the
 * per-region variant loop further down only ever checks a value that is
 * PRESENT (an absent one is always legal there by construction).
 */
function pinnedValue(p: Placement): string {
  const parts: string[] = [p.area != null ? p.area : 'null'];
  if (p.anchor !== undefined) parts.push(`anchor:${p.anchor}`);
  if (p.variant !== undefined) parts.push(`variant:${p.variant}`);
  if (p.visible !== undefined) parts.push(`visible:${p.visible}`);
  if (p.layer !== undefined) parts.push(`layer:${p.layer}`);
  if (p.collapsible !== undefined) parts.push(`collapsible:${p.collapsible}`);
  return parts.join(' ');
}

/**
 * Amendment B (C1, 2026-09-30): the C0 fix round's `DENSITY_GUARD_EXEMPTIONS`
 * carried exactly one member — `suzuPresence: ['compact']` — as a named,
 * value-scoped tolerance for 🟡-5's then-open gap (`phone.suzuPresence`'s
 * real data had a value with no `REGION_DENSITIES` entry at all). Amendment
 * B.3 resolves 🟡-5 by declaring `suzuPresence: ['compact','full']` in
 * `REGION_VARIANTS` below, so that exemption's only member is now a
 * declared value — the exemption constant is deleted in the same commit
 * that fires its own `until:`, not left as a dead, empty `Record`.
 */
describe('TAV-PLAY-SHELL presets.ts — variant values are declared, as an invariant over EVERY region (🟡-4, inverts IMPORTANT-6)', () => {
  it('REGION_VARIANTS is non-empty and every key is a real RegionId', () => {
    const keys = Object.keys(REGION_VARIANTS) as (keyof typeof REGION_VARIANTS)[];
    expect(keys.length).toBeGreaterThan(0);
    for (const id of keys) expect(REGION_IDS).toContain(id);
  });

  // Kage-CR 🟡-4: the old loop iterated `Object.keys(REGION_VARIANTS)` —
  // the known-good list — so a region with NO entry there could carry ANY
  // variant value, including a typo'd one, and nothing would ever check it
  // (N7). Iterating every REGION_IDS member instead makes "undeclared
  // region, present value" a checked state rather than an unreachable one.
  for (const row of LAYOUT_ROWS) {
    for (const region of REGION_IDS) {
      for (const moment of MOMENTS) {
        it(`${row.id}/${moment}: "${region}"'s variant, if present, is from a declared region with a declared value`, () => {
          const variant = getPlacement(row, region, moment).variant;
          if (variant === undefined) return; // a region needn't emit one
          const allowed: readonly string[] | undefined = (
            REGION_VARIANTS as Partial<Record<RegionId, readonly string[]>>
          )[region];
          expect(allowed).toBeDefined();
          expect(allowed).toContain(variant);
        });
      }
    }
  }
});

describe('TAV-PLAY-SHELL presets.ts — every REGION_VARIANTS member is emitted by some row or declared not-emitted (Amendment B.3)', () => {
  const VARIANT_REGIONS = Object.keys(REGION_VARIANTS) as (keyof typeof REGION_VARIANTS)[];
  for (const region of VARIANT_REGIONS) {
    it(`"${region}": every declared variant is emitted by some row × moment, or listed in VARIANTS_NOT_EMITTED_BY_PRESETS`, () => {
      const emitted = new Set<string>();
      for (const row of LAYOUT_ROWS) {
        for (const moment of MOMENTS) {
          const v = getPlacement(row, region, moment).variant;
          if (v !== undefined) emitted.add(v);
        }
      }
      const exempt = new Set<string>(
        (VARIANTS_NOT_EMITTED_BY_PRESETS as Partial<Record<RegionId, readonly string[]>>)[region] ?? [],
      );
      const allowed: readonly string[] = REGION_VARIANTS[region];
      const unaccounted = allowed.filter((v) => !emitted.has(v) && !exempt.has(v));
      expect(unaccounted).toEqual([]);
    });
  }
});

describe('TAV-PLAY-SHELL presets.ts — Table\'s offers are chips and nothing caps them (A10 fix round F3)', () => {
  it('the offers vocabulary is chips and rows, each emitted by some row x moment (the `list` form is deleted, not kept dead)', () => {
    expect([...REGION_VARIANTS.offers]).toEqual(['chips', 'rows']);
    const emitted = new Set(LAYOUT_ROWS.flatMap((row) => MOMENTS.map((m) => getPlacement(row, 'offers', m).variant).filter(Boolean)));
    expect([...emitted].sort()).toEqual(['chips', 'rows']);
  });

  it('Table says chips while exploring (and hides offers in a fight), and its offers track is content-sized, never a cap', () => {
    expect(getPlacement(LAYOUT_ROWS_BY_ID.table, 'offers', 'exploring').variant).toBe('chips');
    expect(getPlacement(LAYOUT_ROWS_BY_ID.table, 'offers', 'combat')).toMatchObject({ area: null, visible: false });
    // A10 fix round 2 (named exception: this literal had `auto` bands and a `minmax(0,1fr)` log; the log is a floor now, so the bands beside it are whole: a scroller's automatic minimum is 0)
    expect(trackList(LAYOUT_ROWS_BY_ID.table.rows.exploring)).toEqual([
      'max-content', // safety banner
      'max-content', // the stage's scene line (with the title bar's reserve)
      'minmax(var(--play-body-floor,0px),var(--play-body,0px))', // the stage's body (0 and 0 while exploring)
      'minmax(var(--play-floor,calc(240px + 3 * var(--density-gap) + 46px)),1fr)', // the log: 240 inner + the slot's chrome (padding above and below, the gap to the recap, the 46px recap)
      'max-content', // the offers: whole, as Story's (it was `fit-content(120px)`, and hid two scene transitions)
      'max-content', // composer
      'max-content', // action bar
    ]);
    for (const row of LAYOUT_ROWS) for (const m of MOMENTS) expect(row.rows[m]).not.toMatch(/fit-content\(\s*120px\s*\)/);
  });

  it('the guard bites (control): Table back to `list` is not in the vocabulary, and a cap on the offers track is named', () => {
    const table = LAYOUT_ROWS_BY_ID.table;
    expect(isRegionVariant('offers', 'list')).toBe(false);
    expect(trackList(table.rows.exploring.replace(/\)\),1fr\) max-content max-content max-content$/, ')),1fr) fit-content(120px) max-content max-content'))[4]).toBe('fit-content(120px)');
  });
});

describe('A9c C7 — a fold hides the region\'s own announcers (R3): every foldable announcer is listed with a reason (build brief 5.5)', () => {
  const collapsibleIn = (rows: readonly LayoutRow[], id: RegionId) =>
    rows.some((row) => MOMENTS.some((m) => getPlacement(row, id, m).collapsible === true));
  const collapsibleSomewhere = (id: RegionId) => collapsibleIn(LAYOUT_ROWS, id);
  /** THE guard: collapsible announcers (in `rows`) with no FOLDABLE_ANNOUNCERS entry. The
   *  real assertion and the control below both call it (Kage A9c-1 S9: a control that
   *  re-implemented the filter could stay green while the guard rotted). */
  const unlistedFoldableAnnouncers = (rows: readonly LayoutRow[]) =>
    REGION_IDS.filter((id) => ANNOUNCING_REGIONS.has(id) && collapsibleIn(rows, id) && !(id in FOLDABLE_ANNOUNCERS));

  it('FOLDABLE_REGIONS is exactly the regions collapsible in some row x moment (derived, never hand-listed)', () => {
    expect([...FOLDABLE_REGIONS].sort()).toEqual(REGION_IDS.filter(collapsibleSomewhere).sort());
    expect(FOLDABLE_REGIONS.size).toBeGreaterThan(0);
  });

  it('every collapsible ANNOUNCING region has a non-empty FOLDABLE_ANNOUNCERS reason, and no entry is stale', () => {
    expect(unlistedFoldableAnnouncers(LAYOUT_ROWS)).toEqual([]);
    const needing = REGION_IDS.filter((id) => ANNOUNCING_REGIONS.has(id) && collapsibleSomewhere(id));
    for (const id of needing) {
      expect({ id, reason: (FOLDABLE_ANNOUNCERS[id] ?? '').length > 0 }).toEqual({ id, reason: true });
    }
    expect(Object.keys(FOLDABLE_ANNOUNCERS).sort()).toEqual([...needing].sort());
  });

  it('the guard bites: a collapsible announcer with no entry is detected (control: table.storyLog collapsible)', () => {
    const mutated = {
      ...LAYOUT_ROWS.find((r) => r.id === 'table')!,
      regions: {
        ...LAYOUT_ROWS.find((r) => r.id === 'table')!.regions,
        storyLog: { default: { area: 'storyLog', collapsible: true } },
      },
    } as LayoutRow;
    expect(unlistedFoldableAnnouncers([mutated])).toEqual(['storyLog']);
  });

  it('characterBlock no longer has a \'rail\' variant: the fold is the shell\'s mechanism, not a second one (Amendment C.4)', () => {
    expect(REGION_VARIANTS.characterBlock).toEqual(['compact', 'full']);
    expect(VARIANTS_NOT_EMITTED_BY_PRESETS).toEqual({});
  });
});

describe('TAV-PLAY-SHELL presets.ts — full row pin (IMPORTANT-3, 🟡-4 composite): every RegionId is where it should be, with every other field intact', () => {
  function pin(row: LayoutRow, moment: Moment): Record<string, string> {
    const out: Record<string, string> = {};
    for (const id of REGION_IDS) out[id] = pinnedValue(getPlacement(row, id, moment));
    return out;
  }

  it('story/exploring', () => {
    expect(pin(LAYOUT_ROWS_BY_ID.story, 'exploring')).toEqual({
      topBar: 'topBar variant:full',
      partyStrip: 'partyStrip variant:strip',
      sceneStage: 'sceneStage variant:panel',
      suzuPresence: 'suzuPresence variant:full',
      storyLog: 'storyLog',
      offers: 'offers variant:chips',
      characterBlock: 'null variant:compact layer:true',
      actionBar: 'actionBar variant:chips',
      composer: 'composer variant:full',
      tableControls: 'null layer:true',
      safetyBanner: 'safetyBanner',
    });
  });

  it('story/combat', () => {
    expect(pin(LAYOUT_ROWS_BY_ID.story, 'combat')).toEqual({
      topBar: 'topBar variant:full',
      partyStrip: 'partyStrip variant:rail',
      sceneStage: 'sceneStage variant:hero',
      suzuPresence: 'suzuPresence variant:full',
      storyLog: 'storyLog',
      offers: 'null visible:false',
      characterBlock: 'null variant:compact layer:true',
      actionBar: 'actionBar variant:chips',
      // A10 step 11 S1 (named exception: the stage is a `hero` in Story's fight and a hero hosts no tenant, so the dice leave it): `roll`. What pins the
      // invariant now: this literal, the guard below (every hero or inline stage cell emits a roll composer), play.dice-home.desktop.test.tsx on the real
      // page, and the harness's o:restControls (desktop) and dice-focus legs.
      composer: 'composer variant:roll',
      tableControls: 'null layer:true',
      safetyBanner: 'safetyBanner',
    });
  });

  it('table/exploring', () => {
    expect(pin(LAYOUT_ROWS_BY_ID.table, 'exploring')).toEqual({
      topBar: 'sceneStage anchor:top-start variant:compact',
      partyStrip: 'partyStrip variant:rail',
      sceneStage: 'sceneStage variant:hero',
      suzuPresence: 'suzuPresence variant:full',
      storyLog: 'storyLog',
      // A10 fix round F3 (named exception: this was `variant:list`, Table's one full-width button per offer in a 120px scrolling track, which hid two scene transitions
      // with no cue): Table's offers are chips, as Story's. What pins it now: this literal, the offers describe below (the vocabulary is chips and rows, each emitted), the
      // track literal of Table's exploring row (content-sized) and the harness's m:offersRest.
      offers: 'offers variant:chips',
      characterBlock: 'characterBlock variant:full collapsible:true',
      actionBar: 'actionBar variant:bar',
      // A10 step 11 S1 (named exception): Table's stage is a `hero` in both moments, so Roll is the dice's home in both. Pinned now by this literal,
      // the hero-stage guard below, play.dice-home.desktop.test.tsx and the harness.
      composer: 'composer variant:roll',
      tableControls: 'null layer:true',
      safetyBanner: 'safetyBanner',
    });
  });

  it('table/combat', () => {
    expect(pin(LAYOUT_ROWS_BY_ID.table, 'combat')).toEqual({
      topBar: 'sceneStage anchor:top-start variant:compact',
      partyStrip: 'partyStrip variant:rail',
      sceneStage: 'sceneStage variant:hero',
      suzuPresence: 'suzuPresence variant:full',
      storyLog: 'storyLog',
      offers: 'null visible:false',
      characterBlock: 'characterBlock variant:full collapsible:true',
      actionBar: 'actionBar variant:bar',
      // A10 step 11 S1 (named exception): Table's stage is a `hero` in both moments, so Roll is the dice's home in both. Pinned now by this literal,
      // the hero-stage guard below, play.dice-home.desktop.test.tsx and the harness.
      composer: 'composer variant:roll',
      tableControls: 'null layer:true',
      safetyBanner: 'safetyBanner',
    });
  });

  it('phone/exploring', () => {
    expect(pin(LAYOUT_ROWS_BY_ID.phone, 'exploring')).toEqual({
      topBar: 'topBar variant:compact',
      partyStrip: 'partyStrip variant:strip',
      // A9d-2 N5 (named exception: the phone's stage was `collapsible`, with a fold that visibly did nothing at 390x844): the scene STRIP
      // in both moments, never collapsible. What pins the invariant now: the literal here, the next describe's `max-content` stage track and
      // the phone-stage registry pin below (no phone placement sets `collapsible` on the stage), and the harness's o:restControls.
      sceneStage: 'sceneStage variant:inline',
      suzuPresence: 'suzuPresence variant:compact',
      storyLog: 'storyLog',
      offers: 'offers variant:rows',
      characterBlock: 'null variant:compact layer:true',
      actionBar: 'actionBar variant:bar',
      composer: 'composer variant:roll',
      tableControls: 'null layer:true',
      safetyBanner: 'safetyBanner',
    });
  });

  it('phone/combat', () => {
    expect(pin(LAYOUT_ROWS_BY_ID.phone, 'combat')).toEqual({
      topBar: 'topBar variant:compact',
      partyStrip: 'partyStrip variant:strip',
      sceneStage: 'sceneStage variant:inline',
      suzuPresence: 'suzuPresence variant:compact',
      storyLog: 'storyLog',
      offers: 'null visible:false',
      characterBlock: 'null variant:compact layer:true',
      actionBar: 'actionBar variant:bar',
      composer: 'composer variant:roll',
      tableControls: 'null layer:true',
      safetyBanner: 'safetyBanner',
    });
  });
});

/**
 * Kage-CR 🟡-3 (2026-09-30 fix round, carried to A9b): none of the checks
 * above pin row GEOMETRY — IMPORTANT-5's option (c) (Story-combat's
 * `partyStrip` taking column 3 full-height as a rail, instead of leaving it
 * a dead 280px track) is reachable only by reading the literal `areas`
 * string, and a revert of just that one column is invisible to every other
 * check here: the token count is unchanged, the rectangle check passes (one
 * cell is still a rectangle), (e)'s two set-membership directions both
 * still hold, and the full row pin above records the AREA NAME per region,
 * never the geometry those names are arranged into. Six literal pins (one
 * per row × moment), whitespace-normalised so indentation is free to vary,
 * close that hole. Control N3: revert column 3 of `story.areas.combat`
 * (rows 2-5) back to `.` must go red.
 */
function normalizeAreas(areasValue: string): string {
  return areasValue.replace(/\s+/g, ' ').trim();
}

describe('TAV-PLAY-SHELL presets.ts — row geometry is pinned as a literal (🟡-3)', () => {
  it('story/exploring', () => {
    expect(normalizeAreas(LAYOUT_ROWS_BY_ID.story.areas.exploring)).toBe(
      // A10 step 11 round 3 (named exception): Aoi's order, the text box, the X-card, then the offers last; the stage panel keeps its height down the right.
      normalizeAreas(`"safetyBanner safetyBanner safetyBanner"
                "topBar       topBar       partyStrip"
                "suzuPresence storyLog     sceneStage"
                "suzuPresence composer     sceneStage"
                "suzuPresence actionBar    sceneStage"
                "suzuPresence offers       sceneStage"`),
    );
  });

  it('story/combat', () => {
    expect(normalizeAreas(LAYOUT_ROWS_BY_ID.story.areas.combat)).toBe(
      // A10 step 11 S2b (named exception: the hero stage names its area on TWO lines, the scene line and the body): the stage's second line is new.
      // What pins it now: this literal, the row-track pins and the hero-stage guards below, and the harness's m:stageBody and t:stage-body-holds.
      normalizeAreas(`"safetyBanner safetyBanner safetyBanner"
             "topBar       topBar       partyStrip"
             "suzuPresence sceneStage   partyStrip"
             "suzuPresence sceneStage   partyStrip"
             "suzuPresence storyLog     partyStrip"
             "suzuPresence composer     partyStrip"
             "suzuPresence actionBar    partyStrip"`),
    );
  });

  it('table/exploring', () => {
    expect(normalizeAreas(LAYOUT_ROWS_BY_ID.table.areas.exploring)).toBe(
      // A10 step 11 S2b (named exception): the stage's second line, as Story's combat above. Round 3 (named exception, #54 = `sheet`, Aoi's V2): the sheet stops at the story log and the
      // text box, the X-card and the offers take the full width under it, in that order.
      normalizeAreas(`"safetyBanner safetyBanner safetyBanner safetyBanner"
                "partyStrip   sceneStage   sceneStage   characterBlock"
                "partyStrip   sceneStage   sceneStage   characterBlock"
                "partyStrip   suzuPresence storyLog     characterBlock"
                "partyStrip   composer     composer     composer"
                "partyStrip   actionBar    actionBar    actionBar"
                "partyStrip   offers       offers       offers"`),
    );
  });

  it('table/combat', () => {
    expect(normalizeAreas(LAYOUT_ROWS_BY_ID.table.areas.combat)).toBe(
      // A10 step 11 S2b (named exception): the stage's second line, as Story's combat above.
      normalizeAreas(`"safetyBanner safetyBanner safetyBanner safetyBanner"
             "partyStrip   sceneStage   sceneStage   characterBlock"
             "partyStrip   sceneStage   sceneStage   characterBlock"
             "partyStrip   suzuPresence storyLog     characterBlock"
             "partyStrip   suzuPresence composer     characterBlock"
             "partyStrip   actionBar    actionBar    actionBar"`),
    );
  });

  it('phone/exploring', () => {
    expect(normalizeAreas(LAYOUT_ROWS_BY_ID.phone.areas.exploring)).toBe(
      normalizeAreas(`"safetyBanner safetyBanner"
                "topBar       suzuPresence"
                "partyStrip   partyStrip"
                "sceneStage   sceneStage"
                "storyLog     storyLog"
                "offers       offers"
                "composer     composer"
                "actionBar    actionBar"`),
    );
  });

  it('phone/combat', () => {
    expect(normalizeAreas(LAYOUT_ROWS_BY_ID.phone.areas.combat)).toBe(
      normalizeAreas(`"safetyBanner safetyBanner"
             "topBar       suzuPresence"
             "partyStrip   partyStrip"
             "sceneStage   sceneStage"
             "storyLog     storyLog"
             "composer     composer"
             "actionBar    actionBar"`),
    );
  });
});

// A9d-2 N7 (Amendment E.4): the composer's variants. `full` is the stage's tray (the `panel` stage: Story while exploring); `roll` is every cell whose
// stage hosts no tenant: the phone (an `inline` strip), and since A10 step 11 S1 Story's combat and Table in both moments (`hero`).
describe('TAV-PLAY-SHELL presets.ts — the composer variant is the dice\'s home (A9d-2 N7, A10 S1)', () => {
  const HOME: Record<LayoutId, Record<Moment, string>> = {
    story: { exploring: 'full', combat: 'roll' },
    table: { exploring: 'roll', combat: 'roll' },
    phone: { exploring: 'roll', combat: 'roll' },
  };
  it.each(MOMENTS)('%s: story keeps the tray while exploring and says roll in a fight; table and the phone say roll', (moment) => {
    for (const id of ['story', 'table', 'phone'] as const) {
      expect([id, moment, getPlacement(LAYOUT_ROWS_BY_ID[id], 'composer', moment).variant]).toEqual([id, moment, HOME[id][moment]]);
    }
  });

  /** The guard (Sora brief 3.1: "a `hero` or `inline` stage hosts no tenant: such a row x moment emits `composer: 'roll'`"): the cells whose stage is not a `panel`. */
  const heroCellsWithATray = (rows: readonly LayoutRow[]) =>
    rows.flatMap((row) =>
      MOMENTS.filter((m) => {
        const stage = getPlacement(row, 'sceneStage', m).variant;
        return (stage === 'hero' || stage === 'inline') && getPlacement(row, 'composer', m).variant !== 'roll';
      }).map((m) => `${row.id}/${m}`),
    );
  it('no row x moment whose stage is a hero or an inline strip emits a composer that leaves the tray in the stage', () => {
    expect(heroCellsWithATray(LAYOUT_ROWS)).toEqual([]);
  });
  it('the guard bites: Story combat and Table with `full` in place of `roll` are each named (the control)', () => {
    const patched = (row: LayoutRow, region: 'composer', placement: Placement): LayoutRow => ({ ...row, regions: { ...row.regions, [region]: { default: placement } } });
    const full = { area: 'composer', variant: 'full' } as Placement;
    expect(heroCellsWithATray([patched(LAYOUT_ROWS_BY_ID.table, 'composer', full)])).toEqual(['table/exploring', 'table/combat']);
    const storyFull = patched(LAYOUT_ROWS_BY_ID.story, 'composer', full);
    expect(heroCellsWithATray([storyFull])).toEqual(['story/combat']);
  });
  it('the phone row declares no dice-column var any more (the dice open from Roll)', () => {
    expect(Object.keys(LAYOUT_ROWS_BY_ID.phone.vars ?? {})).not.toContain('--play-dice-columns');
  });
});

// A10 step 11 S2b (Sora's brief 3.1 / 3.2, Amendment F.1-F.3): a stage that can hold a map has a BODY: its area named on two consecutive lines (the scene
// line, then the body), a `hero` form, and the room as rows x cell: `--play-cell` on the row and, for every value of the `room` fact, a `--play-body`.
describe('TAV-PLAY-SHELL presets.ts — the stage\'s body (A10 S2b): a hero names its area on two lines and the row gives every room a size', () => {
  /** The line (0-based) of the track that reads `--play-body` in this cell, or -1. The stage's body is that line; its scene line is the one above. The EXACT token: a track
   *  that reads only `--play-body-floor` is not the body's size (`includes('var(--play-body')` matched both: Kage Tavern 9). */
  const bodyLine = (row: LayoutRow, m: Moment) => trackList(row.rows[m]).findIndex((t) => /var\(--play-body[,)]/.test(t));
  /** Whether `areas` names the stage on a line (0-based). */
  const stageOn = (row: LayoutRow, m: Moment, line: number) =>
    (([...row.areas[m].matchAll(/"([^"]*)"/g)][line]?.[1] ?? '').trim().split(/\s+/)).includes('sceneStage');
  /** The brief's guards, over any rows: a cell whose row has a body track names the stage on the body's line AND the line above and emits `hero`, and the
   *  row sizes every room; a `hero` has a body track. (Story's exploring panel names the stage on four lines of a side column and has no body track.) */
  const stageBodyProblems = (rows: readonly LayoutRow[]) =>
    rows.flatMap((row) =>
      MOMENTS.flatMap((m) => {
        const variant = getPlacement(row, 'sceneStage', m).variant;
        const line = bodyLine(row, m);
        const at = `${row.id}/${m}`;
        const out: string[] = [];
        if (line >= 0 && variant !== 'hero') out.push(`${at}: has a body track but the stage emits ${variant}, not hero`);
        if (variant === 'hero' && line < 0) out.push(`${at}: a hero stage with no body track`);
        if (line >= 0) {
          if (line < 1 || !stageOn(row, m, line) || !stageOn(row, m, line - 1)) out.push(`${at}: the body track is not under the stage's scene line (the stage must name both lines)`);
          else if (trackList(row.rows[m])[line - 1] !== 'max-content') out.push(`${at}: the scene line's track is not max-content`);
          if (!row.vars || !('--play-cell' in row.vars)) out.push(`${at}: a body track and no --play-cell on the row`);
          for (const value of FACTS.room) {
            const set = (row.factVars?.room as Record<string, Record<string, string> | undefined> | undefined)?.[value];
            if (!set || !('--play-body' in set)) out.push(`${at}: room "${value}" has no --play-body`);
          }
        }
        return out;
      }),
    );

  it('every row x moment with a body track names the stage on both its lines, emits hero, and sizes every room', () => {
    expect(stageBodyProblems(LAYOUT_ROWS)).toEqual([]);
  });

  it('the rooms are the brief\'s: Story 7 rows, Table 8, a short band of 3 in both, none while exploring, all of the 34px cell', () => {
    const body = (id: 'story' | 'table', room: 'board' | 'band' | 'none') => (LAYOUT_ROWS_BY_ID[id].factVars!.room as Record<string, Record<string, string>>)[room]['--play-body'];
    expect([body('story', 'board'), body('story', 'band'), body('story', 'none')]).toEqual(['calc(7 * var(--play-cell))', 'calc(3 * var(--play-cell))', '0px']);
    expect([body('table', 'board'), body('table', 'band'), body('table', 'none')]).toEqual(['calc(8 * var(--play-cell))', 'calc(3 * var(--play-cell))', '0px']);
    expect(LAYOUT_ROWS_BY_ID.story.vars).toEqual({ '--play-cell': '34px' });
    expect(LAYOUT_ROWS_BY_ID.table.vars).toEqual({ '--play-cell': '34px' });
  });

  it('the stage is two tracks, the scene line whole and the body from the row (no hand-summed cap): Story combat, Table both moments', () => {
    // A10 fix round F1 (named exception: these two combat literals were `minmax(0,var(--play-body,0px))`; the body is OPTIONAL now, between its floor and its size.
    // What pins the class: the track-class guard and the full-literal pins below). Table exploring keeps its plain body track: nothing there yields.
    const optional = 'minmax(var(--play-body-floor,0px),var(--play-body,0px))';
    expect(trackList(LAYOUT_ROWS_BY_ID.story.rows.combat).slice(2, 4)).toEqual(['max-content', optional]);
    // (A10 fix round 2, named exception: Table exploring's body was `minmax(0,var(--play-body,0px))`; it is the optional class like the combat rows', `none` being 0 and 0)
    expect(trackList(LAYOUT_ROWS_BY_ID.table.rows.exploring).slice(1, 3)).toEqual(['max-content', optional]);
    expect(trackList(LAYOUT_ROWS_BY_ID.table.rows.combat).slice(1, 3)).toEqual(['max-content', optional]);
    for (const row of [LAYOUT_ROWS_BY_ID.story, LAYOUT_ROWS_BY_ID.table]) for (const m of MOMENTS) expect(row.rows[m]).not.toMatch(/fit-content\((290|400)px\)|\b218px\b/);
  });

  it('the guard bites (controls): Story combat emitting panel, a body track under one stage line, a row missing a room value, a hero whose track nothing sizes, no cell', () => {
    const story = LAYOUT_ROWS_BY_ID.story;
    const patched = (row: LayoutRow, over: Partial<LayoutRow>): LayoutRow => ({ ...row, ...over });
    const asPanel = patched(story, { regions: { ...story.regions, sceneStage: { default: { area: 'sceneStage', variant: 'panel' } } } });
    expect(stageBodyProblems([asPanel]).join('|')).toMatch(/story\/combat: has a body track but the stage emits panel, not hero/);
    const oneLine = patched(story, { areas: { ...story.areas, combat: story.areas.combat.replace('"suzuPresence sceneStage   partyStrip"\n             "suzuPresence sceneStage   partyStrip"', '"suzuPresence sceneStage   partyStrip"') } });
    expect(stageBodyProblems([oneLine]).join('|')).toMatch(/story\/combat: the body track is not under the stage's scene line/);
    const noBand = patched(story, { factVars: { room: { board: { '--play-body': '1px' }, none: { '--play-body': '0px' } } } as unknown as LayoutRow['factVars'] });
    expect(stageBodyProblems([noBand]).join('|')).toMatch(/story\/combat: room "band" has no --play-body/);
    // (named exception, F1: the literal this patched is the optional body track now)
    const unread = patched(story, { rows: { ...story.rows, combat: story.rows.combat.replace('minmax(var(--play-body-floor,0px),var(--play-body,0px))', 'minmax(0,238px)') } });
    expect(stageBodyProblems([unread]).join('|')).toMatch(/story\/combat: a hero stage with no body track/);
    expect(stageBodyProblems([patched(story, { vars: undefined })]).join('|')).toMatch(/no --play-cell/);
    // A10 fix round (Kage Tavern 9): a body track that reads only the FLOOR is not a body track (the guard used to match the prefix `var(--play-body` of `--play-body-floor` too)
    const floorOnly = patched(story, { rows: { ...story.rows, combat: story.rows.combat.replace('minmax(var(--play-body-floor,0px),var(--play-body,0px))', 'minmax(var(--play-body-floor,0px),238px)') } });
    expect(bodyLine(floorOnly, 'combat')).toBe(-1);
    expect(stageBodyProblems([floorOnly]).join('|')).toMatch(/story\/combat: a hero stage with no body track/);
  });
});

// A10 step 11 fix round F1 (Sora's brief 3.2, Amendment F.8): the desktop combat rows have the phone's three track classes. A10 fix round 2 (Kage's suggestion 6): the guard is
// "every track is one of the three classes" over EVERY row x moment that declares a floored log (the phone's rows, Story combat, Table both moments), not an exact match of two rows'
// spellings: the phone mount's body track and party band are optional tracks spelled their own way (`minmax(Npx,var(--play-optional,auto))`) and must pass. A row x moment with a
// floored log has: every track WHOLE (`max-content`), FLOOR (`minmax(var(--play-floor,..),1fr)`, exactly one: the log) or OPTIONAL (a body between its floor and its room's size, or a band
// between its minimum and `--play-optional`); a banner floor for the shell's yield to read; and, for a track that reads the body floor, a body floor beside its size for EVERY room (a band
// does not yield: its floor is its size; none is 0).
describe('TAV-PLAY-SHELL presets.ts — the track classes: every track of a floored row is whole, floor or optional (A10 fix round F1, generalised in fix round 2)', () => {
  const WHOLE = /^max-content$/;
  const FLOOR = /^minmax\(var\(--play-floor,(\d+px|calc\(\d+px \+ 3 \* var\(--density-gap\) \+ \d+px\))\),1fr\)$/;
  // OPTIONAL is defined by what a track READS (Kage suggestion 6, made at the replay): its growth limit is `--play-body` or `--play-optional`, whatever its floor is spelled (a px number, the body's
  // floor variable, the phone's `var(--play-party-min,91px)`). `--play-body-floor` as the LIMIT is not it (that was the control: a body track that reads only the floor).
  const OPTIONAL = [/^minmax\(.+,var\(--play-(body|optional),[^)]*\)\)$/];
  const readsBodyFloor = (t: string) => /var\(--play-body-floor[,)]/.test(t);
  const classProblems = (rows: readonly LayoutRow[]) =>
    rows.flatMap((row) =>
      MOMENTS.flatMap((m) => {
        const tracks = trackList(row.rows[m]);
        const at = `${row.id}/${m}`;
        if (!tracks.some((t) => FLOOR.test(t))) {
          // a row x moment with no floored log is not class-based (Story exploring, today): unless it has an optional track, which only means anything beside a floor (the grid hands spare room to it before the log grows)
          return tracks.some((t) => OPTIONAL.some((re) => re.test(t))) ? [`${at}: a body or band that yields and a log with no floor (minmax(var(--play-floor,Npx),1fr))`] : [];
        }
        const out: string[] = [];
        if (tracks.filter((t) => FLOOR.test(t)).length !== 1) out.push(`${at}: more than one floor track (the log is the one floor)`);
        tracks.forEach((t, i) => {
          if (!WHOLE.test(t) && !FLOOR.test(t) && !OPTIONAL.some((re) => re.test(t))) out.push(`${at}: track ${i} "${t}" is not one of the three classes (whole max-content, floor minmax(var(--play-floor,..),1fr), optional): a scroller's automatic minimum is 0, so the grid would squeeze it`);
        });
        if (!row.momentVars?.[m]?.['--play-banner-floor']) out.push(`${at}: no --play-banner-floor for the log's yield`);
        if (tracks.some(readsBodyFloor)) {
          for (const value of FACTS.room) {
            const set = (row.factVars?.room as Record<string, Record<string, string> | undefined> | undefined)?.[value];
            if (!set || !('--play-body-floor' in set)) out.push(`${at}: room "${value}" has no --play-body-floor`);
            else if (value === 'band' && set['--play-body-floor'] !== set['--play-body']) out.push(`${at}: the band's floor "${set['--play-body-floor']}" is not its size "${set['--play-body']}" (a band does not yield)`);
            else if (value === 'none' && set['--play-body-floor'] !== '0px') out.push(`${at}: room "none" has a floor of ${set['--play-body-floor']}`);
          }
        }
        return out;
      }),
    );

  it('every row x moment with a floored log has only whole, floor and optional tracks, a banner floor, and a floor for every room where it has a body', () => {
    expect(classProblems(LAYOUT_ROWS)).toEqual([]);
  });

  it('every row x moment is class-based now: the cells judged are all six (both phone moments, both moments of Story and of Table), and none is exempt (round 3 removed Story exploring\'s exemption; a new row with no floor is a red here)', () => {
    const all = LAYOUT_ROWS.flatMap((row) => MOMENTS.map((m) => `${row.id}/${m}`));
    const judged = LAYOUT_ROWS.flatMap((row) => MOMENTS.filter((m) => trackList(row.rows[m]).some((t) => FLOOR.test(t))).map((m) => `${row.id}/${m}`));
    expect(judged).toEqual(all);
    expect(judged.sort()).toEqual(['phone/combat', 'phone/exploring', 'story/combat', 'story/exploring', 'table/combat', 'table/exploring']);
  });

  it('the literals: Story combat and Table combat, track by track, with the floor written from its tokens (210 + 3 x --density-gap + 30 status; 100 + the same for the banner)', () => {
    expect(trackList(LAYOUT_ROWS_BY_ID.story.rows.combat)).toEqual([
      'max-content', // safety banner
      'max-content', // top bar
      'max-content', // the stage's scene line
      'minmax(var(--play-body-floor,0px),var(--play-body,0px))', // the stage's body: between its floor (3 rows) and its room's size
      'minmax(var(--play-floor,calc(210px + 3 * var(--density-gap) + 30px)),1fr)', // the log: 210 inner + the slot's chrome (padding above and below, the gap to the status line, the 30px line)
      'max-content', // composer
      'max-content', // action bar
    ]);
    expect(trackList(LAYOUT_ROWS_BY_ID.table.rows.combat)).toEqual([
      'max-content',
      'max-content',
      'minmax(var(--play-body-floor,0px),var(--play-body,0px))',
      'minmax(var(--play-floor,calc(210px + 3 * var(--density-gap) + 30px)),1fr)',
      'max-content',
      'max-content',
    ]);
    // A10 step 11 round 3 (named exception: this was `['auto','auto','minmax(0,1fr)','auto','auto','max-content']`, "the exploring rows are untouched"): Story exploring is the same class row as Table's:
    // whole bands (an `auto` top track beside a floored log is squeezed: the header was clipped at y 36), the log a floor (240 inner + 3 gaps + the 46px recap), the offers last.
    expect(trackList(LAYOUT_ROWS_BY_ID.story.rows.exploring)).toEqual([
      'max-content', // safety banner
      'max-content', // top bar + party strip
      'minmax(var(--play-floor,calc(240px + 3 * var(--density-gap) + 46px)),1fr)', // the log
      'max-content', // composer
      'max-content', // action bar (the X-card)
      'max-content', // offers
    ]);
    // the Table row's exploring tracks: the same classes (it has the stage's two lines on top)
    expect(trackList(LAYOUT_ROWS_BY_ID.table.rows.exploring).filter((t) => t !== 'max-content')).toHaveLength(2);
  });

  it('a floor is its inner log plus the slot\'s chrome WRITTEN FROM THE GAP TOKEN, never a sum at the default gap (Kage Tavern 3: 288 held 210 inner at the default density only; `airy` 186, `compact` 228)', () => {
    // (the harness's a:storyLog at `airy` and `compact` on the real page is the measuring pin: zd-* shots; this is the spelling)
    const floors = ['story', 'table'].flatMap((id) => [LAYOUT_ROWS_BY_ID[id as 'story' | 'table'].rows.combat.match(/--play-floor,(calc\([^)]*\)[^)]*\))/)?.[1], LAYOUT_ROWS_BY_ID[id as 'story' | 'table'].momentVars!.combat!['--play-banner-floor']]);
    expect(floors).toHaveLength(4);
    for (const f of floors) expect(f).toMatch(/^calc\(\d+px \+ 3 \* var\(--density-gap\) \+ \d+px\)/);
    // no row spells a floor as a bare px number any more (the sum at one density)
    for (const row of LAYOUT_ROWS.filter((r) => r.id === 'story' || r.id === 'table')) for (const m of MOMENTS) expect(row.rows[m]).not.toMatch(/--play-floor,\d+px/);
    for (const row of LAYOUT_ROWS.filter((r) => r.id === 'story' || r.id === 'table')) for (const f of Object.values(row.momentVars ?? {})) expect(f?.['--play-banner-floor']).not.toMatch(/^\d+px$/);
  });

  it('the floors per room are the brief\'s: a board yields to 3 rows of the cell, a band never (its floor is its size), none is 0px', () => {
    const room = (id: 'story' | 'table') => LAYOUT_ROWS_BY_ID[id].factVars!.room as Record<string, Record<string, string>>;
    for (const id of ['story', 'table'] as const) {
      expect(room(id).board['--play-body-floor']).toBe('calc(3 * var(--play-cell))');
      expect(room(id).band['--play-body-floor']).toBe(room(id).band['--play-body']);
      expect(room(id).none['--play-body-floor']).toBe('0px');
    }
  });

  it('the guard bites (controls): the log back to minmax(0,1fr), each whole band back to auto, a room with no floor, a band floor that is not its size, no banner floor, a body track that reads only the floor', () => {
    const story = LAYOUT_ROWS_BY_ID.story;
    const patched = (row: LayoutRow, over: Partial<LayoutRow>): LayoutRow => ({ ...row, ...over });
    const withRows = (combat: string) => patched(story, { rows: { ...story.rows, combat } });
    expect(classProblems([withRows(story.rows.combat.replace('minmax(var(--play-floor,calc(210px + 3 * var(--density-gap) + 30px)),1fr)', 'minmax(0,1fr)'))]).join('|')).toMatch(/story\/combat: a body or band that yields and a log with no floor/);
    // each whole band back to `auto` (a scroller's minimum is 0: the grid would squeeze it): the banner, the top bar, the scene line, the composer, the action bar
    const tracks = trackList(story.rows.combat);
    const withTrack = (i: number, v: string) => withRows(tracks.map((t, j) => (j === i ? v : t)).join(' '));
    for (const i of [0, 1, 2, 5, 6]) expect(classProblems([withTrack(i, 'auto')]).join('|')).toMatch(new RegExp(`story/combat: track ${i} "auto" is not one of the three classes`));
    const fv = story.factVars!.room as Record<string, Record<string, string>>;
    const noFloor = patched(story, { factVars: { room: { ...fv, board: { '--play-body': fv.board['--play-body'] } } } as unknown as LayoutRow['factVars'] });
    expect(classProblems([noFloor]).join('|')).toMatch(/story\/combat: room "board" has no --play-body-floor/);
    const tallBandFloor = patched(story, { factVars: { room: { ...fv, band: { ...fv.band, '--play-body-floor': 'calc(2 * var(--play-cell))' } } } as unknown as LayoutRow['factVars'] });
    expect(classProblems([tallBandFloor]).join('|')).toMatch(/the band's floor "calc\(2 \* var\(--play-cell\)\)" is not its size/);
    expect(classProblems([patched(story, { momentVars: undefined })]).join('|')).toMatch(/story\/combat: no --play-banner-floor/);
    // a track of no class on ANY floored row is named (Table exploring's offers back to a 120px cap), and the phone's own optional spelling is accepted (the guard is not exact to two rows)
    const table = LAYOUT_ROWS_BY_ID.table;
    const capped = patched(table, { rows: { ...table.rows, exploring: table.rows.exploring.replace(/max-content max-content max-content$/, 'fit-content(120px) max-content max-content') } });
    expect(classProblems([capped]).join('|')).toMatch(/table\/exploring: track 4 "fit-content\(120px\)" is not one of the three classes/);
    expect(classProblems([LAYOUT_ROWS_BY_ID.phone])).toEqual([]);
    expect(classProblems([withRows(story.rows.combat.replace('minmax(var(--play-body-floor,0px),var(--play-body,0px))', 'minmax(0,var(--play-body-floor,0px))'))]).join('|')).toMatch(/story\/combat: track 3 "minmax\(0,var\(--play-body-floor,0px\)\)" is not one of the three classes/);
  });
});

describe('TAV-PLAY-SHELL presets.ts — phone track classes are pinned as literals (A9d E2)', () => {
  // Three classes (build brief): WHOLE tracks are `max-content`; the log is a FLOOR
  // (`minmax(var(--play-floor,N),1fr)`: the grid grows auto/fit-content tracks before
  // `fr`, so without a floor the log starves); optional tracks use `--play-optional`
  // as the growth limit. The log floor is the second pin on PHONE_STORY_LOG_MIN_PX.
  it('phone/exploring', () => {
    expect(trackList(LAYOUT_ROWS_BY_ID.phone.rows.exploring)).toEqual([
      'max-content',
      'max-content',
      'minmax(var(--play-party-min,91px),var(--play-optional,auto))',
      // the stage is a WHOLE band (A9d-2 N5): one scene strip that holds End combat, Stand and fight and the status, never scrolls
      'max-content',
      // 224 = 160 + 12 + 6 + 46 recap: the 241 budgeted a 63px recap that measures 46 (Kage A9d-1 S1)
      'minmax(var(--play-floor,224px),1fr)',
      'max-content',
      'max-content',
      'max-content',
    ]);
    expect(LAYOUT_ROWS_BY_ID.phone.columns.exploring).toBe('minmax(0,1fr) auto');
  });

  it('phone/combat', () => {
    expect(trackList(LAYOUT_ROWS_BY_ID.phone.rows.combat)).toEqual([
      'max-content',
      'max-content',
      'minmax(var(--play-party-min,91px),var(--play-optional,auto))',
      'max-content',
      'minmax(var(--play-floor,208px),1fr)',
      'max-content',
      'max-content',
    ]);
    expect(LAYOUT_ROWS_BY_ID.phone.columns.combat).toBe('minmax(0,1fr) auto');
  });

  it('only the phone row spends less than the density gap per slot (desktop rows set no --play-slot-* var)', () => {
    expect(LAYOUT_ROWS_BY_ID.phone.vars).toEqual({
      '--play-slot-edge': 'var(--space-3)',
      '--play-slot-pad': '0px',
      '--play-slot-inline': 'var(--space-6)',
      '--play-recap-sub': 'none',
      // A9d-2 N7 (named exception: `--play-dice-columns` is deleted with the stage's dice tenant on the phone; the dice are in the Roll popover and
      // size themselves: DiceTray.module.css `.diceGridPopover`). What pins the deletion: no row declares it, and the S6 reader test below.
      // A9d-2 N6: the phone composer's own density (6px pad, 8px gap; it was 22 and 16: 145 -> 121px). The literal is the pin; the S6 reader
      // test and composer-density.css.test cover the stylesheet side. (This literal enumerates the set, so it grows with it.)
      '--play-composer-pad': 'var(--space-3)',
      '--play-composer-gap': 'var(--space-4)',
      // A10 fix round F6 (named exception: this literal enumerates the set, so it grows with it): the `roll` composer's wrap is the phone row's, two values the composer's CSS reads
      // (the mode row takes a line of its own, the input keeps `flex: 1`), where it was `@media (max-width: 880px)` in the stylesheet. The control is that no cell, check line or
      // budget line moves on any viewport (the harness run at the commit before and at this one); composer-roll-row.css.test and the readers test pin the two names.
      '--play-roll-mode-flex': '1 0 100%',
      '--play-roll-input-flex': '1 1 0%',
    });
    // A10 step 11 S2b (named exception): the desktop rows now carry `--play-cell`, the board's square. They still set no `--play-slot-*` var, which
    // is what this pins (the old `vars` toBeUndefined was the same claim by a blunter test).
    expect(Object.keys(LAYOUT_ROWS_BY_ID.story.vars ?? {}).filter((k) => k.startsWith('--play-slot'))).toEqual([]);
    expect(Object.keys(LAYOUT_ROWS_BY_ID.table.vars ?? {}).filter((k) => k.startsWith('--play-slot'))).toEqual([]);
  });

  it('the phone row carries a banner floor per moment (exploring pays the recap chrome, combat the status line); both desktop rows carry one for both moments (their exploring log is a floor, round 3)', () => {
    expect(LAYOUT_ROWS_BY_ID.phone.momentVars).toEqual({
      // 152 = 88 + 64 (exploring chrome: 12 edge + 6 gap + 46 recap); 136 = 88 + 48 (combat). The reflow minimum is gone with the stage's fold.
      exploring: { '--play-banner-floor': '152px' },
      combat: { '--play-banner-floor': '136px' },
    });
    // A10 fix round F1 (named exception: these two were `toBeUndefined`, "desktop rows carry none"). The desktop combat rows are floored now: 178 = 100 inner (the
    // harness's banner-up combat floor) + 78 of the story slot's chrome. Exploring has no body to yield and carries none.
    // A10 fix round 2 (named exception: these two were the literal '178px'): the floor is written from the gap token, so `airy` and `compact` keep 100 inner.
    expect(LAYOUT_ROWS_BY_ID.story.momentVars).toEqual({
      exploring: { '--play-banner-floor': 'calc(230px + 3 * var(--density-gap) + 46px)' },
      combat: { '--play-banner-floor': 'calc(100px + 3 * var(--density-gap) + 30px)' },
    });
    // Exploring has one too (fix round 2 for Table, round 3 for Story: the log is a floor, so the banner's yield reads a value: the shell's `--play-floor: var(--play-banner-floor, 0px)` would be a floor of 0 without it)
    expect(LAYOUT_ROWS_BY_ID.table.momentVars).toEqual({
      exploring: { '--play-banner-floor': 'calc(230px + 3 * var(--density-gap) + 46px)' },
      combat: { '--play-banner-floor': 'calc(100px + 3 * var(--density-gap) + 30px)' },
    });
  });
});

// A9d-2 N5 (Sora lever brief 2.1, Tora 3): the phone has no scene picture and no stage fold until step 12's map. No phone placement may set
// `collapsible` on the stage (the fold returns with the map and re-asserts Iro's fold acceptance, Backlog TAV-PHONE-STAGE-FOLD-RETURNS), the
// stage is the strip in both moments, and the only band that may be optional is the party's.
describe('TAV-PLAY-SHELL presets.ts — the phone stage is a whole, never-collapsible scene strip (A9d-2 N5)', () => {
  const phone = LAYOUT_ROWS_BY_ID.phone;
  it.each(MOMENTS)('%s: variant inline, not collapsible', (moment) => {
    const p = getPlacement(phone, 'sceneStage', moment);
    expect(p.variant).toBe('inline');
    expect(p.collapsible).toBeUndefined();
  });
  it('no phone placement of ANY region sets collapsible on the stage, and the stage is in no FOLDABLE set a phone moment reaches', () => {
    for (const moment of MOMENTS) expect(getPlacement(phone, 'sceneStage', moment).collapsible).not.toBe(true);
    expect(FOLDABLE_REGIONS.has('sceneStage')).toBe(false);
    expect(FOLDABLE_REGIONS.has('characterBlock')).toBe(true); // Table's docked sheet is the one fold left
  });
  it('the stage track is `max-content` in both moments, and the party band is the only OPTIONAL track (--play-optional)', () => {
    for (const moment of MOMENTS) {
      const tracks = trackList(phone.rows[moment]);
      const areaOrder = phone.areas[moment].match(/"[^"]*"/g)!.map((l) => l.replace(/"/g, '').trim().split(/\s+/)[0]);
      expect(tracks[areaOrder.indexOf('sceneStage')]).toBe('max-content');
      expect(tracks.filter((t) => t.includes('--play-optional'))).toHaveLength(1);
      expect(tracks[areaOrder.indexOf('partyStrip')]).toContain('--play-optional');
    }
  });
  it('the phone row says scrollCue (E.7: a band that hides content paints a cue); the desktop rows do not', () => {
    expect(phone.scrollCue).toBe(true);
    expect(LAYOUT_ROWS_BY_ID.story.scrollCue).toBeUndefined();
    expect(LAYOUT_ROWS_BY_ID.table.scrollCue).toBeUndefined();
  });
});

describe('TAV-PLAY-SHELL presets.ts — grid-template-areas are syntactically valid (bonus structural check)', () => {
  for (const row of LAYOUT_ROWS) {
    for (const moment of MOMENTS) {
      it(`${row.id}/${moment}: uniform column count, every named area is one rectangle`, () => {
        expect(gridTemplateAreaProblems(row.areas[moment])).toEqual([]);
      });
    }
  }
});

/** Column count implied by an `areas` value's first quoted row (same parse
 *  as `gridTemplateAreaProblems`, exposed for the `columns` cross-check below). */
function areaColumnCount(areasValue: string): number {
  const firstRow = areasValue.match(/"([^"]*)"/);
  return firstRow ? firstRow[1].trim().split(/\s+/).length : 0;
}

/** Track count of a `grid-template-columns` (or `-rows`) value. Paren-aware (`trackList`): a floor written from its tokens is a `calc()` with spaces in it
 *  (A10 fix round 2; this was a whitespace split, "safe while no track contains a space", Kage-CR S1's own note). */
function columnsTokenCount(columnsValue: string): number {
  return trackList(columnsValue).length;
}

/** The number of quoted rows (lines) in a `grid-template-areas` value —
 *  same parse as `gridTemplateAreaProblems`'s own `rows`, exposed for the
 *  `rows` field cross-check below (Amendment B.2). */
function areaRowCount(areasValue: string): number {
  return [...areasValue.matchAll(/"([^"]*)"/g)].length;
}

describe('TAV-PLAY-SHELL presets.ts — columns/areas agree on track count (S1)', () => {
  // Kage-CR S1 (2026-09-30): `columns` and `areas` can disagree silently —
  // a `columns` value with fewer tracks than `areas` declares columns
  // leaves the extra area an implicit `auto` track in CSS, a silent
  // visual break invisible to every other check here (which only look at
  // `areas`, never at `columns`).
  for (const row of LAYOUT_ROWS) {
    for (const moment of MOMENTS) {
      it(`${row.id}/${moment}: columns has exactly as many tracks as areas has columns`, () => {
        expect(columnsTokenCount(row.columns[moment])).toBe(areaColumnCount(row.areas[moment]));
      });
    }
  }
});

describe('TAV-PLAY-SHELL presets.ts — rows/areas agree on track count (Amendment B.2, extends S1)', () => {
  // Amendment B.2: `rows` is `grid-template-rows`, one track per `areas`
  // LINE (not column) — without an explicit track list every band is
  // `auto` in a fixed-height, `overflow:hidden` grid, and content clips.
  // Putting the track list in CSS keyed on `[data-layout-resolved]
  // [data-moment]` instead (the plan §3.1 option B this rejects, one axis
  // over) would let the CSS and the row disagree with nothing to catch it.
  for (const row of LAYOUT_ROWS) {
    for (const moment of MOMENTS) {
      it(`${row.id}/${moment}: rows has exactly as many tracks as areas has lines`, () => {
        expect(columnsTokenCount(row.rows[moment])).toBe(areaRowCount(row.areas[moment]));
      });
    }
  }
});

describe('TAV-PLAY-SHELL presets.ts — layer and area are mutually exclusive (S2, 🟡-1)', () => {
  // Kage-CR S2 (2026-09-30): `Placement.layer`'s own doc says "When true,
  // `area` is always null" — a doc-comment invariant with no guard. A
  // region that is both grid-placed AND a layer would render docked AND
  // as an overlay simultaneously at step 6b.
  //
  // Kage-CR 🟡-1 (2026-09-30 fix round, carried to A9b): `Placement.host`'s
  // own doc states the identical convention ("when set, `area` is always
  // null ... same convention as `layer`"), but S2's fix was only applied to
  // `layer` when it landed — `host` was a NEW field this same round and the
  // guard never extended to it. Folded into the same loop rather than a
  // second describe block, since it is the same invariant on a sibling
  // field. Control N1: `story.storyLog -> {area:'storyLog',
  // host:'sceneStage'}` must go red.
  for (const row of LAYOUT_ROWS) {
    for (const region of REGION_IDS) {
      for (const moment of MOMENTS) {
        it(`${row.id}/${moment}: "${region}" is never both layer:true and grid-placed`, () => {
          const placement = getPlacement(row, region, moment);
          if (placement.layer === true) expect(placement.area).toBeNull();
        });
      }
    }
  }
});

/** Splits a `grid-template-rows` value into tracks, keeping `minmax(0,1fr)` /
 *  `fit-content(300px)` intact (a comma or space inside parens is not a
 *  track boundary). */
function trackList(value: string): string[] {
  const tracks: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) tracks.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) tracks.push(cur);
  return tracks;
}

/** 0-based indices of the area rows (lines of the `areas` string) that name `area`. */
function rowsSpannedBy(areasValue: string, area: string): number[] {
  return [...areasValue.matchAll(/"([^"]*)"/g)]
    .map((m, i) => (m[1].trim().split(/\s+/).includes(area) ? i : -1))
    .filter((i) => i >= 0);
}

describe('TAV-PLAY-SHELL presets.ts — the X-card control is always on screen (A9b Imp-5 + Aoi B2)', () => {
  // Invariant (coordinator, 2026-09-30): the X-card raise control is visible
  // inside the viewport WITHOUT scrolling the page or any nested container,
  // in every row x moment. At the data level that means its host region is
  // (1) placed directly (not hosted by another region, not a layer),
  // (2) visible, and (3) lives only in content-sized rows (`max-content`: an `auto` bar
  // track is shrinkable by the greedy stage track, which clipped the phone X-card
  // while the banner was up, A9c-2 D0) — never a capped, scrolling box (`minmax(0,400px)` sceneStage
  // was).
  // The browser half (real geometry at 1440x900 and 390x844) is
  // `tools/ui-audit`'s `capture-play.mjs --assert-layout` check c:xCard.
  const host = REGION_TENANTS.safetyControls.host;

  for (const row of LAYOUT_ROWS) {
    for (const moment of MOMENTS) {
      it(`${row.id}/${moment}: safetyControls' host "${host}" is placed, visible, and sits only in content-sized rows`, () => {
        const placement = getPlacement(row, host, moment);
        expect(placement.layer).not.toBe(true);
        expect(placement.area).not.toBeNull();
        expect(placement.visible).not.toBe(false);

        const spanned = rowsSpannedBy(row.areas[moment], placement.area as string);
        expect(spanned.length).toBeGreaterThan(0);
        const tracks = trackList(row.rows[moment]);
        for (const i of spanned) {
          expect({ row: row.id, moment, line: i, track: tracks[i] }).toEqual({
            row: row.id,
            moment,
            line: i,
            track: 'max-content',
          });
        }
      });
    }
  }

  it('the host is not the stage: the control may never ride the scrolling scene slot again', () => {
    // Direct pin of the regression (a named-region compare is acceptable in
    // a regression pin, not in code): safetyControls was a sceneStage tenant.
    expect(host).not.toBe('sceneStage');
  });

  it("DiceTray's host is a placed region in every row x moment", () => {
    const diceHost = REGION_TENANTS.diceTray.host;
    for (const row of LAYOUT_ROWS) {
      for (const moment of MOMENTS) {
        const p = getPlacement(row, diceHost, moment);
        expect(p.area).not.toBeNull();
        expect(p.visible).not.toBe(false);
      }
    }
  });
});

describe('TAV-PLAY-SHELL presets.ts — no stage track grows to its cap (A9c-2 D7 lever 1)', () => {
  // `minmax(0,Npx)` is the shape the grid's "maximize tracks" step grows to N
  // whatever the content, so a capped stage built that way keeps its full
  // height even when it holds less, and the story log never gets the difference.
  // `fit-content(Npx)` keeps the same cap and sizes to content. Control: put
  // `minmax(0,400px)` back in table.rows.combat -> red.
  for (const row of LAYOUT_ROWS.filter((r) => r.id !== 'phone')) {
    for (const moment of MOMENTS) {
      it(`${row.id}/${moment}: no track is minmax(0,<N>px)`, () => {
        const grows = trackList(row.rows[moment]).filter((t) => /^minmax\(0,\s*\d+px\)$/.test(t));
        expect(grows).toEqual([]);
      });
    }
  }
});

describe('TAV-PLAY-SHELL presets.ts — the action bar can host tenants (A9c-2 D6)', () => {
  // CastSpellPanel is the second player combat-submit surface and rides the
  // action bar (Leon's S3 ruling: the bar is the single place a combat action is
  // submitted). A tenant is only reachable if its host is a PLACED, visible,
  // non-layer region in every row x moment, so this runs over whichever tenants
  // declare `actionBar` as host (derived, not listed): the tenth bar tenant is one
  // `REGION_TENANTS` row and inherits the guard.
  // Control: make `actionBar` a `layer` or `visible:false` in any row/moment -> red.
  const barTenants = (Object.keys(REGION_TENANTS) as Array<keyof typeof REGION_TENANTS>).filter(
    (t) => REGION_TENANTS[t].host === 'actionBar',
  );

  it('the bar hosts the cast panel next to the X-card control (D6 regression pin)', () => {
    expect(barTenants).toEqual(expect.arrayContaining(['castSpellPanel', 'safetyControls']));
  });

  for (const row of LAYOUT_ROWS) {
    for (const moment of MOMENTS) {
      it(`${row.id}/${moment}: actionBar is placed, visible and not a layer`, () => {
        const p = getPlacement(row, 'actionBar', moment);
        expect(p.layer).not.toBe(true);
        expect(p.area).not.toBeNull();
        expect(p.visible).not.toBe(false);
      });
    }
  }
});

describe('TAV-PLAY-SHELL presets.ts — getPlacement', () => {
  it('falls back to default when no moment-specific override exists', () => {
    const row = LAYOUT_ROWS.find((r) => r.id === 'story')!;
    // topBar has no per-moment override in any row.
    expect(getPlacement(row, 'topBar', 'exploring')).toBe(row.regions.topBar.default);
    expect(getPlacement(row, 'topBar', 'combat')).toBe(row.regions.topBar.default);
  });

  it('uses the moment-specific override when one exists', () => {
    const row = LAYOUT_ROWS.find((r) => r.id === 'story')!;
    expect(getPlacement(row, 'offers', 'combat')).toBe(row.regions.offers.combat);
    expect(getPlacement(row, 'offers', 'combat')).not.toBe(row.regions.offers.default);
  });

  it('throws a named error for a region missing from the row (Kage-CR IMPORTANT-7) instead of a bare TypeError', () => {
    const row = LAYOUT_ROWS.find((r) => r.id === 'story')!;
    // `tsc`'s Record<RegionId, ...> exhaustiveness check makes this
    // unreachable through the real, statically-typed data — this directly
    // exercises the defensive branch for a runtime-constructed row.
    const incompleteRow = { ...row, regions: {} } as unknown as LayoutRow;
    expect(() => getPlacement(incompleteRow, 'topBar', 'exploring')).toThrow(
      'no placement for "topBar" in row "story"',
    );
  });

  it('a moment override REPLACES the default wholesale — it does not merge in an unstated field (S5)', () => {
    // Kage-CR S5 (2026-09-30): `getPlacement`'s implementation
    // (`entry[moment] ?? entry.default`) is replace-not-merge, and the
    // docstring says "the override, else the default" — but nothing
    // PINS that A9b can rely on replacement, which is the contract's
    // most surprising property. Constructed row (not a real preset)
    // isolates the resolver's own semantics from whether any current
    // row's override happens to restate every field.
    const probeRow: LayoutRow = {
      id: 'story',
      columns: { exploring: '1fr', combat: '1fr' },
      rows: { exploring: 'auto', combat: 'auto' },
      areas: { exploring: '"x"', combat: '"x"' },
      regions: Object.fromEntries(
        REGION_IDS.map((id) => [
          id,
          id === 'sceneStage'
            ? {
                default: { area: 'x', collapsible: true, variant: 'panel' },
                // Deliberately omits `collapsible`/`variant`.
                combat: { area: 'x' },
              }
            : { default: { area: null } },
        ]),
      ) as LayoutRow['regions'],
    };
    const resolved = getPlacement(probeRow, 'sceneStage', 'combat');
    expect(resolved.collapsible).toBeUndefined();
    expect(resolved.variant).toBeUndefined();
  });
});

/**
 * Not a test — documents the exact hand-run mutation checks performed
 * during development (Ren-Dev's workflow brief: "break the data once,
 * watch each test fail for its own reason, then restore"). Kept as a
 * comment rather than a `.skip`ped test so it can't accidentally start
 * running or bit-rot silently. Each was applied, run (`npx jest
 * play-preset-registry.test.ts -t <filter>`), observed red, then reverted
 * before the next:
 *
 *  (a) Deleted `offers`'s `default` entry from the `story` row's
 *      `regions` object → reddened exactly ONE case,
 *      `story: "offers" has a default Placement`, nothing else (110 → 109
 *      passed, 1 failed).
 *  (b) Set `story.regions.safetyBanner.default.visible = false` → reddened
 *      exactly 2 of the 110 cases — `story/exploring` and `story/combat:
 *      "safetyBanner" is never visible:false` — the other two rows'
 *      safetyBanner cases stayed green, confirming the check is per-row.
 *  (e) Two separate single-token edits to `table.areas.exploring`, run
 *      one at a time (a single edit only breaks ONE direction of a
 *      bidirectional check, not both — confirmed empirically, not assumed):
 *        - typo'd ONE of `characterBlock`'s four occurrences to
 *          `characterBlok` → reddened ONLY "every area named in the areas
 *          string is placed by some region" (the typo is a new orphan);
 *          "every region-placed area appears in the string" stayed green
 *          because the other three correctly-spelled occurrences still
 *          satisfy it.
 *        - replaced ALL FOUR `characterBlock` occurrences with `.` → the
 *          mirror image: reddened ONLY "every region-placed area appears
 *          in the areas string" (the real placement now has nowhere to
 *          go); the orphan check stayed green because no unplaced token
 *          remains in the string.
 * All edits were reverted immediately after observing the red run, and the
 * full 110-case file was confirmed green again before the next one.
 *
 * Kage-CR fix-round mutations (2026-09-30), same discipline — applied,
 * run, observed red, reverted, full suite re-confirmed green:
 *
 *  M1 — CRITICAL-1's positive control. Set `story.regions.actionBar` to
 *      `{ default: { area: null } }` and dropped the `actionBar` token
 *      from both `story` `areas` strings (the exact shape Miko's
 *      overruled Q1 fix would have produced). Reddened exactly 2 cases:
 *      `story/exploring` and `story/combat: "actionBar" has a mount point
 *      and is never hidden` — the new R3 guard catches what the old
 *      "never visible:false" guard missed. All other 111 cases stayed
 *      green.
 *  M8 — CRITICAL-1's positive control. Dropped `visible: false` from
 *      `offers.combat` in all three rows (left `area: null`). Reddened
 *      exactly the 3 new Amendment A cases (`story/combat`, `table/combat`,
 *      `phone/combat: "offers" is area:null and visible:false`) — nothing
 *      in the old suite could see this at all, since `offers` is not an
 *      `ANNOUNCING_REGIONS` member.
 *
 * CRITICAL-2's grid co-occupancy guard, same discipline:
 *
 *  (Historical — `host` was retired in A9d E2; the same shape is now pinned
 *  by C1-a/C1-b/C1-d and the literal row pins.)
 *  Undo control — reverted `table.topBar`/`phone.partyStrip`/
 *      `phone.suzuPresence` from the fixed `host`-declared shape back to
 *      the ORIGINAL duplicate-`area`-string encoding (no `host` field at
 *      all). Reddened 4 cases — `table/exploring`, `table/combat`,
 *      `phone/exploring`, `phone/combat: "no two regions share a non-null
 *      area unless one declares the other as host"` — confirming the
 *      guard actually depends on the fix, not merely coexists with it.
 *      table's violation list held 1 pair (`topBar<->sceneStage`, both
 *      directions); phone's held 3 pairs, 6 entries — `topBar<->
 *      partyStrip`, `topBar<->suzuPresence`, AND `partyStrip<->
 *      suzuPresence` (the two tenants share `topBar` with EACH OTHER too,
 *      independent of `topBar` itself — this is Kage-CR's uncited
 *      "fourth" co-occupancy; resolved automatically once both declare
 *      `host: 'topBar'`, since neither then retains a non-null `area`).
 *      Reverted immediately; full 125-case file reconfirmed green.
 *  Fifth-share control — set `story.regions.composer.default.area` to
 *      `'storyLog'` (an accidental share the first-draft guard would have
 *      missed, per Kage-CR's own recommended check). Reddened exactly 2
 *      cases — `story/exploring` and `story/combat` — with both pair
 *      directions (`storyLog<->composer`, `composer<->storyLog`) in the
 *      violation list. Reverted immediately; full suite reconfirmed green.
 *
 * IMPORTANT-3's full row pin, re-running Kage-CR's own M3:
 *
 *  M3 — swapped `STORY_ROW.regions.storyLog.default.area` <->
 *      `composer.default.area` (both tokens already exist in the `areas`
 *      string, so both directions of check (e) still pass — exactly as
 *      Kage-CR documented). Reddened exactly the 2 IMPORTANT-3 pin cases
 *      (`story/exploring`, `story/combat`); all other 129 cases —
 *      including every (a)/(e)/bonus-structural/co-occupancy check —
 *      stayed green. Reverted immediately; full 131-case file
 *      reconfirmed green.
 *
 * IMPORTANT-6's variant-declaration guard, sanity check (not one of
 * Kage-CR's named mutations, but the same discipline):
 *
 *  Typo control — changed `story.regions.offers.default.variant` from
 *      `'chips'` to `'chipss'`. Reddened exactly 1 case (`story/
 *      exploring: "offers"'s variant is undefined or a declared
 *      member`), with the failure message listing the allowed set
 *      (`["chips", "list"]`). Reverted immediately; full 171-case file
 *      reconfirmed green.
 *
 * IMPORTANT-7's positive control (Kage-CR M6, re-run after deriving
 * `RegionId` FROM `REGION_IDS`):
 *
 *  M6 — added a 12th literal (`'ghostRegion'`) to the `REGION_IDS`
 *      array (no row edit). Reddened `tsc --noEmit` at the same 3 sites
 *      as before the fix (the three `Record<RegionId, ...>` `regions`
 *      literals, each now missing the 12th key) AND, unlike before the
 *      fix, reddened jest too: 33 of 166 cases in this file (163 + the
 *      3 new "ghostRegion has a default Placement" row-completeness
 *      cases). The other 30 are every other describe block that
 *      iterates `REGION_IDS` and calls `getPlacement` for the new id —
 *      each now fails with the IMPORTANT-7 named error ('no placement
 *      for "ghostRegion" in row "..."') rather than silently passing,
 *      confirming the two IMPORTANT-7 fixes compound: deriving the type
 *      makes the drift a `tsc` error, and the named throw turns every
 *      other consumer's failure mode from a bare `undefined` TypeError
 *      into a readable one. Reverted immediately; full 163-case file
 *      reconfirmed green.
 *
 * S1's positive control (Kage-CR M4):
 *
 *  M4 — dropped the 4th track from `table.columns.exploring`
 *      (`'160px 150px minmax(0,1fr) 300px'` -> `'160px 150px
 *      minmax(0,1fr)'`; `areas.exploring` still names 4 columns).
 *      Reddened exactly 1 case (`table/exploring: columns has exactly
 *      as many tracks as areas has columns`, 4 expected vs 3 received).
 *      Reverted immediately; full 169-case file reconfirmed green.
 *
 * S2's positive control (Kage-CR M7):
 *
 *  M7 — added `layer: true` to `table.characterBlock.default` (area
 *      stayed `'characterBlock'` — no per-moment override exists, so
 *      both moments share it). Reddened exactly 2 cases (`table/
 *      exploring` and `table/combat: "characterBlock" is never both
 *      layer:true and grid-placed`). Reverted immediately; full
 *      235-case file reconfirmed green.
 */

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
  ANNOUNCING_REGIONS,
  LAYOUT_ROWS,
  LAYOUT_ROWS_BY_ID,
  REGION_DENSITIES,
  REGION_IDS,
  getPlacement,
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
  // with no `layer`/`host` means the region has no mount point at all —
  // silently never rendered anywhere. R3 requires a mount point, not
  // merely the absence of `visible: false`. `host` counts as a mount
  // point (CRITICAL-2): a hosted announcer mounts inside its host, which
  // is itself placed — exercised for real by `table/*: "topBar"` and
  // `phone/*: "partyStrip"` below, both ANNOUNCING_REGIONS members that
  // are hosted rather than grid-placed.
  for (const row of LAYOUT_ROWS) {
    for (const region of ANNOUNCING_REGIONS) {
      for (const moment of MOMENTS) {
        it(`${row.id}/${moment}: "${region}" has a mount point and is never hidden`, () => {
          const placement = getPlacement(row, region, moment);
          expect(placement.visible).not.toBe(false);
          // R3: an announcing region must have a mount point — a grid
          // area, a layer, or a host (which must itself be placed —
          // pinned separately by the grid co-occupancy guard below).
          expect(
            placement.area !== null || placement.layer === true || placement.host != null,
          ).toBe(true);
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

describe('TAV-PLAY-SHELL presets.ts — grid co-occupancy (CRITICAL-2): no undeclared area sharing', () => {
  // Kage-CR CRITICAL-2 (2026-09-30): `area` used to be overloaded — a
  // duplicate `area: 'x'` string across two regions was indistinguishable
  // from a typo, with nothing in the data marking it intentional. `host`
  // makes the third state explicit. Two invariants, written as
  // "everything except declared exemptions" rather than a list of known
  // violators, so a NEW accidental share reds the same way a known one
  // does:
  for (const row of LAYOUT_ROWS) {
    for (const moment of MOMENTS) {
      it(`${row.id}/${moment}: every host names a region that is itself placed and VISIBLE this row × moment (🟡-2)`, () => {
        for (const id of REGION_IDS) {
          const placement = getPlacement(row, id, moment);
          if (placement.host == null) continue;
          expect(REGION_IDS).toContain(placement.host);
          const hostPlacement = getPlacement(row, placement.host, moment);
          expect(hostPlacement.area).not.toBeNull();
          // Kage-CR 🟡-2 (2026-09-30 fix round, carried to A9b): the old
          // guard only checked the host's `area`, not its `visible` — a
          // host that is placed but `visible:false` still "has a mount
          // point" by the old check, yet the hosted announcer silently
          // stops announcing inside a display:none band. R3's own text:
          // "this already happened once (X-card, Iro CRITICAL-1)" — this
          // is that failure one field deeper. Control N2: `table.topBar.
          // host='offers'` + `table.offers.default.visible=false` must go
          // red here.
          expect(hostPlacement.visible).not.toBe(false);
        }
      });

      it(`${row.id}/${moment}: no two regions share a non-null area unless one declares the other as host`, () => {
        const violations: string[] = [];
        for (const idA of REGION_IDS) {
          const pA = getPlacement(row, idA, moment);
          if (pA.area == null) continue;
          for (const idB of REGION_IDS) {
            if (idB === idA) continue;
            const pB = getPlacement(row, idB, moment);
            if (pB.area !== pA.area) continue;
            if (pA.host === idB || pB.host === idA) continue; // declared
            violations.push(`"${pA.area}": ${idA} <-> ${idB}`);
          }
        }
        expect(violations).toEqual([]);
      });
    }
  }
});

/**
 * Kage-CR IMPORTANT-3 (2026-09-30): none of the checks above pin row
 * CONTENT — a region↔area swap satisfies every structural check (both
 * tokens still exist, both directions of (e) still hold) and stays
 * invisible. This is the full literal pin: every RegionId's resolved
 * value in every row × moment, compared with `toEqual` against a
 * hand-written object (not derived from the data being tested). A value
 * is the area string, `host:<id>` for a declared co-occupancy
 * (CRITICAL-2), or `null` for a layer/no-placement. A swap, a drop, or an
 * accidental addition all go red in the same assertion.
 */
/**
 * Kage-CR 🟡-4 (2026-09-30 fix round, carried to A9b): folds density/host/
 * layer/visible/collapsible into ONE composite string per placement, in a
 * fixed field order, instead of `pinnedValue`'s old area-or-host-or-null.
 * A DROPPED field (not just a wrong one) now changes the string, so the
 * full row pin below reds on it too — this is what N4 needs, since the
 * per-region density loop further down only ever checks a value that is
 * PRESENT (an absent one is always legal there by construction).
 */
function pinnedValue(p: Placement): string {
  const parts: string[] = [p.area != null ? p.area : p.host != null ? `host:${p.host}` : 'null'];
  if (p.density !== undefined) parts.push(`density:${p.density}`);
  if (p.visible !== undefined) parts.push(`visible:${p.visible}`);
  if (p.layer !== undefined) parts.push(`layer:${p.layer}`);
  if (p.collapsible !== undefined) parts.push(`collapsible:${p.collapsible}`);
  return parts.join(' ');
}

/**
 * Kage-CR 🟡-4 (2026-09-30 fix round): regions allowed to carry a density
 * value with NO entry in `REGION_DENSITIES` yet, and the exact value(s)
 * tolerated for each — an EXPLICIT allowlist, never a silent
 * `if (!allowed) return`, so a future un-exempted region's dropped-union-
 * entry still reds. Today this is exactly one region: `suzuPresence`
 * (Kage-CR 🟡-5/IMPORTANT-5's own open finding — `phone.suzuPresence.
 * density` is already `'compact'` in real data, on an axis the plan's own
 * §2.3 calls wrong, "its real prop is `size`, not `density`"). This C0
 * guard-fix lands ahead of Amendment B (A9b's C1), which is where 🟡-5
 * actually gets resolved by declaring `suzuPresence: ['compact','full']` in
 * `REGION_DENSITIES` — at which point this exemption's only member is gone
 * and should be deleted along with it, not left as a dead `Record`.
 */
const DENSITY_GUARD_EXEMPTIONS: Partial<Record<RegionId, readonly string[]>> = {
  suzuPresence: ['compact'],
};

describe('TAV-PLAY-SHELL presets.ts — density values are declared, as an invariant over EVERY region (🟡-4, inverts IMPORTANT-6)', () => {
  it('REGION_DENSITIES is non-empty and every key is a real RegionId', () => {
    const keys = Object.keys(REGION_DENSITIES) as (keyof typeof REGION_DENSITIES)[];
    expect(keys.length).toBeGreaterThan(0);
    for (const id of keys) expect(REGION_IDS).toContain(id);
  });

  // Kage-CR 🟡-4: the old loop iterated `Object.keys(REGION_DENSITIES)` —
  // the known-good list — so a region with NO entry there (and no
  // exemption) could carry ANY density value, including a typo'd one, and
  // nothing would ever check it (N7). Iterating every REGION_IDS member
  // instead makes "undeclared region, present value" a checked state
  // rather than an unreachable one.
  for (const row of LAYOUT_ROWS) {
    for (const region of REGION_IDS) {
      for (const moment of MOMENTS) {
        it(`${row.id}/${moment}: "${region}"'s density, if present, is from a declared region (or a named exemption) with a declared value`, () => {
          const density = getPlacement(row, region, moment).density;
          if (density === undefined) return; // a region needn't emit one
          const allowed: readonly string[] | undefined =
            (REGION_DENSITIES as Partial<Record<RegionId, readonly string[]>>)[region] ??
            DENSITY_GUARD_EXEMPTIONS[region];
          expect(allowed).toBeDefined();
          expect(allowed).toContain(density);
        });
      }
    }
  }
});

describe('TAV-PLAY-SHELL presets.ts — full row pin (IMPORTANT-3, 🟡-4 composite): every RegionId is where it should be, with every other field intact', () => {
  function pin(row: LayoutRow, moment: Moment): Record<string, string> {
    const out: Record<string, string> = {};
    for (const id of REGION_IDS) out[id] = pinnedValue(getPlacement(row, id, moment));
    return out;
  }

  it('story/exploring', () => {
    expect(pin(LAYOUT_ROWS_BY_ID.story, 'exploring')).toEqual({
      topBar: 'topBar',
      partyStrip: 'partyStrip density:strip',
      sceneStage: 'sceneStage density:panel',
      suzuPresence: 'suzuPresence',
      storyLog: 'storyLog',
      offers: 'offers density:chips',
      characterBlock: 'null density:compact layer:true',
      actionBar: 'actionBar density:vitals',
      composer: 'composer',
      tableControls: 'null layer:true',
      safetyBanner: 'safetyBanner',
    });
  });

  it('story/combat', () => {
    expect(pin(LAYOUT_ROWS_BY_ID.story, 'combat')).toEqual({
      topBar: 'topBar',
      partyStrip: 'partyStrip density:rail',
      sceneStage: 'sceneStage density:hero',
      suzuPresence: 'suzuPresence',
      storyLog: 'storyLog',
      offers: 'null visible:false',
      characterBlock: 'null density:compact layer:true',
      actionBar: 'actionBar density:chips',
      composer: 'composer',
      tableControls: 'null layer:true',
      safetyBanner: 'safetyBanner',
    });
  });

  it('table/exploring', () => {
    expect(pin(LAYOUT_ROWS_BY_ID.table, 'exploring')).toEqual({
      topBar: 'host:sceneStage',
      partyStrip: 'partyStrip density:rail',
      sceneStage: 'sceneStage density:hero',
      suzuPresence: 'suzuPresence',
      storyLog: 'storyLog',
      offers: 'offers density:list',
      characterBlock: 'characterBlock density:full collapsible:true',
      actionBar: 'actionBar',
      composer: 'composer',
      tableControls: 'null layer:true',
      safetyBanner: 'safetyBanner',
    });
  });

  it('table/combat', () => {
    expect(pin(LAYOUT_ROWS_BY_ID.table, 'combat')).toEqual({
      topBar: 'host:sceneStage',
      partyStrip: 'partyStrip density:rail',
      sceneStage: 'sceneStage density:hero',
      suzuPresence: 'suzuPresence',
      storyLog: 'storyLog',
      offers: 'null visible:false',
      characterBlock: 'characterBlock density:full collapsible:true',
      actionBar: 'actionBar',
      composer: 'composer',
      tableControls: 'null layer:true',
      safetyBanner: 'safetyBanner',
    });
  });

  it('phone/exploring', () => {
    expect(pin(LAYOUT_ROWS_BY_ID.phone, 'exploring')).toEqual({
      topBar: 'topBar',
      partyStrip: 'host:topBar density:strip',
      sceneStage: 'sceneStage density:inline collapsible:true',
      suzuPresence: 'host:topBar density:compact',
      storyLog: 'storyLog',
      offers: 'offers density:chips',
      characterBlock: 'null density:compact layer:true',
      actionBar: 'actionBar',
      composer: 'composer',
      tableControls: 'null layer:true',
      safetyBanner: 'safetyBanner',
    });
  });

  it('phone/combat', () => {
    expect(pin(LAYOUT_ROWS_BY_ID.phone, 'combat')).toEqual({
      topBar: 'topBar',
      partyStrip: 'host:topBar density:strip',
      sceneStage: 'sceneStage density:panel collapsible:true',
      suzuPresence: 'host:topBar density:compact',
      storyLog: 'storyLog',
      offers: 'null visible:false',
      characterBlock: 'null density:compact layer:true',
      actionBar: 'actionBar',
      composer: 'composer',
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
      normalizeAreas(`"safetyBanner safetyBanner safetyBanner"
                "topBar       topBar       partyStrip"
                "suzuPresence storyLog     sceneStage"
                "suzuPresence offers       sceneStage"
                "suzuPresence composer     sceneStage"
                "suzuPresence actionBar    sceneStage"`),
    );
  });

  it('story/combat', () => {
    expect(normalizeAreas(LAYOUT_ROWS_BY_ID.story.areas.combat)).toBe(
      normalizeAreas(`"safetyBanner safetyBanner safetyBanner"
             "topBar       topBar       partyStrip"
             "suzuPresence sceneStage   partyStrip"
             "suzuPresence storyLog     partyStrip"
             "suzuPresence composer     partyStrip"
             "suzuPresence actionBar    partyStrip"`),
    );
  });

  it('table/exploring', () => {
    expect(normalizeAreas(LAYOUT_ROWS_BY_ID.table.areas.exploring)).toBe(
      normalizeAreas(`"safetyBanner safetyBanner safetyBanner safetyBanner"
                "partyStrip   sceneStage   sceneStage   characterBlock"
                "partyStrip   suzuPresence storyLog     characterBlock"
                "partyStrip   suzuPresence offers       characterBlock"
                "partyStrip   suzuPresence composer     characterBlock"
                "partyStrip   actionBar    actionBar    actionBar"`),
    );
  });

  it('table/combat', () => {
    expect(normalizeAreas(LAYOUT_ROWS_BY_ID.table.areas.combat)).toBe(
      normalizeAreas(`"safetyBanner safetyBanner safetyBanner safetyBanner"
             "partyStrip   sceneStage   sceneStage   characterBlock"
             "partyStrip   suzuPresence storyLog     characterBlock"
             "partyStrip   suzuPresence composer     characterBlock"
             "partyStrip   actionBar    actionBar    actionBar"`),
    );
  });

  it('phone/exploring', () => {
    expect(normalizeAreas(LAYOUT_ROWS_BY_ID.phone.areas.exploring)).toBe(
      normalizeAreas(`"safetyBanner"
                "topBar"
                "sceneStage"
                "storyLog"
                "offers"
                "composer"
                "actionBar"`),
    );
  });

  it('phone/combat', () => {
    expect(normalizeAreas(LAYOUT_ROWS_BY_ID.phone.areas.combat)).toBe(
      normalizeAreas(`"safetyBanner"
             "topBar"
             "sceneStage"
             "storyLog"
             "composer"
             "actionBar"`),
    );
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

/** Whitespace-token count of a `grid-template-columns` value. Safe for this
 *  file's declared tracks today: none contains a space (`minmax(0,1fr)`
 *  tokenises as one), per Kage-CR S1's own note. */
function columnsTokenCount(columnsValue: string): number {
  return columnsValue.trim().split(/\s+/).length;
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

describe('TAV-PLAY-SHELL presets.ts — layer/host and area are mutually exclusive (S2, 🟡-1)', () => {
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
        it(`${row.id}/${moment}: "${region}" is never both layer:true and grid-placed, and never both host-set and grid-placed`, () => {
          const placement = getPlacement(row, region, moment);
          if (placement.layer === true) expect(placement.area).toBeNull();
          if (placement.host != null) expect(placement.area).toBeNull();
        });
      }
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
      label: 'probe',
      columns: { exploring: '1fr', combat: '1fr' },
      areas: { exploring: '"x"', combat: '"x"' },
      regions: Object.fromEntries(
        REGION_IDS.map((id) => [
          id,
          id === 'sceneStage'
            ? {
                default: { area: 'x', collapsible: true, density: 'panel' },
                // Deliberately omits `collapsible`/`density`.
                combat: { area: 'x' },
              }
            : { default: { area: null } },
        ]),
      ) as LayoutRow['regions'],
    };
    const resolved = getPlacement(probeRow, 'sceneStage', 'combat');
    expect(resolved.collapsible).toBeUndefined();
    expect(resolved.density).toBeUndefined();
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
 * IMPORTANT-6's density-declaration guard, sanity check (not one of
 * Kage-CR's named mutations, but the same discipline):
 *
 *  Typo control — changed `story.regions.offers.default.density` from
 *      `'chips'` to `'chipss'`. Reddened exactly 1 case (`story/
 *      exploring: "offers"'s density is undefined or a declared
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

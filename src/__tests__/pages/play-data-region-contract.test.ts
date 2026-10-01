/**
 * Pins the `data-region` contract every TAV-PLAY-SHELL region carries on
 * its root DOM node (decomposition plan §2.3: "data-region=<id> on every
 * root node — the render-matrix test reads it", step 6). Before this file,
 * NOTHING pinned it: Kage-CR/Miko-QA (2026-09-21 review round) deleted
 * `data-region="safetyBanner"` and the full suite (61/61 files, 492/492
 * tests at the time) stayed green.
 *
 * Source-text scan (same family as escapeConsume.source-scan.test.ts and
 * the *-css.test.ts files), not RTL mounting: every region file's raw text
 * is checked for its expected literal `data-region="..."` string(s). This
 * also pins the I4 fix (2026-09-21 review round): TopBar and TableControls
 * used to each put the SAME value on TWO independently-gated DOM nodes,
 * which would make a naive id-Set-based render-matrix guard (step 6)
 * blind to "one of the two vanished" — each independently-gated node now
 * has its own distinct value; only genuinely MUTUALLY EXCLUSIVE branches
 * (TopBar's NarratorStrip-vs-aiOffStatus ternary — never both mounted at
 * once) are allowed to share one.
 *
 * A8 fix round, Kage-CR IMPORTANT-2 (2026-09-28): before this change, the
 * presence checks below were a hand-written per-region `it()` allowlist
 * that never covered `ActionBar.tsx` at all — deleting or misspelling
 * `data-region="actionBar"` survived the entire suite, only a COLLISION
 * with another region's id ever went red. Replaced with one loop over
 * `readdirSync(REGIONS_DIR)` driven by a single `Record<file, Set<id>>`
 * row map (`REGION_ROWS` below): a new region file is onboarded by adding
 * one row, not writing a new `it()` block, and the loop itself checks that
 * every `.tsx` file under `regions/` actually HAS a row (so a new region
 * can't silently ship with zero coverage the way ActionBar did at step 8).
 * The I4-specific regression pins (exact occurrence counts, the retired
 * shared value) are kept as their own dedicated assertions below the loop
 * — a different, narrower concern (a past defect's exact shape) than the
 * generic "does this id exist at all" contract the loop enforces.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  LAYOUT_ROWS,
  REGION_TENANTS,
  TENANT_IDS,
  getPlacement,
  type Moment,
} from '../../app/play/[sessionId]/presets';

/** Strips /* ...  *\/ block comments (JSDoc and {/* JSX *\/} alike) so a
 *  history-explaining comment mentioning an OLD or CURRENT value (this
 *  file's own I4 doc comments quote both, for context) can never satisfy —
 *  or accidentally double-count against — an assertion about real code. */
function stripBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Reads a region file's source with block comments stripped — every
 *  assertion below cares about actual CODE, never documentation prose. */
function readRegion(relPath: string): string {
  return stripBlockComments(fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8'));
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const REGIONS_DIR = 'src/app/play/[sessionId]/regions';

/**
 * The row map (Kage-CR IMPORTANT-2's durable fix): every region `.tsx`
 * file, mapped to the `data-region` id(s) its root node(s) must carry. A
 * new region at a future step is onboarded here — one row — and the loop
 * below picks it up automatically; it also fails loudly if a region file
 * exists with NO row (so a new region can't ship uncovered) or a row
 * points at a file that no longer exists (a stale row surviving a
 * rename/delete).
 */
const REGION_ROWS: Record<string, Set<string>> = {
  'SafetyBanner.tsx': new Set(['safetyBanner']),
  'PartyStrip.tsx': new Set(['partyStrip']),
  'SceneStage.tsx': new Set(['sceneStage']),
  'Offers.tsx': new Set(['offers']),
  'StoryLog.tsx': new Set(['storyLog']),
  'TableControls.tsx': new Set(['tableControlsSession', 'tableControlsDm']),
  'TopBar.tsx': new Set(['topBarSession', 'topBarStatus']),
  'ActionBar.tsx': new Set(['actionBar']),
};

describe('TAV-PLAY-SHELL data-region contract', () => {
  describe('REGION_ROWS loop — every region file carries every id its row declares', () => {
    const files = fs
      .readdirSync(path.resolve(process.cwd(), REGIONS_DIR))
      .filter((f) => f.endsWith('.tsx'));

    it('every .tsx file under regions/ has a row in REGION_ROWS (a new region ships covered, not silently unchecked)', () => {
      const uncovered = files.filter((f) => !(f in REGION_ROWS));
      expect(uncovered).toEqual([]);
    });

    it('every row in REGION_ROWS still points at a real file (no stale row surviving a rename/delete)', () => {
      const stale = Object.keys(REGION_ROWS).filter((f) => !files.includes(f));
      expect(stale).toEqual([]);
    });

    for (const [file, ids] of Object.entries(REGION_ROWS)) {
      for (const id of ids) {
        it(`${file} carries data-region="${id}"`, () => {
          const src = readRegion(`${REGIONS_DIR}/${file}`);
          expect(countOccurrences(src, `data-region="${id}"`)).toBeGreaterThanOrEqual(1);
        });
      }
    }
  });

  it('StoryLog passes data-region="storyLog" through to ChatLog\'s actual root (no wrapping element)', () => {
    // The row loop above already pins presence; this pins the specific
    // PASSTHROUGH mechanism (ChatLog must accept and apply the prop),
    // which is a structural concern the generic loop doesn't reach.
    const chatLogSrc = readRegion('src/components/ChatLog.tsx');
    expect(chatLogSrc).toMatch(/'data-region'\?\s*:\s*string/);
    expect(chatLogSrc).toMatch(/data-region=\{dataRegion\}/);
  });

  describe('I4 — TableControls: two INDEPENDENTLY gated nodes get DISTINCT ids (historical regression pin, exact shape of the defect the review found)', () => {
    const src = readRegion(`${REGIONS_DIR}/TableControls.tsx`);

    it('SessionControls carries data-region="tableControlsSession" exactly once', () => {
      expect(countOccurrences(src, 'data-region="tableControlsSession"')).toBe(1);
    });

    it('DmCombatControls carries data-region="tableControlsDm" exactly once', () => {
      expect(countOccurrences(src, 'data-region="tableControlsDm"')).toBe(1);
    });

    it('the old shared value no longer appears anywhere in the file (exact match — "tableControls" is also a substring of the two new values, so a plain .toContain would false-fail)', () => {
      expect(src).not.toMatch(/data-region="tableControls"/);
    });
  });

  describe('I4 — TopBar: the NarratorStrip/aiOffStatus ternary shares one id on purpose (historical regression pin, exact shape of the defect the review found)', () => {
    const src = readRegion(`${REGIONS_DIR}/TopBar.tsx`);

    it('the NarratorStrip call and the aiOffStatus fallback both carry data-region="topBarStatus" (mutually exclusive branches of one ternary — exactly 2 occurrences, not 1)', () => {
      expect(countOccurrences(src, 'data-region="topBarStatus"')).toBe(2);
    });

    it('NarratorStrip itself accepts the passthrough (I4)', () => {
      const narratorSrc = readRegion('src/components/NarratorStrip.tsx');
      expect(narratorSrc).toMatch(/'data-region'\?\s*:\s*string/);
      expect(narratorSrc).toMatch(/data-region=\{dataRegion\}/);
    });
  });

  it('every distinct data-region value used across all regions is unique to its own concern (no accidental collision between UNRELATED regions)', () => {
    const files = fs.readdirSync(path.resolve(process.cwd(), REGIONS_DIR)).filter((f) => f.endsWith('.tsx'));
    const valuesByFile = new Map<string, Set<string>>();
    for (const f of files) {
      const src = readRegion(`${REGIONS_DIR}/${f}`);
      const values = new Set<string>();
      for (const m of src.matchAll(/data-region="([^"]+)"/g)) values.add(m[1]);
      if (values.size) valuesByFile.set(f, values);
    }
    const owner = new Map<string, string>();
    for (const [file, values] of valuesByFile) {
      for (const v of values) {
        const existing = owner.get(v);
        // A value may repeat WITHIN its own file (mutually exclusive
        // branches, e.g. topBarStatus) but must never appear in a
        // DIFFERENT file.
        expect(existing === undefined || existing === file).toBe(true);
        owner.set(v, file);
      }
    }
  });
});

/**
 * TAV-PLAY-SHELL step 6b, commit C2 (Amendment B.4, answers S6) — the
 * `data-tenant` contract, same shape as `REGION_ROWS`'s loop above: a
 * tenant file is onboarded by adding one row, and the loop fails loudly if
 * a `tenants/*.tsx` file has no row (ships uncovered) or a row points at a
 * file that no longer exists (stale, surviving a rename/delete).
 */
const TENANTS_DIR = 'src/app/play/[sessionId]/tenants';

const TENANT_ROWS: Record<string, Set<string>> = {
  'StatusAnnouncers.tsx': new Set([
    'sessionRecap',
    'sessionPausedEnded',
    'turnStatus',
    'deadStatus',
    'durableRetryRow',
  ]),
  'CastSpellTenant.tsx': new Set(['castSpellPanel']),
};

describe('TAV-PLAY-SHELL data-tenant contract (Amendment B.4)', () => {
  describe('TENANT_ROWS loop — every tenant file carries every id its row declares', () => {
    const files = fs
      .readdirSync(path.resolve(process.cwd(), TENANTS_DIR))
      .filter((f) => f.endsWith('.tsx'));

    it('every .tsx file under tenants/ has a row in TENANT_ROWS (a new tenant ships covered, not silently unchecked)', () => {
      const uncovered = files.filter((f) => !(f in TENANT_ROWS));
      expect(uncovered).toEqual([]);
    });

    it('every row in TENANT_ROWS still points at a real file (no stale row surviving a rename/delete)', () => {
      const stale = Object.keys(TENANT_ROWS).filter((f) => !files.includes(f));
      expect(stale).toEqual([]);
    });

    for (const [file, ids] of Object.entries(TENANT_ROWS)) {
      for (const id of ids) {
        it(`${file} carries data-tenant="${id}"`, () => {
          const src = readRegion(`${TENANTS_DIR}/${file}`);
          expect(countOccurrences(src, `data-tenant="${id}"`)).toBeGreaterThanOrEqual(1);
        });
      }
    }
  });

  // Three tenants (nextPartOffer, diceTray, safetyControls) carry
  // data-tenant IN PLACE — no dedicated tenants/*.tsx file, per the build
  // brief's §3 table ("the small ones... get the attribute in place, no
  // move"). TENANT_ROWS only tracks files; these three are named here
  // explicitly so the drift check below covers the FULL TENANT_IDS set.
  const IN_PLACE_TENANT_IDS = ['nextPartOffer', 'diceTray', 'safetyControls'];

  it('TENANT_IDS (presets.ts) and TENANT_ROWS + IN_PLACE_TENANT_IDS (this file) declare the identical set of ids — a drift either way is caught', () => {
    const fromRows = new Set([
      ...Object.values(TENANT_ROWS).flatMap((s) => [...s]),
      ...IN_PLACE_TENANT_IDS,
    ]);
    expect([...fromRows].sort()).toEqual([...TENANT_IDS].sort());
  });

  it('nextPartOffer/diceTray/safetyControls carry data-tenant in place (no dedicated tenant file — attribute only, per build brief §3)', () => {
    const pageSrc = readRegion('src/app/play/[sessionId]/page.tsx');
    for (const id of IN_PLACE_TENANT_IDS) {
      expect(countOccurrences(pageSrc, `data-tenant="${id}"`)).toBeGreaterThanOrEqual(1);
    }
  });
});

const MOMENTS: readonly Moment[] = ['exploring', 'combat'];

/** Resolves whether `regionId` has a mount point (non-null `area`, directly
 *  or via a `host` chain) for `row`/`moment` — mirrors
 *  `play-preset-registry.test.ts`'s own co-occupancy guard, generalised to
 *  follow a chain rather than assuming one hop. */
function hasGridMountPoint(row: (typeof LAYOUT_ROWS)[number], regionId: string, moment: Moment): boolean {
  const seen = new Set<string>();
  let current = regionId;
  while (!seen.has(current)) {
    seen.add(current);
    const placement = getPlacement(row, current as Parameters<typeof getPlacement>[1], moment);
    if (placement.area != null) return true;
    if (placement.host == null) return false;
    current = placement.host;
  }
  return false; // cycle — never legal, never reached by real data
}

describe('TAV-PLAY-SHELL tenant guards (Amendment B.4, R3 extended)', () => {
  for (const [tenantId, { host }] of Object.entries(REGION_TENANTS)) {
    for (const row of LAYOUT_ROWS) {
      for (const moment of MOMENTS) {
        it(`${tenantId}/${row.id}/${moment}: host "${host}" resolves to a mount point`, () => {
          // Control: point a tenant at `offers` (area:null during combat,
          // no host of its own) → red.
          expect(hasGridMountPoint(row, host, moment)).toBe(true);
        });
      }
    }
  }

  // R3's own text: "a live region moves into a hideable band and silently
  // stops announcing — this already happened once (X-card, Iro
  // CRITICAL-1)." Caught here one field deeper than presets.ts's own
  // `host` guard (C0 🟡-2): an ANNOUNCING TENANT's host must never be
  // `visible:false` or `layer:true` in any row × moment, not merely
  // "placed".
  for (const [tenantId, { host, announces }] of Object.entries(REGION_TENANTS)) {
    if (!announces) continue;
    for (const row of LAYOUT_ROWS) {
      for (const moment of MOMENTS) {
        it(`${tenantId}/${row.id}/${moment}: announces:true, so host "${host}" is never visible:false and never layer:true`, () => {
          // Control: REGION_TENANTS[tenantId].host -> 'offers' → red
          // (offers.combat.visible === false in every row).
          const hostPlacement = getPlacement(row, host, moment);
          expect(hostPlacement.visible).not.toBe(false);
          expect(hostPlacement.layer).not.toBe(true);
        });
      }
    }
  }
});

/**
 * TAV-PLAY-SHELL step 6b, commit C2 (Amendment B.4) — the totality scan
 * that closes S6 permanently. page.tsx, after this commit, delegates every
 * live-region node to a declared region (`regions/*.tsx`) or tenant
 * (`tenants/*.tsx`) file — both families are already forced to carry a row
 * by the completeness loops above, so a NEW announcer added to either
 * family ships covered automatically. The one file NOT covered by either
 * loop is page.tsx itself: this asserts it carries zero raw
 * `aria-live`/`role="status"`/`role="alert"` text, so a future announcer
 * added directly there (rather than in the region/tenant it belongs to)
 * fails this test instead of shipping silently undeclared. Controls: add a
 * bare `<div aria-live="polite">` to page.tsx → red; add one to a declared
 * tenant file (e.g. StatusAnnouncers.tsx) → green (that file is already
 * required to carry a TENANT_ROWS entry, and this check doesn't scan it).
 */
describe('TAV-PLAY-SHELL announcer totality (Amendment B.4, closes S6 permanently)', () => {
  it('page.tsx itself carries zero raw aria-live/role="status"/role="alert" nodes — every announcer lives in a declared region or tenant file', () => {
    // readRegion only strips /* */ block comments — this check also needs
    // // line comments stripped (several `aria-live`/`role` mentions in
    // this file are explanatory `//` prose, not real JSX) so a comment
    // mentioning the OLD inline shape can never satisfy a real violation.
    const src = readRegion('src/app/play/[sessionId]/page.tsx').replace(/\/\/.*$/gm, '');
    const found: string[] = [];
    for (const re of [/aria-live=/g, /role="status"/g, /role="alert"/g]) {
      const matches = src.match(re);
      if (matches) found.push(`${re}: ${matches.length}`);
    }
    expect(found).toEqual([]);
  });
});

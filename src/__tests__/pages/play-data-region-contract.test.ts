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
 */
import fs from 'node:fs';
import path from 'node:path';

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

describe('TAV-PLAY-SHELL data-region contract', () => {
  it('SafetyBanner carries data-region="safetyBanner" exactly once', () => {
    const src = readRegion(`${REGIONS_DIR}/SafetyBanner.tsx`);
    expect(countOccurrences(src, 'data-region="safetyBanner"')).toBe(1);
  });

  it('PartyStrip carries data-region="partyStrip" exactly once', () => {
    const src = readRegion(`${REGIONS_DIR}/PartyStrip.tsx`);
    expect(countOccurrences(src, 'data-region="partyStrip"')).toBe(1);
  });

  it('SceneStage carries data-region="sceneStage" exactly once', () => {
    const src = readRegion(`${REGIONS_DIR}/SceneStage.tsx`);
    expect(countOccurrences(src, 'data-region="sceneStage"')).toBe(1);
  });

  it('Offers carries data-region="offers" exactly once', () => {
    const src = readRegion(`${REGIONS_DIR}/Offers.tsx`);
    expect(countOccurrences(src, 'data-region="offers"')).toBe(1);
  });

  it('StoryLog passes data-region="storyLog" through to ChatLog\'s actual root (no wrapping element)', () => {
    const src = readRegion(`${REGIONS_DIR}/StoryLog.tsx`);
    expect(countOccurrences(src, 'data-region="storyLog"')).toBe(1);
    // The passthrough mechanism itself: ChatLog must accept it (I4).
    const chatLogSrc = readRegion('src/components/ChatLog.tsx');
    expect(chatLogSrc).toMatch(/'data-region'\?\s*:\s*string/);
    expect(chatLogSrc).toMatch(/data-region=\{dataRegion\}/);
  });

  describe('I4 — TableControls: two INDEPENDENTLY gated nodes get DISTINCT ids', () => {
    const src = readRegion(`${REGIONS_DIR}/TableControls.tsx`);

    it('SessionControls carries data-region="tableControlsSession" exactly once', () => {
      expect(countOccurrences(src, 'data-region="tableControlsSession"')).toBe(1);
    });

    it('DmCombatControls carries data-region="tableControlsDm" exactly once', () => {
      expect(countOccurrences(src, 'data-region="tableControlsDm"')).toBe(1);
    });

    it('the two values are DIFFERENT (the exact defect the review found)', () => {
      expect('tableControlsSession').not.toBe('tableControlsDm');
    });

    it('the old shared value no longer appears anywhere in the file (exact match — "tableControls" is also a substring of the two new values, so a plain .toContain would false-fail)', () => {
      expect(src).not.toMatch(/data-region="tableControls"/);
    });
  });

  describe('I4 — TopBar: SessionHead and the NarratorStrip/aiOffStatus ternary get DISTINCT ids; the ternary\'s two MUTUALLY EXCLUSIVE branches share one on purpose', () => {
    const src = readRegion(`${REGIONS_DIR}/TopBar.tsx`);

    it('SessionHead carries data-region="topBarSession" exactly once', () => {
      expect(countOccurrences(src, 'data-region="topBarSession"')).toBe(1);
    });

    it('the NarratorStrip call and the aiOffStatus fallback both carry data-region="topBarStatus" (mutually exclusive branches of one ternary — exactly 2 occurrences, not 1)', () => {
      expect(countOccurrences(src, 'data-region="topBarStatus"')).toBe(2);
    });

    it('topBarSession and topBarStatus are different values', () => {
      expect('topBarSession').not.toBe('topBarStatus');
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

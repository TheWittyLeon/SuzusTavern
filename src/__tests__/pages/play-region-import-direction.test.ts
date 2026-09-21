/**
 * Kage-CR C2 (2026-09-21 review, blocking): Offers.tsx imported
 * `titleCaseSkill` from `'../page'` — a leaf region reaching up into the
 * route entry point, against the plan's §2.2 "dependencies flow downward
 * only; nothing reaches sideways". Fixed by moving the shared helper to
 * format.ts. This test is the mechanized guard so the same shape doesn't
 * reappear in step 5, which extracts ~9 hooks that will each want shared
 * helpers — repeating the `from '../page'` pattern would make page.tsx the
 * de-facto shared module regardless of the file layout (Option B wearing
 * Option A's clothes, per the plan's own §2.1 rejection of Option B).
 */
import fs from 'node:fs';
import path from 'node:path';

const REGIONS_DIR = path.resolve(process.cwd(), 'src/app/play/[sessionId]/regions');

describe('TAV-PLAY-SHELL region import direction — nothing under regions/ imports from page.tsx', () => {
  const files = fs.readdirSync(REGIONS_DIR).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));

  it('found at least one region file to check (guards the test itself against a silently-empty directory)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file}: does not import from '../page' or './page'`, () => {
      const src = fs.readFileSync(path.join(REGIONS_DIR, file), 'utf8');
      expect(src).not.toMatch(/from\s+['"]\.\.?\/page['"]/);
    });
  }
});

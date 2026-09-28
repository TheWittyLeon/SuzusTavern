#!/usr/bin/env node
/**
 * TAV-PLAY-SHELL-LINT-GATE-SHORT-CIRCUITS (Kage-CR, A3 review, 2026-09-28):
 * `npm run lint` used to be `eslint && lint:tokens && lint:layout-tokens &&
 * lint:page-ratchet`. `&&` short-circuits on the first non-zero exit, and
 * eslint has 3 pre-existing baseline errors (SpellbookPanel.tsx x2,
 * useClassFeatureDescriptions.ts x1, both react-hooks/set-state-in-effect,
 * neither in any /play file, tracked in the decomposition plan's own step-0
 * baseline) — so `lint:page-ratchet`, the one check this whole extraction
 * program is measured by, has never actually run under the aggregate gate.
 * Every agent in this loop has been running it separately.
 *
 * Run every check unconditionally and aggregate the exit code instead: a
 * pre-existing lint error is still visible (and still fails the gate), but
 * it can never again hide a ratchet regression behind it.
 */
import { spawnSync } from 'node:child_process';

const CHECKS = ['lint:eslint', 'lint:tokens', 'lint:layout-tokens', 'lint:page-ratchet'];

let failed = false;
for (const script of CHECKS) {
  console.log(`\n> npm run ${script}`);
  const result = spawnSync('npm', ['run', '--silent', script], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);

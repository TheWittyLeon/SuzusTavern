/**
 * paletteContrastParser.ts — D1b item A (2026-09-28 Kage-CR re-verify
 * fold-forward). Reads the REAL per-`data-vibe` custom-property blocks out
 * of `globals.css` text (not a live browser — jsdom still can't resolve
 * `color-mix()`/custom properties, see contrast.test.ts's header) so a
 * palette edit that breaks a contrast pair reds `contrast.test.ts` instead
 * of silently drifting from a hand-copied hex table.
 *
 * Only extracts the 9 tokens `contrast.test.ts` actually composites
 * (bg-3/on-fill/on-accent/bad/good/cool/cool-ink/warm/warm-ink) — this is a
 * test-support parser for this component's own contrast pins, not a
 * general CSS custom-property engine. Lives beside the component rather
 * than under `__tests__/` on purpose: `next/jest`'s default `testMatch`
 * treats every `.ts` file under any `__tests__/` directory as its own test
 * suite ("must contain at least one test"), so a pure-helper module placed
 * there fails collection outright — this file has no test of its own,
 * `contrast.test.ts` is its only consumer.
 */

export interface Palette {
  bg3: string;
  onFill: string;
  onAccent: string;
  bad: string;
  good: string;
  cool: string;
  coolInk: string;
  warm: string;
  warmInk: string;
}

const KNOWN_VIBES = ['dusk-tavern', 'candlelit', 'aetheric', 'moonlit-grove', 'hearthlight'] as const;

/** The design-tokens section ends where the shared (non-per-vibe) structural
 *  tokens begin — `globals.css` re-declares `[data-vibe="candlelit"]` a
 *  second time further down for an unrelated structural override, so
 *  parsing must stop at this marker or the second block's declarations
 *  would shadow the real palette values. */
const STRUCTURAL_TOKENS_MARKER = 'Shared structural tokens';

function stripBlockComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Extracts the `{ ... }` body of the FIRST `[data-vibe="<vibe>"]` selector
 *  block in `headCss` (flat custom-property declarations only — none of
 *  these blocks nest braces, so a non-greedy `[^}]*` is safe). */
function extractVibeBlock(headCss: string, vibe: string): string | null {
  const re = new RegExp(`\\[data-vibe=["']${vibe}["']\\]\\s*\\{([^}]*)\\}`);
  const m = re.exec(headCss);
  return m ? m[1] : null;
}

/** Parses `--token: value;` declarations out of a block body into a
 *  name -> raw-value map (comments already stripped by the caller). */
function parseDeclarations(block: string): Map<string, string> {
  const decls = new Map<string, string>();
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    decls.set(m[1], m[2].trim());
  }
  return decls;
}

/** Resolves a declaration's value, following `var(--x)` aliases within the
 *  SAME palette block (e.g. `--warm-ink: var(--warm);`, `--cool-ink:
 *  var(--cool);`) to their eventual literal (hex) value. Bounded recursion —
 *  no palette block in this file chains more than one alias deep, but a
 *  cycle or unresolved var must fail loudly (a broken pin, not a silent
 *  pass) rather than loop forever. */
function resolveValue(raw: string, decls: Map<string, string>, seen: Set<string> = new Set()): string {
  const varMatch = /^var\(--([a-zA-Z0-9-]+)\)$/.exec(raw);
  if (!varMatch) return raw;
  const target = varMatch[1];
  if (seen.has(target)) {
    throw new Error(`parseGlobalsPalette: circular var() alias resolving --${target}`);
  }
  const targetRaw = decls.get(target);
  if (targetRaw === undefined) {
    throw new Error(`parseGlobalsPalette: var(--${target}) has no declaration in this palette block`);
  }
  seen.add(target);
  return resolveValue(targetRaw, decls, seen);
}

function required(decls: Map<string, string>, name: string, vibe: string): string {
  const raw = decls.get(name);
  if (raw === undefined) {
    throw new Error(`parseGlobalsPalette: --${name} not found in [data-vibe="${vibe}"] block`);
  }
  return resolveValue(raw, decls);
}

/**
 * Parses every known `data-vibe` palette's contrast-relevant tokens out of
 * `globals.css` source text. Throws (a hard test failure, not a silent
 * empty result) if a known palette or required token goes missing — the
 * exact regression this replaces a hand-mirrored hex table to catch.
 */
export function parseGlobalsPalette(css: string): Record<string, Palette> {
  const markerIdx = css.indexOf(STRUCTURAL_TOKENS_MARKER);
  const head = markerIdx === -1 ? css : css.slice(0, markerIdx);
  const stripped = stripBlockComments(head);

  const out: Record<string, Palette> = {};
  for (const vibe of KNOWN_VIBES) {
    const block = extractVibeBlock(stripped, vibe);
    if (block === null) {
      throw new Error(`parseGlobalsPalette: [data-vibe="${vibe}"] block not found in globals.css`);
    }
    const decls = parseDeclarations(block);
    out[vibe] = {
      bg3: required(decls, 'bg-3', vibe),
      onFill: required(decls, 'on-fill', vibe),
      onAccent: required(decls, 'on-accent', vibe),
      bad: required(decls, 'bad', vibe),
      good: required(decls, 'good', vibe),
      cool: required(decls, 'cool', vibe),
      coolInk: required(decls, 'cool-ink', vibe),
      warm: required(decls, 'warm', vibe),
      warmInk: required(decls, 'warm-ink', vibe),
    };
  }
  return out;
}

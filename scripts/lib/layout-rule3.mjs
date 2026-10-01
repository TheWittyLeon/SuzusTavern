/**
 * Rule 3 of check-layout-tokens.mjs (decomposition plan Amendment C.6, A9c-2 D4):
 * a region never re-decides its own placement. Pure: `evaluateRule3` takes a
 * Map of repo-relative path -> source text, so the controls in
 * check-layout-tokens.test.ts mutate an in-memory copy and never write a
 * fixture into a directory other suites scan in parallel.
 *
 *   (i)   no selector in src/**\/*.css keys on data-layout / data-layout-resolved
 *         / data-moment (a region styling itself per preset is the fork, R16);
 *   (ii)  no `position: fixed` in CSS reachable from regions/ and tenants/;
 *   (iii) in Play.module.css, grid-template-* / grid-area / grid-row /
 *         grid-column appear only in `.grid`, and only as var(--play-*).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

export const PLAY_DIR = 'src/app/play/[sessionId]';
export const PLAY_CSS = `${PLAY_DIR}/Play.module.css`;
const ENTRY_DIRS = [`${PLAY_DIR}/regions/`, `${PLAY_DIR}/tenants/`];

/** How many @/components hops are followed from a region/tenant file. */
export const COMPONENT_HOPS = 2;

/** Declared layer hosts: they ARE the layer, `position: fixed` is their job. */
export const LAYER_HOSTS = Object.freeze([
  'src/components/Drawer.module.css',
  'src/components/ConfirmDialog.module.css',
  'src/components/Toast.module.css',
]);

/**
 * Modals that still render INSIDE a region's slot and are `position: fixed`.
 * A fourth is red. Each leaves the list by portaling to <body> and becoming a
 * layer host (the ConfirmDialog precedent, plan §6 "One Dialog").
 */
export const IN_REGION_MODALS = Object.freeze([
  // debt: RebindCharacterButton's modal renders inside the partyStrip slot, fixed. ceiling: this one file; a fourth in-region modal is red. until: it portals to document.body (plan §6, One Dialog), then it moves to LAYER_HOSTS.
  'src/components/RebindCharacterButton.module.css',
  // debt: DmOverrideModal's backdrop renders inside the DM panel in tableControls, fixed. ceiling: this one file. until: it portals to document.body (plan §6, One Dialog), then it moves to LAYER_HOSTS.
  'src/components/DmOverrideModal.module.css',
  // debt: DmNarrationPanel's phone NPC target menu is fixed inside the DM panel. ceiling: this one file, <=420px only. until: the DM panel's menus portal (plan §6, One Dialog), then it moves to LAYER_HOSTS.
  'src/components/DmNarrationPanel.module.css',
]);

/**
 * Anchored menus (Amendment C.7): `fixed`, placed from the trigger's rect, so
 * the slot's `overflow` cannot clip them. Allowed per SELECTOR, not per file,
 * so a second fixed rule in the same stylesheet is still red.
 */
export const ANCHORED_MENUS = Object.freeze([
  { css: 'src/components/Composer.module.css', selector: '.pop' }, // the Attack target menu
]);

/** The three stylesheets whose absence means the reach computation found nothing. */
export const VACUITY_SCOPE = Object.freeze([
  PLAY_CSS,
  'src/components/Composer.module.css',
  'src/components/PartyPanel.module.css',
]);

const stripCssComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** [{ selector, decls }] for every non-@ rule, however deeply @media-nested. */
export function cssRules(css) {
  const text = stripCssComments(css);
  const out = [];
  const stack = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') {
      stack.push({ prelude: buf.trim(), decls: '' });
      buf = '';
    } else if (ch === ';') {
      if (stack.length) stack[stack.length - 1].decls += `${buf};`;
      buf = '';
    } else if (ch === '}') {
      const top = stack.pop();
      if (top) {
        top.decls += buf;
        if (!top.prelude.startsWith('@')) out.push({ selector: top.prelude, decls: top.decls });
      }
      buf = '';
    } else buf += ch;
  }
  return out;
}

const declsOf = (decls) =>
  decls.split(';').map((d) => {
    const i = d.indexOf(':');
    return i < 0 ? null : { prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim() };
  }).filter(Boolean);

const IMPORT_RE = /^\s*import\s+(?!type\b)(?:[^'"]*?\sfrom\s*)?(['"])([^'"]+)\1/gm;

function resolveSpecifier(from, spec) {
  if (spec.startsWith('@/')) return join('src', spec.slice(2));
  if (spec.startsWith('.')) return normalize(join(dirname(from), spec));
  return null;
}

/** The set of stylesheets reachable from the region/tenant entry files. */
export function reachableCss(files) {
  const css = new Set();
  const seen = new Set();
  const visit = (file, hopsLeft) => {
    if (seen.has(file) || !files.has(file)) return;
    seen.add(file);
    for (const m of files.get(file).matchAll(IMPORT_RE)) {
      const target = resolveSpecifier(file, m[2]);
      if (!target) continue;
      if (/\.css$/.test(target)) { if (files.has(target)) css.add(target); continue; }
      if (hopsLeft > 0 && target.startsWith('src/components/')) {
        const tsx = [`${target}.tsx`, `${target}.ts`].find((p) => files.has(p));
        if (tsx) visit(tsx, hopsLeft - 1);
      }
    }
  };
  for (const f of files.keys()) {
    if (ENTRY_DIRS.some((d) => f.startsWith(d)) && /\.tsx?$/.test(f)) visit(f, COMPONENT_HOPS);
  }
  return css;
}

const LAYOUT_ATTR = /\[\s*data-(?:layout|layout-resolved|moment)\b/;
const GRID_PROP = /^grid-(?:template(?:-[a-z]+)?|area|row(?:-[a-z]+)?|column(?:-[a-z]+)?)$/;

/** @returns {{ violations: string[], scope: string[] }} */
export function evaluateRule3(files) {
  const violations = [];
  const cssFiles = [...files.keys()].filter((f) => f.startsWith('src/') && f.endsWith('.css'));

  // (i)
  for (const f of cssFiles) {
    for (const r of cssRules(files.get(f))) {
      if (LAYOUT_ATTR.test(r.selector)) violations.push(`${f}: (i) selector keys on a layout attribute: ${r.selector}`);
    }
  }

  // (ii)
  const scope = [...reachableCss(files)].sort();
  for (const need of VACUITY_SCOPE) {
    if (!scope.includes(need)) violations.push(`rule 3 scope is vacuous: ${need} is not reachable from regions/ + tenants/ (the reach computation found nothing to check)`);
  }
  const exempt = new Set([...LAYER_HOSTS, ...IN_REGION_MODALS]);
  const fixedIn = (f) => cssRules(files.get(f)).filter((r) => declsOf(r.decls).some((d) => d.prop === 'position' && /^fixed\b/i.test(d.value)));
  for (const f of scope) {
    for (const r of fixedIn(f)) {
      if (exempt.has(f)) continue;
      if (ANCHORED_MENUS.some((a) => a.css === f && a.selector === r.selector)) continue;
      violations.push(`${f}: (ii) position: fixed reachable from a region or tenant, in ${r.selector}. Portal it and make it a layer host, or it is a new IN_REGION_MODALS entry (a fourth is red)`);
    }
  }
  // An exemption that no longer matches anything is stale: delete it.
  for (const f of IN_REGION_MODALS) {
    if (!files.has(f) || !scope.includes(f) || fixedIn(f).length === 0) violations.push(`${f}: (ii) stale IN_REGION_MODALS entry (not reachable, or no longer position: fixed): delete it`);
  }
  for (const a of ANCHORED_MENUS) {
    if (!files.has(a.css) || !fixedIn(a.css).some((r) => r.selector === a.selector)) violations.push(`${a.css}: (ii) stale ANCHORED_MENUS entry ${a.selector}: delete it`);
  }

  // (iii)
  if (files.has(PLAY_CSS)) {
    for (const r of cssRules(files.get(PLAY_CSS))) {
      for (const d of declsOf(r.decls)) {
        if (!GRID_PROP.test(d.prop)) continue;
        if (r.selector !== '.grid') violations.push(`${PLAY_CSS}: (iii) ${d.prop} in ${r.selector}: placement belongs to the row, only \`.grid\` may carry it`);
        else if (!/^var\(\s*--play-[a-z-]+\s*\)$/.test(d.value)) violations.push(`${PLAY_CSS}: (iii) ${d.prop}: ${d.value} in .grid is not var(--play-*)`);
      }
    }
  } else violations.push(`${PLAY_CSS}: (iii) not found`);

  return { violations, scope };
}

/** Every stylesheet and .ts/.tsx under src/ (tests excluded), keyed by repo-relative path. */
export function readRule3Inputs(root) {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(abs);
      } else if (/\.(css|tsx?)$/.test(entry.name)) {
        files.set(relative(root, abs), readFileSync(abs, 'utf8'));
      }
    }
  };
  walk(join(root, 'src'));
  return files;
}

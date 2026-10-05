/**
 * Rule 3 of scripts/check-layout-tokens.mjs (A9c-2 D4, Guard 3, Amendment C.6):
 * a region never re-decides its own placement.
 *
 * The controls mutate an IN-MEMORY copy of the real inputs and call the same
 * `evaluateRule3` the lint script calls, so nothing is written under a
 * directory other suites scan in parallel (check-layout-tokens.test.ts's
 * on-disk fixtures are why this file exists separately).
 */
import {
  ANCHORED_MENUS,
  IN_REGION_MODALS,
  LAYER_HOSTS,
  PLAY_CSS,
  VACUITY_SCOPE,
  evaluateRule3,
  readRule3Inputs,
} from '../../../scripts/lib/layout-rule3.mjs';

const PLAY = 'src/app/play/[sessionId]';
const real = () => readRule3Inputs(process.cwd());
const mutate = (edit: (m: Map<string, string>) => void) => {
  const m = real();
  edit(m);
  return evaluateRule3(m).violations;
};
const append = (m: Map<string, string>, file: string, css: string) => {
  expect(m.has(file)).toBe(true); // fixture sanity: the target exists
  m.set(file, `${m.get(file)}\n${css}\n`);
};

describe('Rule 3: baseline', () => {
  it('is clean on the real repo, and its scope is not vacuous', () => {
    const { violations, scope } = evaluateRule3(real());
    expect(violations).toEqual([]);
    for (const need of VACUITY_SCOPE) expect(scope).toContain(need);
    expect(IN_REGION_MODALS).toHaveLength(2);
    expect(ANCHORED_MENUS).toHaveLength(1);
  });
});

describe('Rule 3 (i): no selector keys on a layout attribute', () => {
  it.each([
    ['data-layout', `[data-layout='story'] .x { color: red; }`],
    ['data-layout-resolved', `[data-layout-resolved="table"] .x { color: red; }`],
    ['data-moment', `.y[data-moment=combat] { color: red; }`],
    ['nested in @media', `@media (min-width: 900px) { :global([data-layout]) .x { color: red; } }`],
  ])('%s anywhere under src/ is red', (_n, css) => {
    const v = mutate((m) => append(m, 'src/components/ChatLog.module.css', css));
    expect(v.some((x) => /\(i\) selector keys on a layout attribute/.test(x))).toBe(true);
  });

  it('an attribute inside a declaration value or a comment is not a selector', () => {
    expect(mutate((m) => append(m, 'src/components/ChatLog.module.css', `/* [data-layout] */ .z { content: '[data-moment]'; }`))).toEqual([]);
  });
});

describe('Rule 3 (ii): no position: fixed reachable from regions/ and tenants/', () => {
  const red = (v: string[]) => v.some((x) => /\(ii\) position: fixed reachable/.test(x));

  it('a new fixed rule in a stylesheet a region imports directly is red', () => {
    expect(red(mutate((m) => append(m, PLAY_CSS, `.zzz { position: fixed; }`)))).toBe(true);
  });

  it('a new fixed rule one component hop away (PartyStrip -> PartyPanel) is red', () => {
    expect(red(mutate((m) => append(m, 'src/components/PartyPanel.module.css', `.zzz { position:fixed }`)))).toBe(true);
  });

  it('a fourth in-region modal is red (two hops: TableControls -> DmNarrationPanel; ConditionsPanel is not exempt. DmOverrideModal left the list: it is mounted above the shell, TPK-HOLD W3)', () => {
    expect(red(mutate((m) => append(m, 'src/components/ConditionsPanel.module.css', `.modal { position: fixed; inset: 0; }`)))).toBe(true);
  });

  it('a SECOND fixed rule in an anchored-menu stylesheet is red: the exemption is per selector, not per file', () => {
    expect(red(mutate((m) => append(m, 'src/components/Composer.module.css', `.other { position: fixed; }`)))).toBe(true);
  });

  it('a declared layer host may be fixed; a stylesheet the play page does not reach may be fixed', () => {
    expect(mutate((m) => append(m, 'src/components/Toast.module.css', `.extra { position: fixed; }`))).toEqual([]);
    expect(mutate((m) => append(m, 'src/components/TweaksPanel.module.css', `.extra { position: fixed; }`))).toEqual([]);
    // Codex is a different route: nothing under the play page imports it.
    expect(mutate((m) => append(m, 'src/app/codex/Codex.module.css', `.extra { position: fixed; }`))).toEqual([]);
  });

  // Kage A9c-2 IMPORTANT-3: page.tsx passes these straight into regions/tenants.
  // Before page.tsx joined the entry set none was reachable, so a planted fixed rule
  // in them was invisible.
  it.each([
    ['MemberSheetPanel', 'src/components/MemberSheetPanel.module.css'],
    ['DiceTray', 'src/components/DiceTray.module.css'],
    ['JournalPane (page-only import)', 'src/components/JournalPane.module.css'],
    // Kage A9d-1 I-4: PlayShell renders FoldDock in every collapsible slot and is not
    // imported by regions/ or tenants/; it is an entry of its own.
    ['FoldDock (reached only through PlayShell.tsx)', 'src/components/FoldDock.module.css'],
  ])('a planted position: fixed in %s (reached only through page.tsx) is red', (_n, css) => {
    expect(red(mutate((m) => append(m, css, `.zzz { position: fixed; inset: 0; }`)))).toBe(true);
  });

  it('is not vacuous for the shell entry: cutting PlayShell\'s FoldDock import is itself red', () => {
    const v = mutate((m) => {
      const f = `${PLAY}/PlayShell.tsx`;
      m.set(f, m.get(f)!.replace(/import FoldDock from '@\/components\/FoldDock';/, ''));
      // B8c-4 P0: the stage now imports FoldDock too (`FoldHandleSlot`, `useFoldBody`), so FoldDock's stylesheet is also reached through regions/. The control cuts that second route as well, so what it
      // proves is still that PlayShell's own import is what the scope walk needs when it is the only one.
      const g = `${PLAY}/regions/SceneStage.tsx`;
      m.set(g, m.get(g)!.replace(/import \{ FoldHandleSlot, useFoldBody \} from '@\/components\/FoldDock';/, ''));
    });
    expect(v.some((x) => /scope is vacuous: src\/components\/FoldDock\.module\.css/.test(x))).toBe(true);
  });

  it('TweaksPanel is a declared layer host: it is reached through page.tsx and its fixed rules are its job', () => {
    expect(LAYER_HOSTS).toContain('src/components/TweaksPanel.module.css');
    expect(evaluateRule3(real()).scope).toContain('src/components/TweaksPanel.module.css');
  });

  it('a component only the PAGE imports is reached to unbounded depth (four hops down is still red)', () => {
    const v = mutate((m) => {
      const f = `${PLAY}/page.tsx`;
      m.set(f, `import A from '@/components/ZzA';\n${m.get(f)}`);
      m.set('src/components/ZzA.tsx', `import B from '@/components/ZzB';\nexport default B;\n`);
      m.set('src/components/ZzB.tsx', `import C from '@/components/ZzC';\nexport default C;\n`);
      m.set('src/components/ZzC.tsx', `import D from '@/components/ZzD';\nexport default D;\n`);
      m.set('src/components/ZzD.tsx', `import s from './ZzD.module.css';\nexport default s;\n`);
      m.set('src/components/ZzD.module.css', `.root { position: fixed; }\n`);
    });
    expect(red(v)).toBe(true);
  });

  it('reach is computed from imports: a brand-new region importing a fixed component stylesheet is red', () => {
    const v = mutate((m) => {
      m.set(`${PLAY}/regions/ZzzNew.tsx`, `import Zzz from '@/components/Zzz';\nexport default Zzz;\n`);
      m.set('src/components/Zzz.tsx', `import s from './Zzz.module.css';\nexport default () => s;\n`);
      m.set('src/components/Zzz.module.css', `.root { position: fixed; }\n`);
    });
    expect(red(v)).toBe(true);
  });

  it('a type-only import brings no stylesheet', () => {
    const v = mutate((m) => {
      m.set(`${PLAY}/regions/ZzzNew.tsx`, `import type { T } from '@/components/Zzz';\nexport type U = T;\n`);
      m.set('src/components/Zzz.tsx', `import s from './Zzz.module.css';\nexport type T = typeof s;\n`);
      m.set('src/components/Zzz.module.css', `.root { position: fixed; }\n`);
    });
    expect(v).toEqual([]);
  });

  it('a region entry walks unbounded too: a fixed stylesheet FOUR component hops down is red (N2; the two-hop cap is deleted)', () => {
    const v = mutate((m) => {
      m.set(`${PLAY}/regions/ZzzNew.tsx`, `import A from '@/components/ZzA';\nexport default A;\n`);
      m.set('src/components/ZzA.tsx', `import B from '@/components/ZzB';\nexport default B;\n`);
      m.set('src/components/ZzB.tsx', `import C from '@/components/ZzC';\nexport default C;\n`);
      m.set('src/components/ZzC.tsx', `import D from '@/components/ZzD';\nexport default D;\n`);
      m.set('src/components/ZzD.tsx', `import s from './ZzD.module.css';\nexport default s;\n`);
      m.set('src/components/ZzD.module.css', `.root { position: fixed; }\n`);
    });
    expect(red(v)).toBe(true);
  });

  it('the Button control: a fixed stylesheet planted under Button (a leaf every region renders through) is red', () => {
    const v = mutate((m) => {
      expect(m.has('src/components/Button.tsx')).toBe(true); // fixture sanity
      m.set('src/components/Button.tsx', `import s from './Button.module.css';\n${m.get('src/components/Button.tsx')}\nvoid s;\n`);
      m.set('src/components/Button.module.css', `.zzFloat { position: fixed; }\n`);
    });
    expect(red(v)).toBe(true);
  });

  it('an exemption that matches nothing is stale and red (the modal portaled or was deleted)', () => {
    const v = mutate((m) => m.set('src/components/RebindCharacterButton.module.css', `.backdrop { position: absolute; }`));
    expect(v.some((x) => /stale IN_REGION_MODALS entry/.test(x))).toBe(true);
    const w = mutate((m) => m.set('src/components/Composer.module.css', m.get('src/components/Composer.module.css')!.replace(/position:\s*fixed/g, 'position: absolute')));
    expect(w.some((x) => /stale ANCHORED_MENUS entry/.test(x))).toBe(true);
  });

  it('is not vacuous for the page entry: cutting page.tsx\'s MemberSheetPanel import is itself red', () => {
    const v = mutate((m) => {
      const f = `${PLAY}/page.tsx`;
      m.set(f, m.get(f)!.replace(/import MemberSheetPanel, \{ MEMBER_SHEET_HEADING_ID \} from '@\/components\/MemberSheetPanel';/, ''));
    });
    expect(v.some((x) => /scope is vacuous: src\/components\/MemberSheetPanel\.module\.css/.test(x))).toBe(true);
  });

  it('is not vacuous: cutting the import that reaches PartyPanel.module.css is itself red', () => {
    const v = mutate((m) => {
      const f = `${PLAY}/regions/PartyStrip.tsx`;
      m.set(f, m.get(f)!.replace(/import PartyPanel from '@\/components\/PartyPanel';/, ''));
    });
    expect(v.some((x) => /scope is vacuous: src\/components\/PartyPanel\.module\.css/.test(x))).toBe(true);
  });
});

describe('Rule 3 (iii): Play.module.css places only in .grid, only as var(--play-*)', () => {
  const red = (v: string[]) => v.some((x) => /\(iii\)/.test(x));

  it.each([
    ['grid-template-columns in another rule', `.foo { grid-template-columns: 1fr 1fr; }`],
    ['even a var(--play-*) value outside .grid', `.foo { grid-column: var(--play-col); }`],
    ['grid-area in another rule', `.foo { grid-area: banner; }`],
    ['grid-row in another rule', `.foo { grid-row: 1 / 3; }`],
    ['grid-column in another rule', `.foo { grid-column: span 2; }`],
    ['inside an @media', `@media (max-width: 880px) { .foo { grid-template-areas: 'a'; } }`],
    ['a literal in .grid', `.grid { grid-template-rows: auto 1fr; }`],
  ])('%s is red', (_n, css) => {
    expect(red(mutate((m) => append(m, PLAY_CSS, css)))).toBe(true);
  });

  it('a component keeping its own internal grid is fine', () => {
    expect(mutate((m) => append(m, 'src/components/PartyPanel.module.css', `.inner { display: grid; grid-template-columns: 1fr 1fr; }`))).toEqual([]);
  });
});

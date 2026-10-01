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
  COMPONENT_HOPS,
  IN_REGION_MODALS,
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
    expect(IN_REGION_MODALS).toHaveLength(3);
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

  it('a fourth in-region modal is red (two hops: TableControls -> DmNarrationPanel -> DmOverrideModal is already exempt, ConditionsPanel is not)', () => {
    expect(red(mutate((m) => append(m, 'src/components/ConditionsPanel.module.css', `.modal { position: fixed; inset: 0; }`)))).toBe(true);
  });

  it('a SECOND fixed rule in an anchored-menu stylesheet is red: the exemption is per selector, not per file', () => {
    expect(red(mutate((m) => append(m, 'src/components/Composer.module.css', `.other { position: fixed; }`)))).toBe(true);
  });

  it('a declared layer host may be fixed; a stylesheet no region reaches may be fixed', () => {
    expect(mutate((m) => append(m, 'src/components/Toast.module.css', `.extra { position: fixed; }`))).toEqual([]);
    expect(mutate((m) => append(m, 'src/components/TweaksPanel.module.css', `.extra { position: fixed; }`))).toEqual([]);
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

  it(`the reach is ${COMPONENT_HOPS} component hops, pinned: a stylesheet a third hop away is out of scope`, () => {
    const v = mutate((m) => {
      m.set(`${PLAY}/regions/ZzzNew.tsx`, `import A from '@/components/ZzA';\nexport default A;\n`);
      m.set('src/components/ZzA.tsx', `import B from '@/components/ZzB';\nexport default B;\n`);
      m.set('src/components/ZzB.tsx', `import C from '@/components/ZzC';\nexport default C;\n`);
      m.set('src/components/ZzC.tsx', `import s from './ZzC.module.css';\nexport default s;\n`);
      m.set('src/components/ZzC.module.css', `.root { position: fixed; }\n`);
    });
    expect(v).toEqual([]);
  });

  it('an exemption that matches nothing is stale and red (the modal portaled or was deleted)', () => {
    const v = mutate((m) => m.set('src/components/DmOverrideModal.module.css', `.backdrop { position: absolute; }`));
    expect(v.some((x) => /stale IN_REGION_MODALS entry/.test(x))).toBe(true);
    const w = mutate((m) => m.set('src/components/Composer.module.css', m.get('src/components/Composer.module.css')!.replace(/position:\s*fixed/g, 'position: absolute')));
    expect(w.some((x) => /stale ANCHORED_MENUS entry/.test(x))).toBe(true);
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

/**
 * EnvBanner — MIKO ADVERSARIAL FINDING: this file had ZERO test coverage
 * before this addition (pre-existing gap, not introduced by TAV-21). TAV-21
 * (layout.tsx's `--env-banner-h` CSS var, consumed by Play.module.css's
 * `calc(100dvh - var(--env-banner-h, 0px))`) depends ENTIRELY on
 * `ENV_BANNER_VISIBLE`/`ENV_BANNER_HEIGHT_PX` being correct and staying in
 * sync with the component's own null-for-prod render branch and with
 * EnvBanner.module.css's `.banner { height }` — layout.tsx itself is an
 * async Server Component with no jsdom seam (correctly flagged by Ren for
 * browser-verify instead), so THIS is the only place those two exported
 * constants can be locked at all.
 *
 * Follows the established jest.resetModules() + process.env + require()
 * pattern from src/__tests__/lib/env.test.ts (this repo's own convention for
 * testing src/lib/env.ts's module-load-time env snapshot) rather than
 * introducing a new mocking style.
 */
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

export {}; // module scope — avoids a global-scope env-var collision with sibling test files

function setDeployEnv(value: string | undefined) {
  if (value === undefined) delete process.env.NEXT_PUBLIC_DEPLOY_ENV;
  else process.env.NEXT_PUBLIC_DEPLOY_ENV = value;
}

describe('EnvBanner + TAV-21 exported constants', () => {
  const original = process.env.NEXT_PUBLIC_DEPLOY_ENV;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    setDeployEnv(original);
  });

  it('DEPLOY_ENV=dev: ENV_BANNER_VISIBLE=true, ENV_BANNER_HEIGHT_PX=32, renders the dev banner', () => {
    setDeployEnv('dev');
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../components/EnvBanner');
    expect(mod.ENV_BANNER_VISIBLE).toBe(true);
    expect(mod.ENV_BANNER_HEIGHT_PX).toBe(32);

    const EnvBanner = mod.default;
    const { container } = render(<EnvBanner />);
    const el = container.querySelector('[data-env-banner]');
    expect(el).toHaveAttribute('data-env-banner', 'dev');
    expect(el).toHaveAttribute('role', 'status');
    expect(el?.textContent).toMatch(/DEV ENVIRONMENT/);
  });

  it('DEPLOY_ENV=local: ENV_BANNER_VISIBLE=true, renders the local banner', () => {
    setDeployEnv('local');
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../components/EnvBanner');
    expect(mod.ENV_BANNER_VISIBLE).toBe(true);

    const EnvBanner = mod.default;
    const { container } = render(<EnvBanner />);
    expect(container.querySelector('[data-env-banner]')).toHaveAttribute(
      'data-env-banner',
      'local',
    );
  });

  it('DEPLOY_ENV=prod: ENV_BANNER_VISIBLE=false, component renders null (nothing in the DOM)', () => {
    setDeployEnv('prod');
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../components/EnvBanner');
    expect(mod.ENV_BANNER_VISIBLE).toBe(false);

    const EnvBanner = mod.default;
    const { container } = render(<EnvBanner />);
    expect(container.querySelector('[data-env-banner]')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('DEPLOY_ENV unset/missing defaults to prod-safe (matches env.ts\'s own documented safe default) — no banner leaks by omission', () => {
    setDeployEnv(undefined);
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../components/EnvBanner');
    expect(mod.ENV_BANNER_VISIBLE).toBe(false);
  });

  // TAV-21's own header comment: "so the two can't drift silently" — proves
  // this holds for all 3 real DEPLOY_ENV values, not just assumed from the
  // shared underlying boolean expression.
  it('ENV_BANNER_VISIBLE agrees with the component\'s own render-null-for-prod branch for every DEPLOY_ENV value', () => {
    for (const [value, expectVisible] of [
      ['dev', true],
      ['local', true],
      ['prod', false],
    ] as const) {
      setDeployEnv(value);
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../../components/EnvBanner');
      const EnvBanner = mod.default;
      const { container, unmount } = render(<EnvBanner />);
      const rendered = container.querySelector('[data-env-banner]') !== null;
      expect(mod.ENV_BANNER_VISIBLE).toBe(expectVisible);
      expect(rendered).toBe(expectVisible);
      unmount();
    }
  });

  // Regression guard for the file's own stated drift risk: ENV_BANNER_HEIGHT_PX
  // (JS, read by layout.tsx at SSR time) and `.banner { height }` (CSS, the
  // ACTUAL rendered height) are two independently-edited files with no
  // compiler/runtime tie between them — only a text-level check can catch a
  // future edit to one without the other. Matches the established
  // raw-text-assertion precedent (src/__tests__/pages/codex-css.test.ts) for
  // CSS Modules, which jsdom cannot cascade/layout for real.
  it('ENV_BANNER_HEIGHT_PX (JS) matches the literal `.banner { height }` declared in EnvBanner.module.css', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../components/EnvBanner');
    const cssPath = path.join(__dirname, '../../components/EnvBanner.module.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    const bannerBlockMatch = /\.banner\s*\{([^}]*)\}/.exec(css);
    expect(bannerBlockMatch).not.toBeNull();
    const heightMatch = /height:\s*(\d+)px/.exec(bannerBlockMatch![1]);
    expect(heightMatch).not.toBeNull();
    expect(Number(heightMatch![1])).toBe(mod.ENV_BANNER_HEIGHT_PX);
  });
});

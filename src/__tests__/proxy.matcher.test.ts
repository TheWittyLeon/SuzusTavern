/**
 * @jest-environment node
 *
 * TAV-NO-FRAMING-HEADERS (Kuro): the proxy is the only place the framing headers and the protected-path
 * gating are applied, and its `config.matcher` excludes `/api`, `/assets` and Next internals by prefix.
 * A page added under one of those prefixes would silently lose both. This walks every `page.tsx` under
 * `src/app` and asserts that the matcher covers its route.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../proxy';

const APP_DIR = path.resolve(__dirname, '..', 'app');

function pageFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return pageFiles(full);
    return e.name === 'page.tsx' ? [full] : [];
  });
}

/** `src/app/play/[sessionId]/page.tsx` -> `/play/x`; route groups `(g)` vanish, `[...a]` becomes two segments. */
function routeOf(file: string): string {
  const segs = path
    .relative(APP_DIR, path.dirname(file))
    .split(path.sep)
    .filter((s) => s && !/^\(.*\)$/.test(s))
    .flatMap((s) => (/^\[\[?\.\.\./.test(s) ? ['x', 'y'] : /^\[.*\]$/.test(s) ? ['x'] : [s]));
  return '/' + segs.join('/');
}

// Next compiles the matcher with path-to-regexp; this one is `/(<negative lookahead>.*)`, i.e. a plain regex.
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe('proxy matcher covers every page route', () => {
  const pages = pageFiles(APP_DIR);

  it('finds the pages (the walk is not vacuous)', () => {
    expect(pages.length).toBeGreaterThan(10);
    expect(pages.map(routeOf)).toEqual(expect.arrayContaining(['/', '/login', '/dashboard']));
  });

  it.each(pages.map((f) => [routeOf(f), f] as const))('%s is matched', (route) => {
    expect(matcher.test(route)).toBe(true);
  });

  it('positive control: routes the matcher is meant to skip are skipped', () => {
    for (const r of ['/api/auth/me', '/assets/logo.svg', '/_next/static/chunk.js', '/favicon.ico']) {
      expect(matcher.test(r)).toBe(false);
    }
  });
});

/**
 * @jest-environment node
 *
 * HUNT1020-21 / HUNT1020-25 — client.ts refreshSession() is the ONE owner of the raw refresh transport.
 * A second caller of `authApi.refresh`, or a second place that spells '/api/auth/refresh', silently
 * brings back the double-rotation (the upstream answers 401 to a reused refresh token) and a refresh that
 * ignores the sign-out ordering. This scans production source for any such site.
 */
import fs from 'fs';
import path from 'path';

interface Source { rel: string; text: string }

/** Drop block and line comments so prose that names the endpoint is not a call site. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const ALLOWED_TRANSPORT = new Set(['src/lib/api/client.ts', 'src/lib/api/auth.ts']);
const BFF_ROUTE = /^src\/app\/api\/auth\/\[\.\.\.path\]\//;

export function oneOwnerViolations(files: Source[]): string[] {
  const out: string[] = [];
  for (const { rel, text } of files) {
    const code = stripComments(text);
    if (!ALLOWED_TRANSPORT.has(rel)) {
      if (/\bauthApi\.refresh\s*\(/.test(code)) out.push(`${rel}: authApi.refresh( call`);
      if (/import\s*\{[^}]*\brefresh\b[^}]*\}\s*from\s*['"][^'"]*api\/auth['"]/.test(code)) {
        out.push(`${rel}: imports refresh from api/auth`);
      }
      for (const m of code.matchAll(/import\s*\*\s*as\s+(\w+)\s+from\s*['"][^'"]*api\/auth['"]/g)) {
        if (new RegExp(`\\b${m[1]}\\.refresh\\b`).test(code)) out.push(`${rel}: ${m[1]}.refresh via namespace import`);
      }
      if (!BFF_ROUTE.test(rel) && /['"`]\/api\/auth\/refresh['"`]/.test(code)) {
        out.push(`${rel}: spells '/api/auth/refresh'`);
      }
    }
    if (rel !== 'src/lib/api/client.ts' && /\bresetRefreshSessionForTests\b/.test(code)) {
      out.push(`${rel}: production code touches resetRefreshSessionForTests`);
    }
  }
  return out;
}

function productionSources(): Source[] {
  const root = process.cwd();
  const found: Source[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'test-support' || e.name === 'test-utils') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.(ts|tsx)$/.test(e.name)) {
        found.push({ rel: path.relative(root, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(path.join(root, 'src'));
  return found;
}

describe('refreshSession() is the one owner of the refresh transport', () => {
  it('production source has no second refresh caller, endpoint literal or test-reset importer', () => {
    const files = productionSources();
    expect(files.length).toBeGreaterThan(50); // the walk found the tree (a vacuous scan proves nothing)
    expect(files.some((f) => f.rel === 'src/lib/api/client.ts')).toBe(true);
    expect(oneOwnerViolations(files)).toEqual([]);
  });

  describe('positive control: the scanner fires on every shape it exists to catch', () => {
    it.each([
      ['a direct authApi.refresh call', "import * as authApi from '@/lib/api/auth';\nawait authApi.refresh();", 'authApi.refresh('],
      ['a named refresh import', "import { me, refresh } from '@/lib/api/auth';", 'imports refresh'],
      ['an aliased namespace call', "import * as a from '../api/auth';\na.refresh(signal);", 'a.refresh via namespace'],
      ['a second spelling of the endpoint', "fetch('/api/auth/refresh', { method: 'POST' });", "spells '/api/auth/refresh'"],
      ['a production importer of the test reset', "import { resetRefreshSessionForTests } from '@/lib/api/client';", 'resetRefreshSessionForTests'],
    ])('%s', (_name, text, needle) => {
      const v = oneOwnerViolations([{ rel: 'src/lib/rogue.ts', text }]);
      expect(v.join('\n')).toContain(needle);
    });

    it('does not fire on prose in comments, nor on the sanctioned files', () => {
      expect(oneOwnerViolations([{ rel: 'src/lib/ok.ts', text: "// calls '/api/auth/refresh' via authApi.refresh(\n/* '/api/auth/refresh' */" }])).toEqual([]);
      expect(oneOwnerViolations([{ rel: 'src/lib/api/auth.ts', text: "apiFetch('/api/auth/refresh')" }])).toEqual([]);
      expect(oneOwnerViolations([{ rel: 'src/app/api/auth/[...path]/route.ts', text: "const p = '/api/auth/refresh';" }])).toEqual([]);
    });
  });
});

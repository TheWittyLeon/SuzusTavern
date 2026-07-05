/**
 * Adversarial ("break-it") tests for src/app/codex/page.tsx (DDX-21), per
 * Miko-QA's §8 standard. The happy-path suite is src/__tests__/pages/codex.test.tsx
 * — this file deliberately tries to break the Codex feature:
 *
 *   - Injection/XSS: engine-supplied description/action text rendered inert
 *     (no dangerouslySetInnerHTML path, no <img>/<script> elements created).
 *   - Search abuse: regex metacharacters, huge strings, emoji through the
 *     REAL search input (unit coverage of matchesSearch itself lives in
 *     dnd-codex-helpers.test.ts — this proves the UI wiring doesn't crash too).
 *   - State abuse: rapid tab switching mid-fetch (out-of-order promise
 *     resolution), a second consecutive retry failure, counts-fetch failure
 *     not blocking the item list (best-effort contract).
 *   - Shape tolerance: sparse/missing data for the three content kinds the
 *     happy-path suite never exercises (item, race, class, background,
 *     condition) — no crash, honest fallback copy.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('../../lib/api/auth', () => ({
  login: jest.fn(),
  verify2FA: jest.fn(),
  logout: jest.fn(),
  refresh: jest.fn(),
  me: jest.fn(),
  register: jest.fn(),
}));

jest.mock('../../lib/api/dnd', () => ({
  getCatalog: jest.fn(),
  getCatalogCounts: jest.fn(),
}));

import * as dnd from '../../lib/api/dnd';
import { AuthProvider } from '../../lib/auth/AuthProvider';
import { ThemeProvider } from '../../lib/theme/ThemeProvider';
import { ToastProvider } from '../../components/Toast';
import CodexPage from '../../app/codex/page';
import type { CatalogItem, User } from '../../lib/api/types';

const mockGetCatalog = dnd.getCatalog as jest.MockedFunction<typeof dnd.getCatalog>;
const mockGetCatalogCounts = dnd.getCatalogCounts as jest.MockedFunction<typeof dnd.getCatalogCounts>;

const LEON: User = { id: 1, username: 'leon', email: null };

const OK_COUNTS = {
  system: 'dnd5e',
  packs: null,
  content_type: null,
  counts: { spell: 1, monster: 1, item: 1, race: 1, class: 1, background: 1, condition: 1 },
} as unknown as Awaited<ReturnType<typeof dnd.getCatalogCounts>>;

function renderCodex() {
  return render(
    <ToastProvider>
      <ThemeProvider>
        <AuthProvider initialUser={LEON} initialMaybeAuthed={false}>
          <CodexPage />
        </AuthProvider>
      </ThemeProvider>
    </ToastProvider>,
  );
}

function respond(type: string, items: CatalogItem[]) {
  return { system: 'dnd5e', content_type: type, items, total: items.length, limit: 500, offset: 0 };
}

beforeEach(() => {
  mockGetCatalogCounts.mockReset().mockResolvedValue(OK_COUNTS);
  mockGetCatalog.mockReset();
});

// ── Injection / XSS ───────────────────────────────────────────────────────────

describe('injection / XSS inertness', () => {
  const EVIL_IMG = '<img src=x onerror="window.__pwned = true">';
  const EVIL_SCRIPT = '<script>window.__pwned2 = true</script>';

  const EVIL_SPELL: CatalogItem = {
    slug: 'evil-spell',
    name: 'Evil Spell',
    content_type: 'spell',
    source_type: 'homebrew',
    data: {
      level: 1,
      description: EVIL_IMG,
      higher_levels: EVIL_SCRIPT,
      components: {},
    },
  };

  const EVIL_MONSTER: CatalogItem = {
    slug: 'evil-monster',
    name: 'Evil Monster',
    content_type: 'monster',
    source_type: 'homebrew',
    data: {
      actions: [{ name: 'Bite', description: EVIL_IMG }],
    },
  };

  beforeEach(() => {
    (window as unknown as { __pwned?: boolean }).__pwned = undefined;
    (window as unknown as { __pwned2?: boolean }).__pwned2 = undefined;
  });

  it('renders a malicious spell description/higher_levels as inert literal text — no <img>/<script> element, handler never fires', async () => {
    mockGetCatalog.mockImplementation((_s, opts) =>
      Promise.resolve(
        opts?.type === 'spell' ? respond('spell', [EVIL_SPELL]) : respond(opts?.type ?? '', []),
      ) as never,
    );
    const { container } = renderCodex();
    const row = await screen.findByRole('option', { name: /evil spell/i });
    fireEvent.click(row);
    await screen.findByRole('heading', { level: 2, name: /evil spell/i });

    // The literal tag text must be visible (rendered, not stripped) ...
    expect(document.body.textContent).toContain('onerror=');
    // ... but never interpreted as real DOM / executed.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect((window as unknown as { __pwned2?: boolean }).__pwned2).toBeUndefined();
  });

  it('renders a malicious monster action description as inert literal text', async () => {
    mockGetCatalog.mockImplementation((_s, opts) =>
      Promise.resolve(
        opts?.type === 'monster' ? respond('monster', [EVIL_MONSTER]) : respond(opts?.type ?? '', []),
      ) as never,
    );
    renderCodex();
    fireEvent.click(await screen.findByRole('tab', { name: /monsters/i }));
    const row = await screen.findByRole('option', { name: /evil monster/i });
    fireEvent.click(row);
    await screen.findByRole('heading', { level: 2, name: /evil monster/i });

    expect(document.body.textContent).toContain('onerror=');
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('the forward-compat condition JSON.stringify branch renders malicious content as inert text too', async () => {
    const EVIL_CONDITION: CatalogItem = {
      slug: 'evil-condition',
      name: 'Evil Condition',
      content_type: 'condition',
      source_type: 'homebrew',
      data: { note: EVIL_IMG },
    };
    mockGetCatalog.mockImplementation((_s, opts) =>
      Promise.resolve(
        opts?.type === 'condition' ? respond('condition', [EVIL_CONDITION]) : respond(opts?.type ?? '', []),
      ) as never,
    );
    renderCodex();
    fireEvent.click(await screen.findByRole('tab', { name: /conditions/i }));
    const row = await screen.findByRole('option', { name: /evil condition/i });
    fireEvent.click(row);
    await screen.findByRole('heading', { level: 2, name: /evil condition/i });

    expect(document.body.textContent).toContain('onerror=');
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });
});

// ── Search abuse (through the real UI, not just the pure helper) ────────────

describe('search abuse (UI wiring)', () => {
  const FIREBALL: CatalogItem = {
    slug: 'fireball',
    name: 'Fireball',
    content_type: 'spell',
    source_type: 'srd',
    data: { level: 3, description: 'boom' },
  };

  beforeEach(() => {
    mockGetCatalog.mockImplementation((_s, opts) =>
      Promise.resolve(opts?.type === 'spell' ? respond('spell', [FIREBALL]) : respond(opts?.type ?? '', [])) as never,
    );
  });

  it('a catastrophic-backtracking-shaped query does not hang the UI and reports zero results', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    const search = screen.getByRole('searchbox', { name: /search spells/i });
    const start = Date.now();
    fireEvent.change(search, { target: { value: '(a+)+$' } });
    expect(screen.queryByRole('option', { name: /fireball/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no results match your search/i)).toBeInTheDocument();
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('a 10k-character query does not crash the list', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    const search = screen.getByRole('searchbox', { name: /search spells/i });
    fireEvent.change(search, { target: { value: 'a'.repeat(10_000) } });
    expect(await screen.findByText(/no results match your search/i)).toBeInTheDocument();
  });

  it('an emoji/ZWJ query does not crash the list and correctly finds no match', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    const search = screen.getByRole('searchbox', { name: /search spells/i });
    fireEvent.change(search, { target: { value: '🔥‍👨‍👩‍👧‍👦' } });
    expect(await screen.findByText(/no results match your search/i)).toBeInTheDocument();
  });

  it('clearing back to an empty query restores the full list (no permanent lockout)', async () => {
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    const search = screen.getByRole('searchbox', { name: /search spells/i });
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    expect(await screen.findByText(/no results match your search/i)).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    expect(await screen.findByRole('option', { name: /fireball/i })).toBeInTheDocument();
  });
});

// ── State abuse: races, retries, best-effort counts ──────────────────────────

describe('state abuse', () => {
  it('rapid tab switching mid-fetch: an out-of-order (late-resolving) previous-tab response never clobbers the now-active tab', async () => {
    let resolveSpell!: (v: unknown) => void;
    let resolveMonster!: (v: unknown) => void;
    const spellPromise = new Promise((res) => {
      resolveSpell = res;
    });
    const monsterPromise = new Promise((res) => {
      resolveMonster = res;
    });

    mockGetCatalog.mockImplementation((_s, opts) => {
      if (opts?.type === 'spell') return spellPromise as never;
      if (opts?.type === 'monster') return monsterPromise as never;
      return Promise.resolve(respond(opts?.type ?? '', [])) as never;
    });

    renderCodex();
    // Spell tab fetch is in flight (mount default). Switch to Monsters before it resolves.
    fireEvent.click(await screen.findByRole('tab', { name: /monsters/i }));

    // Resolve the STALE spell promise first, then the active monster promise —
    // out-of-order on purpose. If AbortController gating is broken, the spell
    // data would win and clobber the monster list.
    resolveSpell(
      respond('spell', [
        {
          slug: 'stale-spell',
          name: 'Stale Spell Should Not Appear',
          content_type: 'spell',
          source_type: 'srd',
          data: { level: 1 },
        },
      ]),
    );
    resolveMonster(
      respond('monster', [
        { slug: 'goblin', name: 'Goblin', content_type: 'monster', source_type: 'srd', data: { cr: 0.25 } },
      ]),
    );

    expect(await screen.findByRole('option', { name: /goblin/i })).toBeInTheDocument();
    // Give the stale promise's .then a tick to (incorrectly) apply if it were going to.
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole('option', { name: /stale spell/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /monsters/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('a SECOND consecutive retry failure returns to the error state, not an infinite spinner', async () => {
    mockGetCatalog.mockRejectedValue(new Error('down'));
    renderCodex();
    const retryBtn = await screen.findByRole('button', { name: /try again/i });
    fireEvent.click(retryBtn);
    // Still failing — must show the error state again, not hang on the skeleton.
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByText(/can.t reach the codex/i)).toBeInTheDocument();
  });

  it('a failed counts fetch does not block the item list (best-effort contract)', async () => {
    mockGetCatalogCounts.mockRejectedValue(new Error('counts down'));
    mockGetCatalog.mockImplementation((_s, opts) =>
      Promise.resolve(
        opts?.type === 'spell'
          ? respond('spell', [
              { slug: 'fireball', name: 'Fireball', content_type: 'spell', source_type: 'srd', data: { level: 3 } },
            ])
          : respond(opts?.type ?? '', []),
      ) as never,
    );
    renderCodex();
    // The list still loads fine even though counts errored.
    expect(await screen.findByRole('option', { name: /fireball/i })).toBeInTheDocument();
    // No count badge is shown for any tab (best-effort: omit, don't fake a 0).
    const spellsTab = screen.getByRole('tab', { name: /spells/i });
    expect(within(spellsTab).queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it('switching tabs while a subfilter is set resets the subfilter (no stale filter silently hiding the new tab’s rows)', async () => {
    mockGetCatalog.mockImplementation((_s, opts) => {
      if (opts?.type === 'spell') {
        return Promise.resolve(
          respond('spell', [
            { slug: 'fireball', name: 'Fireball', content_type: 'spell', source_type: 'srd', data: { level: 3 } },
            { slug: 'mage-hand', name: 'Mage Hand', content_type: 'spell', source_type: 'srd', data: { level: 0 } },
          ]),
        ) as never;
      }
      if (opts?.type === 'monster') {
        return Promise.resolve(
          respond('monster', [
            { slug: 'goblin', name: 'Goblin', content_type: 'monster', source_type: 'srd', data: { cr: 0.25 } },
          ]),
        ) as never;
      }
      return Promise.resolve(respond(opts?.type ?? '', [])) as never;
    });
    renderCodex();
    await screen.findByRole('option', { name: /fireball/i });
    fireEvent.change(screen.getByLabelText(/^level$/i), { target: { value: '3' } });
    expect(screen.queryByRole('option', { name: /mage hand/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /monsters/i }));
    // The goblin row must be visible — a stale "level=3" filter value must not
    // silently apply to a monster-typed field and hide it.
    expect(await screen.findByRole('option', { name: /goblin/i })).toBeInTheDocument();
  });
});

// ── Shape tolerance: under-tested content kinds (item/race/class/background/condition) ──

describe('shape tolerance across the under-tested kinds', () => {
  it('condition with the real dev shape (data: {}) shows the honest not-catalogued message, no crash', async () => {
    const BLINDED: CatalogItem = {
      slug: 'blinded',
      name: 'Blinded',
      content_type: 'condition',
      source_type: 'srd',
      data: {},
    };
    mockGetCatalog.mockImplementation((_s, opts) =>
      Promise.resolve(opts?.type === 'condition' ? respond('condition', [BLINDED]) : respond(opts?.type ?? '', [])) as never,
    );
    renderCodex();
    fireEvent.click(await screen.findByRole('tab', { name: /conditions/i }));
    const row = await screen.findByRole('option', { name: /blinded/i });
    fireEvent.click(row);
    expect(await screen.findByText(/hasn.t catalogued rules text/i)).toBeInTheDocument();
  });

  it('background with an empty skills array shows the honest empty-state, not a crash or blank section', async () => {
    const HERMIT: CatalogItem = {
      slug: 'hermit',
      name: 'Hermit',
      content_type: 'background',
      source_type: 'srd',
      data: { skills: [] },
    };
    mockGetCatalog.mockImplementation((_s, opts) =>
      Promise.resolve(opts?.type === 'background' ? respond('background', [HERMIT]) : respond(opts?.type ?? '', [])) as never,
    );
    renderCodex();
    fireEvent.click(await screen.findByRole('tab', { name: /backgrounds/i }));
    const row = await screen.findByRole('option', { name: /hermit/i });
    fireEvent.click(row);
    expect(await screen.findByText(/no skill proficiencies recorded/i)).toBeInTheDocument();
  });

  it('race with no traits/subraces/languages/proficiencies renders only the stats grid, no crash', async () => {
    const BARE_RACE: CatalogItem = {
      slug: 'bare',
      name: 'Bare Race',
      content_type: 'race',
      source_type: 'homebrew',
      data: { ability_bonus: {} },
    };
    mockGetCatalog.mockImplementation((_s, opts) =>
      Promise.resolve(opts?.type === 'race' ? respond('race', [BARE_RACE]) : respond(opts?.type ?? '', [])) as never,
    );
    renderCodex();
    fireEvent.click(await screen.findByRole('tab', { name: /races/i }));
    const row = await screen.findByRole('option', { name: /bare race/i });
    fireEvent.click(row);
    expect(await screen.findByRole('heading', { level: 2, name: /bare race/i })).toBeInTheDocument();
  });

  it('item with no cost/weight/properties/damage renders dashes, no crash', async () => {
    const BARE_ITEM: CatalogItem = {
      slug: 'bare-item',
      name: 'Bare Item',
      content_type: 'item',
      source_type: 'homebrew',
      data: {},
    };
    mockGetCatalog.mockImplementation((_s, opts) =>
      Promise.resolve(opts?.type === 'item' ? respond('item', [BARE_ITEM]) : respond(opts?.type ?? '', [])) as never,
    );
    renderCodex();
    fireEvent.click(await screen.findByRole('tab', { name: /items/i }));
    const row = await screen.findByRole('option', { name: /bare item/i });
    fireEvent.click(row);
    expect(await screen.findByRole('heading', { level: 2, name: /bare item/i })).toBeInTheDocument();
    expect(await screen.findByText(/no description recorded for this item/i)).toBeInTheDocument();
  });

  // FIXED (Ren-Dev, DDX-21 a11y+cosmetic pass): CatalogClassData types
  // `hit_die` as required, but that's a compile-time-only guarantee — nothing
  // validates the engine's actual JSON payload at the trust boundary, so a
  // malformed/partial homebrew class row (missing hit_die) hit this in
  // production. Checked BOTH render sites since they use different
  // interpolation styles with different failure modes:
  //   - CodexRow.tsx uses JSX children (`d{d.hit_die}`) — React silently
  //     skips an `undefined` child, so the row degrades gracefully today
  //     (shows bare "d"). Verified genuine (not just untested) — confirmed
  //     via the passing assertion below, not assumed. Left as-is (not part of
  //     the filed defect).
  //   - CodexDetail.tsx's ClassDetail used a TEMPLATE LITERAL
  //     (`` `d${d.hit_die}` ``), which stringified `undefined` to the literal
  //     text "dundefined" in the detail drawer. Now guarded (renders "—",
  //     matching every other missing-field fallback in this file). The test
  //     below was `it.failing` while the bug was open (proving it existed
  //     without hard-failing CI); flipped to a plain `it` now that the fix
  //     makes the assertion genuinely pass.
  describe('FIXED: class detail drawer with missing hit_die no longer renders "dundefined"', () => {
    const HALF_CLASS: CatalogItem = {
      slug: 'half-class',
      name: 'Half Class',
      content_type: 'class',
      source_type: 'homebrew',
      // Deliberately omits hit_die despite the type marking it required —
      // simulates a malformed/partial row from an admin content tool.
      data: {} as never,
    };

    beforeEach(() => {
      mockGetCatalog.mockImplementation((_s, opts) =>
        Promise.resolve(opts?.type === 'class' ? respond('class', [HALF_CLASS]) : respond(opts?.type ?? '', [])) as never,
      );
    });

    it('the row degrades gracefully today (JSX skips the undefined child — control, not the defect)', async () => {
      renderCodex();
      fireEvent.click(await screen.findByRole('tab', { name: /classes/i }));
      const row = await screen.findByRole('option', { name: /half class/i });
      expect(within(row).queryByText('dundefined')).not.toBeInTheDocument();
    });

    it('the detail drawer does not render the literal text "dundefined"', async () => {
      renderCodex();
      fireEvent.click(await screen.findByRole('tab', { name: /classes/i }));
      const row = await screen.findByRole('option', { name: /half class/i });
      fireEvent.click(row);
      await screen.findByRole('heading', { level: 2, name: /half class/i });
      expect(screen.queryByText('dundefined')).not.toBeInTheDocument();
      // Guarded to the same em-dash fallback every other missing field uses.
      expect(screen.getByText('—', { selector: '.statV' })).toBeInTheDocument();
    });
  });
});

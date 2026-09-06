/**
 * Tests for the NPC detail renderer (TAV-CODEX-SOURCE-PICKER-NPC, D4/FR-17/
 * FR-18) — the DM-only disclosure's DOM presence/absence (Kuro-Sec C1: the
 * server payload's `dm_only` presence is the ONLY signal; the client never
 * renders a placeholder/hint for its absence — that would be an existence
 * oracle) and the client-side stat_ref join (Sora-Arch §5: no server-
 * embedded `stat_block`, no `resolve` param).
 *
 * Two layers: direct `CodexDetail` component tests (fast, precise coverage
 * of the DM-only DOM contract and the join outcome for a given
 * `resolvedMonster` prop), plus one full-page integration test proving the
 * actual `ensureKind('monster')` → `getCachedItems('monster')` wiring joins
 * correctly end-to-end.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import CodexDetail from '../../app/codex/CodexDetail';
import CodexDetailModal from '../../app/codex/CodexDetailModal';
import type { CatalogItem, CatalogMonsterData, CatalogNpcData } from '../../lib/api/types';

// ── Fixtures ──────────────────────────────────────────────────────────────

const ITACHI_WIRE_ONLY: CatalogItem = {
  slug: 'itachi',
  name: 'Itachi Uchiha',
  content_type: 'npc',
  source_type: 'homebrew',
  pack_id: 'leon-naruto-5e',
  data: {
    name: 'Itachi Uchiha',
    role: 'Rogue ninja',
    motivation: 'Protect the village from the shadows',
    key_lines: ['Foolish little brother...'],
    appearance: 'Lean, scarred, weary eyes.',
    location: 'Akatsuki hideout',
    stat_ref: 'dnd5e:monster:itachi-uchiha',
    lineage: 'Uchiha clan',
    height_ft: '5\'8"',
    aliases: ['Itachi', 'The Weasel'],
    aura_signature: 'Cold, controlled killing intent',
    form_state: 'base',
    power_tier_cue: 'S-rank',
    affiliation: 'Akatsuki',
    rank_cue: 'S-rank missing-nin',
    // no dm_only — non-owner/non-admin projection
  } as CatalogNpcData,
};

const ITACHI_WITH_DM_ONLY: CatalogItem = {
  ...ITACHI_WIRE_ONLY,
  data: {
    ...(ITACHI_WIRE_ONLY.data as CatalogNpcData),
    dm_only: {
      hidden_truth: 'He slaughtered his clan under orders to prevent a coup.',
      age_category: 'adult',
      romanceable: false,
      shape_version: 3, // suppressed key — must never render
    },
  } as CatalogNpcData,
};

const ITACHI_MONSTER_ROW: CatalogItem = {
  slug: 'itachi-uchiha',
  name: 'Itachi Uchiha (stat block)',
  content_type: 'monster',
  source_type: 'homebrew',
  pack_id: 'leon-naruto-5e',
  data: {
    size: 'Medium',
    monster_type: 'humanoid',
    ac: 18,
    hp_formula: '15d8+30',
    cr: 15,
  } as CatalogMonsterData,
};

const ITACHI_MONSTER_ROW_WITH_TACTICS: CatalogItem = {
  ...ITACHI_MONSTER_ROW,
  data: {
    ...(ITACHI_MONSTER_ROW.data as CatalogMonsterData),
    dm_only: { tactics: 'Opens with Tsukuyomi if isolated with a single target.' },
  } as CatalogMonsterData,
};

// A payload maliciously/accidentally carrying the STALE `stat_block` wire
// field name Sora-Arch's design explicitly rejected — the UI must never read
// it (FR-17 reconciliation: proves the join is real, not a field passthrough).
const ITACHI_WITH_STALE_STAT_BLOCK_KEY: CatalogItem = {
  ...ITACHI_WIRE_ONLY,
  data: {
    ...(ITACHI_WIRE_ONLY.data as CatalogNpcData),
    // Deliberately injecting a field that doesn't exist on CatalogNpcData,
    // simulating a stale/malicious payload — CatalogItemData's
    // `Record<string, unknown>` union branch already permits this at the
    // type level (no `@ts-expect-error` needed; that's exactly why the
    // client-side join must be the thing that ignores it, not the type
    // system).
    stat_block: { ac: 999, hp_formula: '999d20', cr: 30 },
  },
};

// ── DM-only DOM contract (Kuro-Sec C1) ───────────────────────────────────

describe('DM-only disclosure — DOM absence/presence (Kuro-Sec C1)', () => {
  it('dm_only ABSENT: the DM-only region is not in the tree at all — no trigger, no hint, no placeholder', () => {
    render(<CodexDetail item={ITACHI_WIRE_ONLY} kind="npc" />);
    expect(screen.queryByText(/dm only/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dm only/i })).not.toBeInTheDocument();
    // Not merely visually hidden — genuinely absent from the DOM.
    expect(document.querySelector('[aria-expanded]')).toBeNull();
  });

  it('dm_only PRESENT: a collapsed disclosure renders exactly once, with an accessible name stating the restriction in TEXT', () => {
    render(<CodexDetail item={ITACHI_WITH_DM_ONLY} kind="npc" />);
    const trigger = screen.getByRole('button', { name: /dm only.*never read aloud/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Content is UNMOUNTED while collapsed (verified via DOM query, not a
    // screenshot) — not merely display:none.
    expect(screen.queryByText(/slaughtered his clan/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /dm only/i })).toHaveLength(1);
  });

  it('expanding the trigger mounts the content; collapsing it again unmounts it', () => {
    render(<CodexDetail item={ITACHI_WITH_DM_ONLY} kind="npc" />);
    const trigger = screen.getByRole('button', { name: /dm only.*never read aloud/i });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/slaughtered his clan/i)).toBeInTheDocument();
    expect(screen.getByText(/hidden truth/i)).toBeInTheDocument();
    expect(screen.getByText(/age category/i)).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/slaughtered his clan/i)).not.toBeInTheDocument();
  });

  it('the suppressed `shape_version` key never renders, even though dm_only is present', () => {
    render(<CodexDetail item={ITACHI_WITH_DM_ONLY} kind="npc" />);
    fireEvent.click(screen.getByRole('button', { name: /dm only.*never read aloud/i }));
    expect(screen.queryByText(/shape version/i)).not.toBeInTheDocument();
  });

  it('two disclosures coexist (the joined monster\'s tactics, embedded in the Stat block section, + the NPC\'s own dm_only) and toggle independently', () => {
    render(
      <CodexDetail item={ITACHI_WITH_DM_ONLY} kind="npc" resolvedMonster={ITACHI_MONSTER_ROW_WITH_TACTICS} />,
    );
    const triggers = screen.getAllByRole('button', { name: /dm only.*never read aloud/i });
    expect(triggers).toHaveLength(2);
    // DOM order: the monster's own tactics disclosure sits inside the "Stat
    // block" section (MonsterDetail, embedded); the NPC's own dm_only
    // disclosure is the last thing NpcDetail renders.
    const [monsterTactics, npcHiddenTruth] = triggers;

    fireEvent.click(monsterTactics);
    expect(screen.getByText(/tsukuyomi/i)).toBeInTheDocument();
    expect(screen.queryByText(/slaughtered his clan/i)).not.toBeInTheDocument();

    fireEvent.click(npcHiddenTruth);
    expect(screen.getByText(/slaughtered his clan/i)).toBeInTheDocument();
    // Expanding the second didn't collapse the first.
    expect(screen.getByText(/tsukuyomi/i)).toBeInTheDocument();
  });

  it('monster tab: dm_only absent means no disclosure; present means one collapsed disclosure with tactics', () => {
    const { unmount } = render(<CodexDetail item={ITACHI_MONSTER_ROW} kind="monster" />);
    expect(screen.queryByRole('button', { name: /dm only/i })).not.toBeInTheDocument();
    unmount();

    render(<CodexDetail item={ITACHI_MONSTER_ROW_WITH_TACTICS} kind="monster" />);
    const trigger = screen.getByRole('button', { name: /dm only.*never read aloud/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(screen.getByText(/tsukuyomi/i)).toBeInTheDocument();
  });
});

// ── Client-side stat_ref join (Sora-Arch §5) ─────────────────────────────

describe('NPC stat block — client-side join, not a server field', () => {
  it('a resolved monster renders via the shared MonsterDetail renderer', () => {
    render(<CodexDetail item={ITACHI_WIRE_ONLY} kind="npc" resolvedMonster={ITACHI_MONSTER_ROW} />);
    expect(screen.getByText('18', { selector: '.statV' })).toBeInTheDocument(); // AC
    expect(screen.getByText('15d8+30')).toBeInTheDocument(); // HP formula
  });

  it('an unresolved stat_ref (49%-class miss) renders a quiet line — no error role, no alert border', () => {
    render(<CodexDetail item={ITACHI_WIRE_ONLY} kind="npc" resolvedMonster={undefined} />);
    expect(screen.getByText(/no stat block on file for this npc/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a stray/stale `stat_block` field on the payload has ZERO effect — the join ignores it entirely, proving the UI reads the cache, not a nonexistent wire field', () => {
    render(<CodexDetail item={ITACHI_WITH_STALE_STAT_BLOCK_KEY} kind="npc" resolvedMonster={undefined} />);
    // The malicious/stale stat_block's fake AC/HP/CR never leak through.
    expect(screen.queryByText('999')).not.toBeInTheDocument();
    expect(screen.queryByText('999d20')).not.toBeInTheDocument();
    expect(screen.getByText(/no stat block on file for this npc/i)).toBeInTheDocument();
  });
});

// ── CodexDetailModal — the narrow-viewport surface (Kage-CR #4) ──────────

describe('CodexDetailModal — resolvedMonster prop (Kage-CR #4)', () => {
  it('passes resolvedMonster through to the embedded NpcDetail — the stat block is NOT NPC-drawer-exclusive below 1280px', () => {
    render(
      <CodexDetailModal
        open
        item={ITACHI_WIRE_ONLY}
        kind="npc"
        resolvedMonster={ITACHI_MONSTER_ROW}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('15d8+30')).toBeInTheDocument();
  });

  it('without the prop, the modal falls back to the quiet "no stat block" line — never silently blank', () => {
    render(<CodexDetailModal open item={ITACHI_WIRE_ONLY} kind="npc" onClose={() => {}} />);
    expect(screen.getByText(/no stat block on file for this npc/i)).toBeInTheDocument();
  });
});

// ── Full-page integration: the real ensureKind → getCachedItems join ────

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
  getPacks: jest.fn(),
}));

describe('full-page: opening an NPC triggers the background monster ensure-load and joins by slug', () => {
  it('selecting an NPC whose stat_ref resolves against the (monster, same-source) cache renders the stat block inline', async () => {
    // Imported after the mocks above are registered.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dnd = require('../../lib/api/dnd');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AuthProvider } = require('../../lib/auth/AuthProvider');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ThemeProvider } = require('../../lib/theme/ThemeProvider');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ToastProvider } = require('../../components/Toast');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const CodexPage = require('../../app/codex/page').default;

    dnd.getCatalogCounts.mockResolvedValue({ counts: {}, content_type: null });
    dnd.getPacks.mockResolvedValue([]);
    dnd.getCatalog.mockImplementation((_s: string, opts: { type?: string }) => {
      if (opts?.type === 'npc') {
        return Promise.resolve({
          system: 'dnd5e',
          content_type: 'npc',
          items: [ITACHI_WIRE_ONLY],
          total: 1,
          limit: 500,
          offset: 0,
        });
      }
      if (opts?.type === 'monster') {
        return Promise.resolve({
          system: 'dnd5e',
          content_type: 'monster',
          items: [ITACHI_MONSTER_ROW],
          total: 1,
          limit: 500,
          offset: 0,
        });
      }
      return Promise.resolve({ system: 'dnd5e', content_type: opts?.type ?? null, items: [], total: 0, limit: 500, offset: 0 });
    });

    render(
      <ToastProvider>
        <ThemeProvider>
          <AuthProvider initialUser={{ id: 1, username: 'leon', email: null }} initialMaybeAuthed={false}>
            <CodexPage />
          </AuthProvider>
        </ThemeProvider>
      </ToastProvider>,
    );

    fireEvent.click(await screen.findByRole('tab', { name: /npcs/i }));
    const row = await screen.findByRole('option', { name: /itachi uchiha/i });
    fireEvent.click(row);

    expect(await screen.findByRole('heading', { level: 2, name: /itachi uchiha/i })).toBeInTheDocument();
    // The client-side join resolved: the linked monster's mechanics render
    // inline beneath the NPC's own detail.
    await waitFor(() => {
      expect(screen.getByText('15d8+30')).toBeInTheDocument();
    });
  });
});

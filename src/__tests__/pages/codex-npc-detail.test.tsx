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
import { dmOnlyFields } from '../../app/codex/MonsterStatBlock';
import type { CatalogItem, CatalogMonsterData, CatalogNpcData, CatalogPhysique, DmOnly } from '../../lib/api/types';

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

// ── PHYSIQUE-000 fixtures (Sora-Arch §8.2/§5, Aoi-UI §1, Kuro-Sec F3) ────────
// Building ahead of the engine's E7 split (unmerged `feature/codex-packs`) —
// these hand-built payloads are the mock for that not-yet-deployed shape.
// The live cross-user check against a real deploy happens post-.226 (Phase
// 8); this file proves the CLIENT'S half of the contract only.

/** Matches the illustrative row in Sora-Arch §5 exactly (public half only —
 *  weight_kg/measurements never appear at this path, Kuro-Sec F3). */
const NARUTO_PHYSIQUE: CatalogPhysique = {
  body_plan: 'human',
  build: 'lean, athletic, wiry-strong',
  hair_color: 'bright sun-blond',
  hair_style: 'short, spiky in every direction',
  eye_color: 'vivid cerulean blue',
  skin: 'warm, lightly tanned',
  skin_kind: 'skin',
  marks: ['three whisker birthmarks per cheek'],
  outfit: 'orange-and-black tracksuit-flak',
  tell: 'the whisker-marked grin under blond spikes',
  height_cm: 168,
};

const ANTHRO_PHYSIQUE: CatalogPhysique = {
  body_plan: 'anthro',
  build: 'digitigrade, powerful haunches',
  height_cm: 140,
};

const CHILD_CODED_PHYSIQUE: CatalogPhysique = {
  body_plan: 'human',
  build: 'small, still growing into her limbs',
};

/** Builds an NPC catalog item from ITACHI_WIRE_ONLY's envelope with `data`
 *  overridden — every PHYSIQUE-000 fixture below only needs to vary
 *  `physique`/`dm_only`, not the whole envelope. */
function npcWith(data: Partial<CatalogNpcData>): CatalogItem {
  return {
    ...ITACHI_WIRE_ONLY,
    data: { ...(ITACHI_WIRE_ONLY.data as CatalogNpcData), ...data } as CatalogNpcData,
  };
}

describe('NpcDetail — physique descriptor cells (PHYSIQUE-000, Aoi-UI §1)', () => {
  it('renders Build/Hair/Eyes/Skin/Marks/Outfit/Tell, in order, when physique is present', () => {
    render(<CodexDetail item={npcWith({ physique: NARUTO_PHYSIQUE })} kind="npc" />);
    expect(screen.getByText('Build')).toBeInTheDocument();
    expect(screen.getByText('lean, athletic, wiry-strong')).toBeInTheDocument();
    expect(screen.getByText('Hair')).toBeInTheDocument();
    expect(screen.getByText('short, spiky in every direction; bright sun-blond')).toBeInTheDocument();
    expect(screen.getByText('Eyes')).toBeInTheDocument();
    expect(screen.getByText('vivid cerulean blue')).toBeInTheDocument();
    expect(screen.getByText('Skin')).toBeInTheDocument();
    expect(screen.getByText('warm, lightly tanned')).toBeInTheDocument();
    expect(screen.getByText('Marks')).toBeInTheDocument();
    expect(screen.getByText('three whisker birthmarks per cheek')).toBeInTheDocument();
    expect(screen.getByText('orange-and-black tracksuit-flak')).toBeInTheDocument();
    expect(screen.getByText('the whisker-marked grin under blond spikes')).toBeInTheDocument();
  });

  it('renders no descriptor cells or Marks section when physique is absent — no placeholder, no empty cell', () => {
    render(<CodexDetail item={ITACHI_WIRE_ONLY} kind="npc" />);
    expect(screen.queryByText('Build')).not.toBeInTheDocument();
    expect(screen.queryByText('Hair')).not.toBeInTheDocument();
    expect(screen.queryByText('Eyes')).not.toBeInTheDocument();
    expect(screen.queryByText('Skin')).not.toBeInTheDocument();
    expect(screen.queryByText('Marks')).not.toBeInTheDocument();
  });

  it('the default skin_kind ("skin") renders no Pill suffix — the enum default is omitted, not branched on', () => {
    render(<CodexDetail item={npcWith({ physique: NARUTO_PHYSIQUE })} kind="npc" />);
    const skinValue = screen.getByText('Skin').nextElementSibling as HTMLElement;
    expect(skinValue.querySelector('.pill')).toBeNull();
  });

  it('a non-default skin_kind (e.g. "fur") renders as a muted Pill suffix — data-driven, never a per-species branch', () => {
    const furry = npcWith({ physique: { ...NARUTO_PHYSIQUE, skin: 'russet', skin_kind: 'fur' } });
    render(<CodexDetail item={furry} kind="npc" />);
    const skinValue = screen.getByText('Skin').nextElementSibling as HTMLElement;
    expect(skinValue.textContent).toBe('russet fur');
    expect(skinValue.querySelector('.pill')).not.toBeNull();
  });

  it('never renders weight_kg or measurements as public cells regardless of what the row carries', () => {
    render(<CodexDetail item={npcWith({ physique: NARUTO_PHYSIQUE })} kind="npc" />);
    expect(screen.queryByText(/weight/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/measurements/i)).not.toBeInTheDocument();
  });
});

// ── PHYSIQUE-000 — the hard indistinguishability requirement ────────────────
// A non-owner viewing a populated row, an anthro row that structurally has no
// measurements, and a child-coded row that structurally cannot have them
// must be impossible to tell apart from the rendered player-view DOM. The
// client has exactly one signal — dm_only.physique.{weight_kg,measurements}
// presence — so all three of these fixtures simply lack a `dm_only` key
// (that IS what "non-owner" means on the wire); the public `physique`
// content varies only to reflect each of the three named reasons.

describe('PHYSIQUE-000 — owner-only measurements/weight indistinguishability (hard requirement)', () => {
  it.each([
    ['a non-owner viewing a populated row', NARUTO_PHYSIQUE],
    ['an anthro row that structurally has no measurements', ANTHRO_PHYSIQUE],
    ['a child-coded row that structurally cannot have measurements', CHILD_CODED_PHYSIQUE],
  ])('%s: no dm_only key at all -> zero DM-only affordance in the DOM', (_label, physique) => {
    render(<CodexDetail item={npcWith({ physique })} kind="npc" />);
    expect(screen.queryByRole('button', { name: /dm only/i })).not.toBeInTheDocument();
    expect(document.querySelector('[aria-expanded]')).toBeNull();
    expect(screen.queryByText(/weight/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/measurements/i)).not.toBeInTheDocument();
  });

  it('all three non-owner cases render byte-identical "no DM-only affordance" DOM — same absence, regardless of why', () => {
    const traces = [NARUTO_PHYSIQUE, ANTHRO_PHYSIQUE, CHILD_CODED_PHYSIQUE].map((physique) => {
      const { container, unmount } = render(<CodexDetail item={npcWith({ physique })} kind="npc" />);
      const trace = container.querySelector('[aria-expanded]');
      unmount();
      return trace;
    });
    expect(traces.every((t) => t === null)).toBe(true);
  });

  it('anthro vs. child-coded: identical byte-for-byte DM-only block when both structurally lack measurements but DO have other dm_only content (Aoi-UI §5, rows 3-4)', () => {
    // Two different structural reasons for "no physique.measurements" —
    // `dm_only.physique` key absent entirely vs. present-but-empty (both are
    // legitimate engine outputs once E7 lands) — must render identically.
    const anthroKeyAbsent = npcWith({
      physique: ANTHRO_PHYSIQUE,
      dm_only: { hidden_truth: 'Guards the north gate.' },
    });
    const childCodedKeyEmpty = npcWith({
      physique: CHILD_CODED_PHYSIQUE,
      dm_only: { hidden_truth: 'Guards the north gate.', physique: {} },
    });

    const first = render(<CodexDetail item={anthroKeyAbsent} kind="npc" />);
    fireEvent.click(screen.getByRole('button', { name: /dm only.*never read aloud/i }));
    const htmlA = first.container.querySelector('[role="region"]')!.querySelector('dl')!.innerHTML;
    first.unmount();

    const second = render(<CodexDetail item={childCodedKeyEmpty} kind="npc" />);
    fireEvent.click(screen.getByRole('button', { name: /dm only.*never read aloud/i }));
    const htmlB = second.container.querySelector('[role="region"]')!.querySelector('dl')!.innerHTML;
    second.unmount();

    expect(htmlA).toBe(htmlB);
    expect(htmlA).not.toMatch(/weight/i);
    expect(htmlA).not.toMatch(/measurements/i);
  });

  it('POSITIVE CONTROL: the same populated NPC, viewed as owner (dm_only.physique present), DOES render Weight + Measurements — proving the negative assertions above are not vacuous', () => {
    const owner = npcWith({
      physique: NARUTO_PHYSIQUE,
      dm_only: {
        physique: { weight_kg: 58, measurements: { bust_cm: 0, waist_cm: 0, hips_cm: 0, cup: 'B' } },
      },
    });
    render(<CodexDetail item={owner} kind="npc" />);
    fireEvent.click(screen.getByRole('button', { name: /dm only.*never read aloud/i }));
    expect(screen.getByText('Weight')).toBeInTheDocument();
    expect(screen.getByText('58 kg')).toBeInTheDocument();
    expect(screen.getByText('Measurements')).toBeInTheDocument();
    expect(screen.getByText(/cup b/i)).toBeInTheDocument();
  });
});

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
    // CODEX-ROMANCE-LABELS (R31): age_category renders under the humanized
    // "Age" row label, not the raw-key "Age Category" — see the dedicated
    // dmOnlyFields() describe block below for the full mapping coverage.
    expect(screen.getByText('Age')).toBeInTheDocument();

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

// ── dmOnlyFields() humanization (CODEX-ROMANCE-LABELS, Leon R31 2026-09-06) ─
// Unit-level (not full-render) — the mapping is pure and exhaustively
// combinatorial; driving it through CodexDetail per case would only add DOM
// query noise, not coverage.

describe('dmOnlyFields — Romance row folds romanceable + romance_arc into one label', () => {
  const romanceRow = (dmOnly: DmOnly) => dmOnlyFields(dmOnly).find((f) => f.key === 'romanceable');

  it.each([
    // romanceable:false wins regardless of whatever romance_arc says —
    // Leon's spotted inconsistency (a stale arc on a non-romanceable NPC)
    // stays invisible to the reader, which is correct: it's not romanceable.
    [{ romanceable: false, romance_arc: 'full' } as DmOnly, 'Not romanceable'],
    [{ romanceable: true, romance_arc: 'full' } as DmOnly, 'Authored arc'],
    [{ romanceable: true, romance_arc: 'emergent' } as DmOnly, 'Open — Suzu improvises'],
    [{ romanceable: true, romance_arc: 'authored' } as DmOnly, 'Authored arc, gated'],
    // The inconsistency Leon wants to STAY visible (romanceable:true with no
    // authored arc yet) reads as an explicit to-do, not a smoothed-over gap.
    [{ romanceable: true, romance_arc: 'none' } as DmOnly, 'Open — no arc yet (data gap)'],
  ])('%j -> %s', (dmOnly, expected) => {
    const row = romanceRow(dmOnly);
    expect(row?.label).toBe('Romance');
    expect(row?.value).toBe(expected);
  });

  it('renders exactly one Romance row — no separate romanceable or romance_arc rows', () => {
    const fields = dmOnlyFields({ romanceable: true, romance_arc: 'full' });
    expect(fields.filter((f) => f.label === 'Romance')).toHaveLength(1);
    expect(fields.find((f) => f.key === 'romance_arc')).toBeUndefined();
  });
});

describe('dmOnlyFields — Age row folds age_category + au_overrides into one label', () => {
  const ageRow = (dmOnly: DmOnly) => dmOnlyFields(dmOnly).find((f) => f.key === 'age_category');

  it.each([
    [{ age_category: 'adult' } as DmOnly, 'Adult'],
    [{ age_category: 'adult', au_overrides: ['aged_up_adult'] } as DmOnly, 'Adult (aged-up AU)'],
    [{ age_category: 'adult', au_overrides: ['adult_presenting'] } as DmOnly, 'Adult (adult-presenting AU)'],
    [{ age_category: 'child_coded' } as DmOnly, 'Child-coded — locked'],
  ])('%j -> %s', (dmOnly, expected) => {
    const row = ageRow(dmOnly);
    expect(row?.label).toBe('Age');
    expect(row?.value).toBe(expected);
  });

  it('drops the separate au_overrides row once folded into Age', () => {
    const fields = dmOnlyFields({ age_category: 'adult', au_overrides: ['aged_up_adult'] });
    expect(fields.find((f) => f.key === 'au_overrides')).toBeUndefined();
  });

  it('a child_coded NPC ignores any au_overrides suffix — the AU flags only ever modify the adult case', () => {
    const row = ageRow({ age_category: 'child_coded', au_overrides: ['aged_up_adult'] });
    expect(row?.value).toBe('Child-coded — locked');
  });
});

describe('dmOnlyFields — remaining fields', () => {
  it('dark_intensity_floor renders a sentence-case label with the raw value', () => {
    const row = dmOnlyFields({ dark_intensity_floor: 2 }).find((f) => f.key === 'dark_intensity_floor');
    expect(row?.label).toBe('Dark intensity floor');
    expect(row?.value).toBe('2');
  });

  it('an unknown/future dm_only key still renders via the generic humanized-key path (fail toward showing)', () => {
    const row = dmOnlyFields({ some_future_field: 'a brand new value' } as DmOnly).find(
      (f) => f.key === 'some_future_field',
    );
    expect(row?.label).toBe('Some Future Field');
    expect(row?.value).toBe('a brand new value');
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

/**
 * Tests for the minimal Feat/Subclass/Adventure renderers (TAV-CODEX-SOURCE-
 * PICKER-NPC, D6, Aoi-UI §4). Adventure is the load-bearing one: FR-6/FR-22
 * require the codex to never request or render scene/gm_description content
 * even if a malformed/malicious payload carries it — the engine's own
 * projection is an allowlist by construction (Sora-Arch A5), and this pins
 * the CLIENT side of that same guarantee.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import CodexDetail from '../../app/codex/CodexDetail';
import CodexRow from '../../app/codex/CodexRow';
import type { CatalogItem } from '../../lib/api/types';

function row(item: CatalogItem, kind: 'feat' | 'subclass' | 'adventure') {
  return render(
    <div role="listbox">
      <CodexRow item={item} kind={kind} selected={false} focused={false} optionId="opt" onSelect={() => {}} />
    </div>,
  );
}

describe('Feat detail (minimal)', () => {
  const GREAT_WEAPON_MASTER: CatalogItem = {
    slug: 'great-weapon-master',
    name: 'Great Weapon Master',
    content_type: 'feat',
    source_type: 'srd',
    data: {
      prerequisite: 'Str 13+',
      ability_score_increase: '—',
      description: 'Before you make a melee attack with a heavy weapon...',
    },
  };

  it('renders StatsGrid + description', () => {
    render(<CodexDetail item={GREAT_WEAPON_MASTER} kind="feat" />);
    expect(screen.getByText('Str 13+')).toBeInTheDocument();
    expect(screen.getByText(/before you make a melee attack/i)).toBeInTheDocument();
  });

  it('does not throw when prerequisite/description are missing (partial/homebrew row)', () => {
    const BARE_FEAT: CatalogItem = {
      slug: 'bare-feat',
      name: 'Bare Feat',
      content_type: 'feat',
      source_type: 'homebrew',
      data: {},
    };
    expect(() => render(<CodexDetail item={BARE_FEAT} kind="feat" />)).not.toThrow();
    expect(screen.getByText(/no description recorded for this feat/i)).toBeInTheDocument();
  });

  it('row shows the prerequisite as a meta chip when present', () => {
    row(GREAT_WEAPON_MASTER, 'feat');
    expect(screen.getByText('Str 13+')).toBeInTheDocument();
  });
});

describe('Subclass detail (minimal)', () => {
  const SCHOOL_OF_EVOCATION: CatalogItem = {
    slug: 'school-of-evocation',
    name: 'School of Evocation',
    content_type: 'subclass',
    source_type: 'srd',
    data: {
      parent_class: 'Wizard',
      subclass_level: 2,
      features: ['Evocation Savant', 'Sculpt Spells'],
      description: 'You focus your study on magic that creates powerful elemental effects.',
    },
  };

  it('renders parent class, unlock level, features, and description', () => {
    render(<CodexDetail item={SCHOOL_OF_EVOCATION} kind="subclass" />);
    expect(screen.getByText('Wizard')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Evocation Savant')).toBeInTheDocument();
    expect(screen.getByText('Sculpt Spells')).toBeInTheDocument();
    expect(screen.getByText(/powerful elemental effects/i)).toBeInTheDocument();
  });

  it('does not throw when features/description are missing', () => {
    const BARE_SUBCLASS: CatalogItem = {
      slug: 'bare-subclass',
      name: 'Bare Subclass',
      content_type: 'subclass',
      source_type: 'homebrew',
      data: { parent_class: 'Fighter' },
    };
    expect(() => render(<CodexDetail item={BARE_SUBCLASS} kind="subclass" />)).not.toThrow();
    expect(screen.getByText(/no description recorded for this subclass/i)).toBeInTheDocument();
  });

  it('row shows the parent class as a meta chip', () => {
    row(SCHOOL_OF_EVOCATION, 'subclass');
    expect(screen.getByText('Wizard')).toBeInTheDocument();
  });
});

describe('Adventure detail (FR-6/FR-22 — allowlist-only, never scenes/gm_description)', () => {
  // Mirrors the engine's actual wire shape for content_type='adventure':
  // `summary` sits at the TOP LEVEL of the row, not nested under `.data`
  // (src/app/modules/page.tsx's toCatalogItem() documents the same shape).
  function adventureItem(extra: Record<string, unknown> = {}): CatalogItem {
    return {
      slug: 'hollow-tide-cave',
      name: 'The Hollow Tide Cave',
      content_type: 'adventure',
      source_type: 'homebrew',
      public_id: 'dnd5e:adventure:hollow-tide-cave',
      data: {},
      ...extra,
    } as unknown as CatalogItem;
  }

  it('renders the allowlisted summary fields: level range, length, content rating, tags', () => {
    const item = adventureItem({
      summary: {
        subtitle: 'A one-shot for 4 level-3 heroes',
        level_range: { min: 3, max: 3 },
        length: 'one_shot',
        content_rating: 'PG-13',
        tags: ['coastal', 'undead'],
      },
    });
    render(<CodexDetail item={item} kind="adventure" />);
    expect(screen.getByText('A one-shot for 4 level-3 heroes')).toBeInTheDocument();
    expect(screen.getByText('Lv 3')).toBeInTheDocument();
    expect(screen.getByText('one shot')).toBeInTheDocument();
    expect(screen.getByText('PG-13')).toBeInTheDocument();
    expect(screen.getByText('coastal')).toBeInTheDocument();
    expect(screen.getByText('undead')).toBeInTheDocument();
    expect(screen.getByText(/full adventure content is dm-only/i)).toBeInTheDocument();
  });

  it('formats an asymmetric level range as "Lv min–max"', () => {
    const item = adventureItem({ summary: { level_range: { min: 1, max: 4 } } });
    render(<CodexDetail item={item} kind="adventure" />);
    expect(screen.getByText('Lv 1–4')).toBeInTheDocument();
  });

  it('NEVER renders scene text even if the fixture maliciously/accidentally carries `scenes` at the top level or inside `summary`', () => {
    const item = adventureItem({
      summary: {
        subtitle: 'Normal subtitle',
        level_range: { min: 1, max: 1 },
        // A malicious/leaked scenes array smuggled into the summary block —
        // the client must never read or render it even if the server ever
        // sent it by mistake.
        scenes: [{ title: 'Scene one', gm_description: 'SECRET GM-ONLY TEXT' }],
      },
      // Also smuggled at the top level of the row (mirrors a raw list_catalog
      // row before the engine's projection — defense in depth).
      scenes: [{ title: 'Top-level scene', gm_description: 'ANOTHER SECRET' }],
      gm_description: 'TOP LEVEL GM SECRET',
    });
    render(<CodexDetail item={item} kind="adventure" />);
    expect(screen.queryByText(/SECRET GM-ONLY TEXT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ANOTHER SECRET/)).not.toBeInTheDocument();
    expect(screen.queryByText(/TOP LEVEL GM SECRET/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Scene one/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Top-level scene/)).not.toBeInTheDocument();
  });

  it('does not throw when summary is entirely absent (bare row)', () => {
    const item = adventureItem();
    expect(() => render(<CodexDetail item={item} kind="adventure" />)).not.toThrow();
    expect(screen.getByText(/full adventure content is dm-only/i)).toBeInTheDocument();
  });

  it('row shows the level band; no scene-count chip exists on the wire (Sora-Arch confirmed allowlist has no scene count) — length fills the second chip instead', () => {
    const item = adventureItem({
      summary: { level_range: { min: 2, max: 2 }, length: 'short' },
    });
    row(item, 'adventure');
    expect(screen.getByText('Lv 2')).toBeInTheDocument();
    expect(screen.getByText('short')).toBeInTheDocument();
  });
});

describe('Detail body is a focusable, labelled scroll region (Iro-A11y live pass, scrollable-region-focusable)', () => {
  const FIREBALL: CatalogItem = {
    slug: 'fireball',
    name: 'Fireball',
    content_type: 'spell',
    source_type: 'srd',
    data: { level: 3, school: 'evocation', description: 'A bright streak flashes.' },
  };

  it('the overflow-y:auto detail panel is keyboard-focusable and has an accessible name derived from the item', () => {
    render(<CodexDetail item={FIREBALL} kind="spell" />);
    const region = screen.getByRole('region', { name: /fireball details/i });
    expect(region).toHaveAttribute('tabIndex', '0');
    // A keyboard user must be able to Tab to it directly (jsdom doesn't lay
    // out overflow, so this asserts reachability, not scroll behavior).
    region.focus();
    expect(region).toHaveFocus();
  });

  it('the accessible name works even without a headingId (the always-visible desktop drawer never passes one — only CodexDetailModal does)', () => {
    render(<CodexDetail item={FIREBALL} kind="spell" headingId={undefined} />);
    expect(screen.getByRole('region', { name: /fireball details/i })).toBeInTheDocument();
  });
});

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

  // UIA-0919-001 regression: selecting a homebrew subclass whose `features`
  // are structured `{level, name, description}` objects (verified wire shape
  // — NekoNova-DnDEngine scripts/seed_data/leon-fairytail-5e/20-subclasses-
  // g1.json's "airspace-magic" row) used to crash the whole /codex route
  // with "Objects are not valid as a React child", preceded by 10 duplicate
  // `[object Object]` key warnings.
  const AIRSPACE_MAGIC: CatalogItem = {
    slug: 'airspace-magic',
    name: 'Airspace Magic',
    content_type: 'subclass',
    source_type: 'homebrew',
    data: {
      class: 'ft-caster',
      subclass_level: 1,
      description: 'Airspace Magic (Erigor’s Wind). Caster chassis.',
      features: [
        { level: 1, name: 'Wind Palm (Airspace Signature)', description: 'Free, at-will.' },
        { level: 1, name: 'Airspace Magic — Rung I', description: 'Choose ONE (2 MP each).' },
        { level: 3, name: 'Airspace Magic — Rung II', description: 'Choose ONE (3 MP each).' },
        { level: 5, name: 'Airspace Magic — Rung III', description: 'Choose ONE (5 MP each).' },
        { level: 11, name: 'Airspace Magic — Rung IV', description: 'Choose ONE (9 MP each).' },
        { level: 18, name: 'Airspace Magic — Rung V', description: 'Choose ONE (13 MP each).' },
      ],
    },
  };

  it('UIA-0919-001: renders a homebrew subclass with OBJECT features without throwing, showing every feature name', () => {
    expect(() => render(<CodexDetail item={AIRSPACE_MAGIC} kind="subclass" />)).not.toThrow();
    expect(screen.getByText(/wind palm \(airspace signature\)/i)).toBeInTheDocument();
    expect(screen.getByText(/rung i\b/i)).toBeInTheDocument();
    expect(screen.getByText(/rung v\b/i)).toBeInTheDocument();
  });

  it('UIA-0919-001: prefixes the level onto the name ("Level 3 · ...", never the abbreviation "Lv") for a structured feature entry', () => {
    render(<CodexDetail item={AIRSPACE_MAGIC} kind="subclass" />);
    expect(screen.getByText(/^Level 3 · Airspace Magic — Rung II$/)).toBeInTheDocument();
    expect(screen.queryByText(/Lv 3/)).not.toBeInTheDocument();
  });

  // Kage-CR a11y finding: `title` on a non-focusable span reaches mouse
  // users only, and for a homebrew subclass the description is the ONLY
  // copy of the rules text anywhere on the wire — it must render as visible
  // text, not hide behind a hover-only attribute.
  it('Kage-CR a11y: a feature’s description renders as VISIBLE text, not only inside a hover-only title attribute', () => {
    const { container } = render(<CodexDetail item={AIRSPACE_MAGIC} kind="subclass" />);
    // getByText only matches real DOM text content — a description that
    // existed ONLY as `title="..."` would fail this assertion even though a
    // mouse-hover tooltip would still show it, which is exactly the gap
    // this finding closed.
    expect(screen.getByText('Free, at-will.')).toBeInTheDocument();
    expect(screen.getByText('Choose ONE (3 MP each).')).toBeInTheDocument();
    // And no hover-only duplicate was left behind for any element.
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('UIA-0919-001: never renders the literal string "[object Object]" anywhere for an object-shaped feature list', () => {
    render(<CodexDetail item={AIRSPACE_MAGIC} kind="subclass" />);
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });

  it('UIA-0919-001: does not warn about duplicate/non-unique React keys for the object-features list', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(<CodexDetail item={AIRSPACE_MAGIC} kind="subclass" />);
    const keyWarnings = errorSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').match(/same key|unique "key" prop|encountered two children/i),
    );
    expect(keyWarnings).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it('UIA-0919-001: row also survives the object-features shape (the row never reads `features` at all)', () => {
    expect(() => row(AIRSPACE_MAGIC, 'subclass')).not.toThrow();
    expect(screen.getByRole('option', { name: /airspace magic/i })).toBeInTheDocument();
  });

  // Miko-QA DEFECT, fixed (Ren-Dev, UIA-0919-001 follow-up): normalizeFeatureEntries
  // (lib/dnd/codex.ts) used to throw on a `null`/`undefined` ELEMENT inside an
  // otherwise-normal features array (typeof null === 'object' sent it down
  // the structured-entry branch, then `entry.level`/`entry.name` threw) — see
  // the unit-level repro + full writeup in dnd-codex-helpers.test.ts. This is
  // the RENDER-LEVEL consequence: a homebrew subclass row with a stray null
  // in its features array (a plausible hand-authored-JSON mistake — the exact
  // kind of malformed homebrew content UIA-0919-001 exists to tolerate)
  // reproduced the ORIGINAL bug's user-facing symptom — the whole /codex
  // route crashing — via a different trigger than the one the first pass
  // fixed. No ErrorBoundary wraps CodexDetail (grepped, none found), so this
  // was not contained to the row. Was `test.failing` (Miko-QA); now a normal
  // passing `it` now that the null element is skipped instead of read.
  it('UIA-0919-001: a null element inside a homebrew subclass features array does not crash the /codex route, and the real features still render', () => {
    const AIRSPACE_MAGIC_WITH_NULL_ELEMENT: CatalogItem = {
      ...AIRSPACE_MAGIC,
      slug: 'airspace-magic-malformed',
      data: {
        ...AIRSPACE_MAGIC.data,
        features: [...(AIRSPACE_MAGIC.data as { features: unknown[] }).features, null],
      },
    };
    expect(() =>
      render(<CodexDetail item={AIRSPACE_MAGIC_WITH_NULL_ELEMENT} kind="subclass" />),
    ).not.toThrow();
    expect(screen.getByText(/wind palm \(airspace signature\)/i)).toBeInTheDocument();
  });

  // Kage-CR BLOCKING #1 (jsdom probe): `features` authored as a bare STRING
  // instead of an array — a hand-authored homebrew JSON typo, e.g. a
  // trailing comma dropped turning `["Wind Palm"]` into `"Wind Palm"` — used
  // to throw at `entries.forEach` (strings have no `.forEach`) before any
  // element was even reached. The Section itself is simply omitted (an
  // empty normalized list), same degrade as no `features` key at all.
  it('UIA-0919-001 / Kage-CR: a subclass row with `features` authored as a bare STRING (not an array) does not crash the /codex route', () => {
    const AIRSPACE_MAGIC_STRING_FEATURES: CatalogItem = {
      ...AIRSPACE_MAGIC,
      slug: 'airspace-magic-string-features',
      data: {
        ...(AIRSPACE_MAGIC.data as Record<string, unknown>),
        features: 'Wind Palm',
      },
    };
    expect(() =>
      render(<CodexDetail item={AIRSPACE_MAGIC_STRING_FEATURES} kind="subclass" />),
    ).not.toThrow();
    expect(screen.queryByText(/no description recorded for this subclass/i)).not.toBeInTheDocument();
    expect(screen.getByText(/airspace magic \(erigor/i)).toBeInTheDocument();
    expect(screen.queryByText('Features')).not.toBeInTheDocument();
  });

  // Kage-CR BLOCKING #1 (verbatim jsdom probe): `features: {…}` — the whole
  // field authored as a bare object instead of an array.
  it('UIA-0919-001 / Kage-CR: a subclass row with `features` authored as a bare OBJECT (not an array) does not crash the /codex route', () => {
    const AIRSPACE_MAGIC_OBJECT_FEATURES: CatalogItem = {
      ...AIRSPACE_MAGIC,
      slug: 'airspace-magic-object-features',
      data: {
        ...(AIRSPACE_MAGIC.data as Record<string, unknown>),
        features: { name: 'Wind Palm' },
      },
    };
    expect(() =>
      render(<CodexDetail item={AIRSPACE_MAGIC_OBJECT_FEATURES} kind="subclass" />),
    ).not.toThrow();
    expect(screen.queryByText('Features')).not.toBeInTheDocument();
  });
});

describe('Class detail level1_features (UIA-0919-001 defensive widen)', () => {
  // level1_features has only ever shipped as bare strings on the real wire —
  // this proves the SRD shape keeps rendering byte-identical, AND that the
  // same normalizer this bug introduced tolerates an object entry without
  // crashing if a future homebrew pack ever authors one that way.
  const FIGHTER: CatalogItem = {
    slug: 'fighter',
    name: 'Fighter',
    content_type: 'class',
    source_type: 'srd',
    data: {
      hit_die: 10,
      level1_features: ['Fighting Style', 'Second Wind'],
    },
  };

  it('renders plain-string level1_features unchanged', () => {
    render(<CodexDetail item={FIGHTER} kind="class" />);
    expect(screen.getByText('Fighting Style')).toBeInTheDocument();
    expect(screen.getByText('Second Wind')).toBeInTheDocument();
  });

  it('does not throw and formats "Level N · name" (visible description) if a future homebrew class ever authors level1_features as structured objects', () => {
    const HOMEBREW_CLASS: CatalogItem = {
      slug: 'ft-caster',
      name: 'Caster (Fairy Tail)',
      content_type: 'class',
      source_type: 'homebrew',
      data: {
        hit_die: 8,
        level1_features: [{ level: 1, name: 'Magic', description: 'You commit to ONE Magic.' }],
      },
    };
    expect(() => render(<CodexDetail item={HOMEBREW_CLASS} kind="class" />)).not.toThrow();
    expect(screen.getByText('Level 1 · Magic')).toBeInTheDocument();
    expect(screen.getByText('You commit to ONE Magic.')).toBeInTheDocument();
  });

  it('does not throw when the whole `level1_features` field is authored as a bare string (Kage-CR jsdom probe shape)', () => {
    const MALFORMED_CLASS: CatalogItem = {
      slug: 'malformed',
      name: 'Malformed',
      content_type: 'class',
      source_type: 'homebrew',
      data: { hit_die: 8, level1_features: 'Fighting Style' },
    };
    expect(() => render(<CodexDetail item={MALFORMED_CLASS} kind="class" />)).not.toThrow();
    expect(screen.queryByText('Level 1 features')).not.toBeInTheDocument();
  });
});

describe('Race detail traits (UIA-0919-001 defensive widen)', () => {
  const HUMAN: CatalogItem = {
    slug: 'ft-human',
    name: 'Human (Fiore)',
    content_type: 'race',
    source_type: 'homebrew',
    data: {
      ability_bonus: { charisma: 1 },
      traits: ['Versatile', 'Request-Board Haggling (Persuasion)'],
      subraces: {
        'First Generation': {
          ability_bonus: {},
          traits: ['Dragon-raised', 'Feast (+2 MP per meal)'],
        },
      },
    },
  };

  it('renders plain-string race traits and subrace traits unchanged (as Pills, no description to show)', () => {
    render(<CodexDetail item={HUMAN} kind="race" />);
    expect(screen.getByText('Versatile')).toBeInTheDocument();
    expect(screen.getByText('First Generation')).toBeInTheDocument();
    expect(screen.getByText('Dragon-raised')).toBeInTheDocument();
    expect(screen.getByText('Feast (+2 MP per meal)')).toBeInTheDocument();
  });

  it('does not throw and formats structured entries with a VISIBLE description if a future homebrew race authors traits as objects', () => {
    const HOMEBREW_RACE: CatalogItem = {
      slug: 'kekkei-genkai',
      name: 'Kekkei Genkai',
      content_type: 'race',
      source_type: 'homebrew',
      data: {
        ability_bonus: { dexterity: 2 },
        traits: [{ level: 15, name: 'Bloodline Awakening', description: 'DM-gated.' }],
        subraces: {
          Uchiha: {
            ability_bonus: { dexterity: 2 },
            traits: [{ name: 'Sharingan', description: 'DM-tracked.' }],
          },
        },
      },
    };
    expect(() => render(<CodexDetail item={HOMEBREW_RACE} kind="race" />)).not.toThrow();
    expect(screen.getByText('Level 15 · Bloodline Awakening')).toBeInTheDocument();
    expect(screen.getByText('DM-gated.')).toBeInTheDocument();
    expect(screen.getByText('Sharingan')).toBeInTheDocument();
    expect(screen.getByText('DM-tracked.')).toBeInTheDocument();
  });

  // Kage-CR BLOCKING #1 (verbatim jsdom probe): `traits: "Darkvision"` — the
  // whole field authored as a bare string instead of an array.
  it('does not throw when `traits` is authored as a bare STRING (Kage-CR jsdom probe: traits: "Darkvision")', () => {
    const MALFORMED_RACE: CatalogItem = {
      slug: 'malformed-string-traits',
      name: 'Malformed String Traits',
      content_type: 'race',
      source_type: 'homebrew',
      data: { ability_bonus: {}, traits: 'Darkvision' },
    };
    expect(() => render(<CodexDetail item={MALFORMED_RACE} kind="race" />)).not.toThrow();
    expect(screen.queryByText('Traits')).not.toBeInTheDocument();
  });

  it('does not throw when `traits` is authored as a bare OBJECT (Kage-CR jsdom probe shape)', () => {
    const MALFORMED_RACE: CatalogItem = {
      slug: 'malformed-object-traits',
      name: 'Malformed Object Traits',
      content_type: 'race',
      source_type: 'homebrew',
      data: { ability_bonus: {}, traits: { name: 'Darkvision' } },
    };
    expect(() => render(<CodexDetail item={MALFORMED_RACE} kind="race" />)).not.toThrow();
    expect(screen.queryByText('Traits')).not.toBeInTheDocument();
  });

  // Same probe, one level deeper: a SUBRACE's own `traits` field authored as
  // a bare string — the nested loop calls the same normalizer per subrace.
  it('does not throw when a SUBRACE’s own `traits` is authored as a bare STRING', () => {
    const MALFORMED_SUBRACE: CatalogItem = {
      slug: 'malformed-subrace-traits',
      name: 'Malformed Subrace Traits',
      content_type: 'race',
      source_type: 'homebrew',
      data: {
        ability_bonus: {},
        subraces: { Variant: { ability_bonus: {}, traits: 'Darkvision' } },
      },
    };
    expect(() => render(<CodexDetail item={MALFORMED_SUBRACE} kind="race" />)).not.toThrow();
    expect(screen.getByText('Variant')).toBeInTheDocument();
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

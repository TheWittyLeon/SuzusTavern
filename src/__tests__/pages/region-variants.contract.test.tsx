/**
 * A9c-2 D5 (build brief 6, R3) — the component half of the variant contract.
 * For every region in `REGION_VARIANTS`: given a member, the region's root
 * stamps `data-variant` with exactly that member, and the rendered markup
 * DIFFERS between members (so a variant that is only a data attribute, with
 * no reader, is red). The real-page half — the page hands each region its
 * ROW's variant — is `play.render-matrix.real-page.test.tsx`.
 *
 * Fixtures are required, not optional: a region added to `REGION_VARIANTS`
 * with neither a fixture here nor an entry in VARIANTS_NOT_YET_CONSUMED is
 * red, and an entry that has gained a fixture must leave the list. The list
 * is the registry's own, named and dated, so "consumed" cannot rot into a
 * claim nobody checked.
 */
import { createRef, type ReactElement } from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import TopBar, { type TopBarProps } from '@/app/play/[sessionId]/regions/TopBar';
import SuzuPresence from '@/app/play/[sessionId]/regions/SuzuPresence';
import PartyStrip from '@/app/play/[sessionId]/regions/PartyStrip';
import Offers, { type OffersProps } from '@/app/play/[sessionId]/regions/Offers';
import ActionBar from '@/app/play/[sessionId]/regions/ActionBar';
import SceneStage from '@/app/play/[sessionId]/regions/SceneStage';
import Composer from '@/components/Composer';
import { REGION_VARIANTS, type VariantRegionId } from '@/app/play/[sessionId]/variants';
import type { SceneCheck, SceneTransition, Participant } from '@/lib/api/types';

jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/api/dnd', () => ({ bindCharacter: jest.fn(), listMyCharacters: jest.fn(() => Promise.resolve([])) }));

const noop = () => {};

const topBar: Omit<TopBarProps, 'variant'> = {
  title: 'The Hollow Tide',
  journalOpen: false,
  onToggleJournal: noop,
  paneId: 'play-pane-journal',
  showSuzuPanel: true,
  talking: false,
  sceneName: 'Cave Mouth',
  objective: null,
  combatActive: false,
  round: null,
  turnStatusText: null,
  initiativeOrder: [],
  status: <span>exploring</span>,
  statusPill: <span>exploring</span>,
};

const PARTY: Participant[] = [
  { username: 'kes', is_dm: false, character: { character_id: 'c_kes', name: 'Kestrel Ashwood', char_class: 'Ranger', level: 4, current_hp: 27, max_hp: 34, ac: 16 } },
  { username: 'suzu', is_dm: true, character: null },
];

const offers: Omit<OffersProps, 'variant'> = {
  availableChecks: [{ skill: 'perception', dc: 13, state: 'available' }] as unknown as SceneCheck[],
  offeredCheckSkill: 'perception',
  checkBusy: false,
  talking: false,
  sessionLocked: false,
  onAttemptCheck: noop,
  checkWrapRef: createRef<HTMLDivElement>(),
  freeformOfferedCheck: null,
  freeformCheckRef: createRef<HTMLDivElement>(),
  rollBusy: false,
  combatBusy: false,
  onRoll: noop,
  availableTransitions: [{ to: 'stair', label: 'Descend the broken stair' }] as unknown as SceneTransition[],
  adventureComplete: false,
  transitionWrapRef: createRef<HTMLDivElement>(),
  sceneAdvanceBusy: false,
  onMoveOn: noop,
};

// A9d-2 N5: the stage's fixture. Combat, so the strip's own pieces (the status line with its round, End combat) are in the markup.
const sceneStage = {
  sceneName: 'The Sundered Hollow',
  objective: 'Find the source of the tremors.',
  sceneHeadRef: createRef<HTMLDivElement>(),
  combatIsActive: true,
  activeEncounterId: null,
  sceneHasEncounter: false,
  combatBusy: false,
  endCombatBtnRef: createRef<HTMLButtonElement>(),
  outcomeChooserOpen: false,
  setOutcomeChooserOpen: noop,
  lastOpenerRef: createRef<HTMLButtonElement>(),
  allHostilesDown: false,
  anyMonsterDown: false,
  onEndCombat: noop,
  beginCombatRef: createRef<HTMLButtonElement>(),
  onBeginEncounter: noop,
  talking: false,
  sessionLocked: false,
  rollBusy: false,
  round: 3,
};

/** One element per consuming region: `(member) => the region, rendered with that variant`. */
const FIXTURES: { [R in VariantRegionId]?: (variant: (typeof REGION_VARIANTS)[R][number]) => ReactElement } = {
  topBar: (variant) => <TopBar {...topBar} variant={variant} />,
  suzuPresence: (variant) => <SuzuPresence variant={variant} />,
  partyStrip: (variant) => (
    <PartyStrip
      participants={PARTY}
      selfUsername="kes"
      combatState={null}
      onSelectMember={noop}
      isDm={false}
      sessionId="s1"
      combatIsActive={false}
      sessionLocked={false}
      onRebindChanged={noop}
      round={null}
      selfPcId={null}
      variant={variant}
    />
  ),
  offers: (variant) => <Offers {...offers} variant={variant} />,
  actionBar: (variant) => (
    <ActionBar targets={[{ id: 'm1', name: 'Goblin' }]} onAction={noop} isPlayerTurn variant={variant} />
  ),
  sceneStage: (variant) => <SceneStage {...sceneStage} variant={variant} />,
  // A9d-2 N7: the composer. `roll` paints the `tools` node (the Roll control) at the end of the mode row; `full` does not. A stand-in node is
  // enough here: what is pinned is that the variant is READ, and that markup differs between members.
  composer: (variant) => (
    <Composer value="" onChange={noop} mode="say" onMode={noop} onSend={noop} variant={variant} tools={<button type="button">Roll</button>} />
  ),
};

/**
 * Members the registry declares that render AS another member until their step. The contract demands every member's markup differ; an
 * alias is named, dated, and held to be IDENTICAL to its target (so it cannot drift into a third form unnoticed).
 */
const MEMBERS_RENDERED_AS: { [R in VariantRegionId]?: Record<string, string> } = {
  // (A10 step 11 S2b, named exception: the `sceneStage` `hero: 'panel'` alias is deleted, as its marker said it would be: `hero` is the scene line
  // and a body, `panel` the stacked head, and the pairwise check below covers all three members of the stage. No member renders as another now.)
};

/**
 * Regions the registry declares a vocabulary for that no component reads yet.
 * Each leaves this list the commit its region stamps `data-variant`.
 */
const VARIANTS_NOT_YET_CONSUMED = {
  // debt: characterBlock has no variant reader; the sheet renders one way in every row. ceiling: the registry lists compact|full and nothing stamps them. until: step 7 (CharacterBlock extraction) consumes compact/full.
  characterBlock: 'step 7',
} as const satisfies Partial<Record<VariantRegionId, string>>;

// Comparable markup: the variant stamp itself removed (a variant must be READ, not
// just printed) and React's per-mount useId counter (`_r_0_`, `_r_1_`, ...)
// flattened, because it makes two renders of the SAME element unequal and would
// let every region pass the "differs" check for free.
const comparable = (html: string) =>
  html.replace(/\sdata-variant="[^"]*"/g, '').replace(/_r_[0-9a-z]+_|:r[0-9a-z]+:|\u00ab[0-9a-z]+\u00bb/g, '_r_');

describe('region variants contract: every REGION_VARIANTS region is consumed or named as not yet', () => {
  const regions = Object.keys(REGION_VARIANTS) as VariantRegionId[];

  it('each region has a fixture, or is listed (and dated) in VARIANTS_NOT_YET_CONSUMED, never both', () => {
    for (const r of regions) {
      const fixture = r in FIXTURES;
      const pending = r in VARIANTS_NOT_YET_CONSUMED;
      expect([r, fixture !== pending]).toEqual([r, true]);
    }
    for (const r of Object.keys(FIXTURES)) expect(regions).toContain(r);
    for (const r of Object.keys(VARIANTS_NOT_YET_CONSUMED)) expect(regions).toContain(r);
  });

  it.each(regions.filter((r) => r in FIXTURES))('%s: root data-variant is the member handed in, and markup differs between members', (r) => {
    const members = REGION_VARIANTS[r] as readonly string[];
    const make = FIXTURES[r] as (v: string) => ReactElement;
    const htmls = members.map((member) => {
      const { container, unmount } = render(make(member));
      const root = container.querySelector(`[data-region="${r}"]`);
      expect([r, member, root?.getAttribute('data-variant')]).toEqual([r, member, member]);
      const html = comparable(container.innerHTML);
      unmount();
      return html;
    });
    // pairwise distinct once the stamp itself is removed: a variant must be READ, not just printed. A member that renders AS another is
    // named in MEMBERS_RENDERED_AS and must be IDENTICAL to its target.
    const aliases = MEMBERS_RENDERED_AS[r] ?? {};
    for (const [alias, target] of Object.entries(aliases)) expect([r, alias, htmls[members.indexOf(alias)]]).toEqual([r, alias, htmls[members.indexOf(target)]]);
    expect([r, new Set(htmls).size]).toEqual([r, members.length - Object.keys(aliases).length]);
  });

  it.each(regions.filter((r) => r in FIXTURES))('%s: the comparison is sound, the same member rendered twice is identical', (r) => {
    const make = FIXTURES[r] as (v: string) => ReactElement;
    const member = REGION_VARIANTS[r][0];
    const a = render(make(member));
    const first = comparable(a.container.innerHTML);
    a.unmount();
    const b = render(make(member));
    expect(comparable(b.container.innerHTML)).toBe(first);
  });
});

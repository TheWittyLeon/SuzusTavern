/**
 * TAV-PLAY-SHELL A9c-1 C3 — `slotOrder()` (build brief §3-§4, Amendment C.2)
 * and `snapshotScroll`/`restoreScroll` (build brief §3.1).
 *
 * The six literal DOM orders are pinned in C5 (§4.1); this file pins the
 * RULES the function follows, on synthetic rows (so a real row edit cannot
 * mask a rule change) and the structural invariants on every real row.
 *
 * The browser transitions `t2-breakpoint` / `t3-auto-combat-start`
 * (tools/ui-audit) are the real pin for scroll preservation; the jsdom
 * snapshot tests below cover the pure halves only.
 */
import {
  LAYOUT_ROWS,
  REGION_IDS,
  getPlacement,
  slotOrder,
  type LayoutRow,
  type Moment,
  type Placement,
  type RegionId,
} from '@/app/play/[sessionId]/presets';
import { restoreScroll, snapshotScroll } from '@/app/play/[sessionId]/ScrollKeeper';

const MOMENTS: Moment[] = ['exploring', 'combat'];

/** A row where EVERY region is a placed slot unless `over` says otherwise. */
function syntheticRow(
  areas: string,
  over: Partial<Record<RegionId, Placement>> = {},
): LayoutRow {
  const regions = {} as LayoutRow['regions'];
  for (const id of REGION_IDS) regions[id] = { default: over[id] ?? { area: id } };
  return {
    id: 'story',
    areas: { exploring: areas, combat: areas },
    columns: { exploring: '1fr', combat: '1fr' },
    rows: { exploring: 'auto', combat: 'auto' },
    regions,
  };
}

const flat = (row: LayoutRow, moment: Moment) =>
  slotOrder(row, moment).map((e) =>
    e.kind === 'hosted' ? `${e.host}>${e.id}` : e.kind === 'hidden' ? `(${e.id})` : e.id,
  );

describe('A9c C3 — slotOrder(): the rules, on synthetic rows', () => {
  const hide = (): Placement => ({ area: null });

  it('rule 1: row-major first appearance of each token, not REGION_IDS order', () => {
    const row = syntheticRow('"storyLog topBar" "composer sceneStage"', {
      topBar: { area: 'topBar' },
    });
    const slots = slotOrder(row, 'exploring').filter((e) => e.kind === 'slot').map((e) => e.id);
    // Only the four tokens in the string are placed; the rest are hidden slots.
    expect(slots).toEqual(['storyLog', 'topBar', 'composer', 'sceneStage']);
  });

  it('rule 2 (C.2): a hidden slot follows its nearest REGION_IDS predecessor, not the end', () => {
    // offers sits after storyLog in REGION_IDS; storyLog is placed, so offers
    // goes immediately after it, ahead of composer.
    const placed = REGION_IDS.filter((id) => id !== 'offers');
    const row = syntheticRow(`"${placed.join(' ')}"`, { offers: hide() });
    const order = flat(row, 'combat');
    expect(order.indexOf('(offers)')).toBe(order.indexOf('storyLog') + 1);
    expect(order[order.length - 1]).not.toBe('(offers)');
  });

  it('rule 2: hiding a region moves none of the others (a moment flip that toggles offers moves nothing else)', () => {
    const placed = REGION_IDS.filter((id) => id !== 'offers');
    const shown = flat(syntheticRow(`"${REGION_IDS.join(' ')}"`), 'exploring');
    const hidden = flat(syntheticRow(`"${placed.join(' ')}"`, { offers: hide() }), 'combat');
    expect(hidden.filter((id) => id !== '(offers)')).toEqual(shown.filter((id) => id !== 'offers'));
  });

  it('rule 2: a hidden region with no predecessor in the sequence goes first', () => {
    const row = syntheticRow('"partyStrip"', {
      topBar: hide(),
      partyStrip: { area: 'partyStrip' },
      sceneStage: hide(),
      suzuPresence: hide(),
      storyLog: hide(),
      offers: hide(),
      characterBlock: hide(),
      actionBar: hide(),
      composer: hide(),
      tableControls: hide(),
      safetyBanner: hide(),
    });
    const order = flat(row, 'exploring');
    expect(order[0]).toBe('(topBar)'); // topBar is REGION_IDS[0]: nothing precedes it
    expect(order.indexOf('partyStrip')).toBe(1);
    // Each later hidden region chains after the sequence entry before it.
    expect(order.slice(2, 4)).toEqual(['(sceneStage)', '(suzuPresence)']);
  });

  it('rule 3: a hosted region has no slot of its own and is listed with its host', () => {
    const row = syntheticRow('"topBar sceneStage"', {
      partyStrip: { area: null, host: 'topBar' },
    });
    const entries = slotOrder(row, 'exploring');
    expect(entries.find((e) => e.id === 'partyStrip')).toEqual({
      id: 'partyStrip',
      kind: 'hosted',
      host: 'topBar',
    });
    expect(entries.filter((e) => e.id === 'partyStrip')).toHaveLength(1);
  });

  it('a layer owns no DOM slot and is not listed', () => {
    const row = syntheticRow('"topBar"', { composer: { area: null, layer: true } });
    expect(slotOrder(row, 'exploring').some((e) => e.id === 'composer')).toBe(false);
  });

  it('a token that is not a region id (a typo, a future name) is ignored, never emitted', () => {
    const row = syntheticRow('"topBar notARegion"');
    expect(slotOrder(row, 'exploring').some((e) => (e.id as string) === 'notARegion')).toBe(false);
  });
});

describe('A9c C3 — slotOrder(): invariants on every real row x moment', () => {
  for (const row of LAYOUT_ROWS) {
    for (const moment of MOMENTS) {
      it(`${row.id}/${moment}: each region is listed at most once; every non-layer region exactly once`, () => {
        const ids = slotOrder(row, moment).map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of REGION_IDS) {
          const layer = getPlacement(row, id, moment).layer === true;
          expect(ids.includes(id)).toBe(!layer);
        }
      });

      it(`${row.id}/${moment}: kinds agree with the placement (slot=placed, hidden=area-less, hosted=host)`, () => {
        for (const e of slotOrder(row, moment)) {
          const p = getPlacement(row, e.id, moment);
          if (e.kind === 'hosted') expect(p.host).toBe(e.host);
          else if (e.kind === 'hidden') expect(p.area).toBeNull();
          else expect(p.area).not.toBeNull();
        }
      });
    }
  }

  it('is pure: the same inputs give the same list', () => {
    for (const row of LAYOUT_ROWS) {
      for (const moment of MOMENTS) {
        expect(slotOrder(row, moment)).toEqual(slotOrder(row, moment));
      }
    }
  });
});

describe('A9c C3 — snapshotScroll / restoreScroll (pure halves)', () => {
  /** jsdom has no layout: give an element the three numbers the code reads. */
  function scroller(parent: HTMLElement, o: { top: number; sh: number; ch: number }) {
    const el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => o.sh });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => o.ch });
    el.scrollTop = o.top;
    parent.appendChild(el);
    return el;
  }

  function shell() {
    const root = document.createElement('div');
    const slot = document.createElement('div');
    slot.setAttribute('data-region-slot', 'storyLog');
    root.appendChild(slot);
    document.body.appendChild(root);
    return { root, slot };
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('records only scrolled elements under a region slot', () => {
    const { root, slot } = shell();
    const scrolled = scroller(slot, { top: 228, sh: 800, ch: 344 });
    scroller(slot, { top: 0, sh: 800, ch: 344 });
    const outside = scroller(root, { top: 50, sh: 500, ch: 100 });
    const snap = snapshotScroll(root);
    expect(snap.map((s) => s.el)).toEqual([scrolled]);
    expect(snap.some((s) => s.el === outside)).toBe(false);
  });

  it('a mid-log position is restored to the same scrollTop after the element is reset', () => {
    const { root, slot } = shell();
    const log = scroller(slot, { top: 228, sh: 800, ch: 344 });
    const snap = snapshotScroll(root);
    log.scrollTop = 0; // what a detach + reinsert does
    restoreScroll(snap);
    expect(log.scrollTop).toBe(228);
  });

  it('an at-the-end position is restored to the END of the new box, not to the old number', () => {
    const { root, slot } = shell();
    const o = { top: 456, sh: 800, ch: 344 }; // 800 - 344 - 456 = 0: at the end
    const log = scroller(slot, o);
    const snap = snapshotScroll(root);
    expect(snap[0].atEnd).toBe(true);
    o.sh = 1100; // the new layout makes the content taller
    log.scrollTop = 0;
    restoreScroll(snap);
    expect(log.scrollTop).toBe(1100); // jsdom does not clamp; the code asked for the new end
  });

  it('within 2px of the end counts as at the end; 3px does not', () => {
    const { root, slot } = shell();
    scroller(slot, { top: 454, sh: 800, ch: 344 }); // 2px short
    scroller(slot, { top: 453, sh: 800, ch: 344 }); // 3px short
    const snap = snapshotScroll(root);
    expect(snap.map((s) => s.atEnd)).toEqual([true, false]);
  });

  it('an element that left the document is skipped, not thrown on', () => {
    const { root, slot } = shell();
    const log = scroller(slot, { top: 228, sh: 800, ch: 344 });
    const snap = snapshotScroll(root);
    log.remove();
    expect(() => restoreScroll(snap)).not.toThrow();
  });

  it('a null root snapshots nothing', () => {
    expect(snapshotScroll(null)).toEqual([]);
  });
});

/**
 * A9c C5 — the six literal DOM orders (build brief §4.1). A literal, not a
 * derivation: a derivation would move with the code it is meant to pin. Token
 * notation: `°` hidden slot (mounted, no area), `▲` overlay (anchored in
 * another region's area), `⊃(a,b)` regions hosted by the one before it. Read
 * by Iro as the tab/reading order each layout promises; the same six strings
 * are pinned against the rendered DOM in playshell.real-rows.qa.test.tsx.
 */
const ORDER_PIN: Record<string, string> = {
  'story/exploring': 'safetyBanner topBar partyStrip suzuPresence storyLog sceneStage offers composer actionBar',
  'story/combat': 'safetyBanner topBar partyStrip suzuPresence sceneStage storyLog offers° composer actionBar',
  'table/exploring':
    'safetyBanner partyStrip topBar▲ sceneStage characterBlock suzuPresence storyLog offers composer actionBar',
  'table/combat':
    'safetyBanner partyStrip topBar▲ sceneStage characterBlock suzuPresence storyLog offers° composer actionBar',
  'phone/exploring': 'safetyBanner topBar⊃(partyStrip,suzuPresence) sceneStage storyLog offers composer actionBar',
  'phone/combat': 'safetyBanner topBar⊃(partyStrip,suzuPresence) sceneStage storyLog offers° composer actionBar',
};

function formatOrder(row: LayoutRow, moment: Moment): string {
  const entries = slotOrder(row, moment);
  const hostedBy = new Map<string, string[]>();
  for (const e of entries) if (e.kind === 'hosted') hostedBy.set(e.host, [...(hostedBy.get(e.host) ?? []), e.id]);
  return entries
    .filter((e) => e.kind !== 'hosted')
    .map((e) => {
      const mark = e.kind === 'hidden' ? '°' : e.kind === 'overlay' ? '▲' : '';
      const hosted = hostedBy.get(e.id);
      return `${e.id}${mark}${hosted ? `⊃(${hosted.join(',')})` : ''}`;
    })
    .join(' ');
}

describe('A9c C5 — slotOrder() on the real rows equals the six pinned literals (§4.1)', () => {
  it('there is exactly one literal per real row x moment', () => {
    const keys = LAYOUT_ROWS.flatMap((r) => MOMENTS.map((m) => `${r.id}/${m}`));
    expect(Object.keys(ORDER_PIN).sort()).toEqual(keys.sort());
  });

  for (const row of LAYOUT_ROWS) {
    for (const moment of MOMENTS) {
      it(`${row.id}/${moment}`, () => {
        expect(formatOrder(row, moment)).toBe(ORDER_PIN[`${row.id}/${moment}`]);
      });
    }
  }
});

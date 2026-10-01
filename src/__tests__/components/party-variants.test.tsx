/**
 * A9c-2 D1 (build brief 6, Iro IMPORTANT-1) -- `partyStrip` consumes its
 * `rail` / `strip` variant. Component contract; the real-browser half is the
 * harness's check (f) (every visible `[data-party-name]` in a rail cell >= 60px).
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PartyStrip from '@/app/play/[sessionId]/regions/PartyStrip';
import PartyPanel from '@/components/PartyPanel';
import InitiativeTracker from '@/components/InitiativeTracker';
import { LAYOUT_ROWS_BY_ID, variantFor } from '@/app/play/[sessionId]/presets';
import type { CombatParticipantState, CombatState, Participant } from '@/lib/api/types';

jest.mock('../../components/Toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('../../lib/api/dnd', () => ({ bindCharacter: jest.fn(), listMyCharacters: jest.fn(() => Promise.resolve([])) }));

const member = (username: string, name: string | null, over: Partial<Participant> = {}): Participant => ({
  username,
  is_dm: false,
  character: name
    ? { character_id: `c_${username}`, name, char_class: 'Ranger', level: 4, current_hp: 27, max_hp: 34, ac: 16 }
    : null,
  ...over,
});
const PARTY = [member('kes', 'Kestrel Ashwood'), member('sable', 'Sable Voss'), member('suzu', null, { is_dm: true })];

const combatant = (id: string, name: string, active = false): CombatParticipantState => ({
  participant_id: id,
  entity_id: id,
  name,
  is_pc: id.startsWith('pc'),
  initiative: 12,
  hp_current: 5,
  hp_max: 10,
  ac: 13,
  conditions: [],
  is_alive: true,
  can_be_targeted: true,
  is_active_turn: active,
  took_turn: false,
  death_saves: { successes: 0, failures: 0, is_downed: true, is_dying: true, is_stable: false, is_dead: false },
});
const COMBAT = {
  combat_id: 'c1',
  session_id: 's1',
  round: 2,
  state: 'active',
  turn_index: 0,
  active_participant_id: 'pc1',
  initiative: ['pc1', 'm1'],
  participants: [combatant('pc1', 'Kestrel Ashwood', true), combatant('m1', 'Goblin Skulker')],
} as unknown as CombatState;

function strip(variant?: 'rail' | 'strip', over: { isDm?: boolean; combat?: boolean } = {}) {
  return render(
    <PartyStrip
      participants={PARTY}
      selfUsername="kes"
      combatState={over.combat === false ? null : COMBAT}
      onSelectMember={jest.fn()}
      isDm={over.isDm ?? false}
      sessionId="s1"
      combatIsActive
      sessionLocked={false}
      onRebindChanged={jest.fn()}
      round={2}
      selfPcId="pc1"
      variant={variant}
    />,
  );
}

describe('PartyPanel consumes its variant', () => {
  it('rail: every member name carries data-party-name, on its own element', () => {
    const { container } = render(<PartyPanel participants={PARTY} selfUsername="kes" variant="rail" />);
    expect(container.firstElementChild).toHaveAttribute('data-variant', 'rail');
    const names = [...container.querySelectorAll('[data-party-name]')].map((n) => n.textContent);
    expect(names).toEqual(['Kestrel Ashwood', 'Sable Voss', 'suzu']);
  });

  it('strip: no data-party-name (names are not a visible column), each tile carries the name as its title', () => {
    const { container } = render(<PartyPanel participants={PARTY} selfUsername="kes" variant="strip" />);
    expect(container.firstElementChild).toHaveAttribute('data-variant', 'strip');
    expect(container.querySelectorAll('[data-party-name]')).toHaveLength(0);
    expect(container.querySelector('[title="Kestrel Ashwood"]')).not.toBeNull();
    // the words stay in the DOM for AT: the member button's name still holds them
    expect(screen.getByRole('button', { name: /Kestrel Ashwood/ })).toBeInTheDocument();
  });

  it('strip: the avatar initial is aria-hidden, so the tile name starts with the name, not "KKestrel" (Iro MINOR-5)', () => {
    render(<PartyPanel participants={PARTY} selfUsername="kes" variant="strip" />);
    const tile = screen.getByRole('button', { name: /Kestrel Ashwood/ });
    expect(screen.getByRole('button', { name: /^Kestrel Ashwood/ })).toBe(tile);
    expect(tile.querySelector('[aria-hidden]')?.textContent).toBe('K');
  });

  it.each(['rail', 'strip', undefined] as const)(
    '%s: a tile\'s accessible name reads the hit points once, not "27 of 34 hit points 27/34" (Iro A9c-2 obs.)',
    (variant) => {
      render(<PartyPanel participants={PARTY} selfUsername="kes" variant={variant} />);
      // getByRole's `name` is the computed accessible name: the meter says it once, the visible
      // text is aria-hidden, so nothing reads "27/34" after "27 of 34 hit points".
      const tile = screen.getByRole('button', { name: /Kestrel Ashwood.*27 of 34 hit points\s+AC 16$/ });
      expect(screen.queryByRole('button', { name: /27\/34/ })).toBeNull();
      // the visible "27/34" is still painted for sighted users, just not announced twice
      expect(tile.querySelector('[aria-hidden="true"]:not([class*="avatar"])')?.textContent).toBe('27/34');
    },
  );

  it('unset: the original card, no variant marker', () => {
    const { container } = render(<PartyPanel participants={PARTY} selfUsername="kes" />);
    expect(container.firstElementChild).not.toHaveAttribute('data-variant');
    expect(container.querySelectorAll('[data-party-name]')).toHaveLength(0);
  });

  it('the two variants render different markup', () => {
    const rail = render(<PartyPanel participants={PARTY} selfUsername="kes" variant="rail" />).container.innerHTML;
    const stripHtml = render(<PartyPanel participants={PARTY} selfUsername="kes" variant="strip" />).container.innerHTML;
    expect(rail).not.toBe(stripHtml);
  });
});

describe('InitiativeTracker stays mounted with both live regions in both variants (R3)', () => {
  it.each(['rail', 'strip'] as const)('%s: round indicator is aria-live and the downed alert is role=alert', (variant) => {
    const { container } = render(
      <InitiativeTracker participants={COMBAT.participants} round={2} selfParticipantId="pc1" variant={variant} />,
    );
    expect(container.firstElementChild).toHaveAttribute('data-variant', variant);
    expect(screen.getByText('round 2')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('alert')).toHaveTextContent('Kestrel Ashwood is down');
    expect(screen.getAllByRole('meter').length).toBeGreaterThan(0);
  });

  it('rail marks each initiative name data-party-name (harness check f measures it); strip does not', () => {
    const rail = render(<InitiativeTracker participants={COMBAT.participants} round={2} selfParticipantId="pc1" variant="rail" />);
    // the span also holds the "you" / downed badges, so match by prefix
    const names = [...rail.container.querySelectorAll('[data-party-name]')].map((n) => n.textContent ?? '');
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/^Kestrel Ashwood/);
    expect(names[1]).toMatch(/^Goblin Skulker/);
    const chips = render(<InitiativeTracker participants={COMBAT.participants} round={2} selfParticipantId="pc1" variant="strip" />);
    expect(chips.container.querySelectorAll('[data-party-name]')).toHaveLength(0);
  });
});

describe('PartyStrip passes its variant to all three children', () => {
  it.each(['rail', 'strip'] as const)('%s: root, roster and tracker all carry it', (variant) => {
    const { container } = strip(variant);
    const root = container.querySelector('[data-region="partyStrip"]') as HTMLElement;
    expect(root).toHaveAttribute('data-variant', variant);
    expect(container.querySelectorAll(`[data-variant="${variant}"]`)).toHaveLength(3);
  });

  it('defaults to rail (the full roster the region always rendered)', () => {
    const { container } = strip(undefined);
    expect(container.querySelector('[data-region="partyStrip"]')).toHaveAttribute('data-variant', 'rail');
  });

  it('strip: a non-DM sees only their own rebind button, its name screen-reader-only', () => {
    const { container } = strip('strip');
    expect(screen.getAllByRole('button', { name: /character/i }).filter((b) => b.getAttribute('aria-label'))).toHaveLength(1);
    expect(container.querySelector('.sr-only')).not.toBeNull();
  });

  it('strip: the DM keeps one rebind button per member and the visible names to tell them apart', () => {
    const { container } = strip('strip', { isDm: true });
    expect(container.querySelectorAll('.sr-only')).toHaveLength(0);
    expect(screen.getAllByRole('button').filter((b) => /character/i.test(b.getAttribute('aria-label') ?? ''))).toHaveLength(3);
  });
});

describe('the rows place partyStrip as strip or rail (what page.tsx reads through variantFor)', () => {
  it('story: strip while exploring (the 140px band), rail in combat (the full-height column)', () => {
    expect(variantFor(LAYOUT_ROWS_BY_ID.story, 'partyStrip', 'exploring')).toBe('strip');
    expect(variantFor(LAYOUT_ROWS_BY_ID.story, 'partyStrip', 'combat')).toBe('rail');
  });
  it('table: rail; phone: strip', () => {
    expect(variantFor(LAYOUT_ROWS_BY_ID.table, 'partyStrip', 'exploring')).toBe('rail');
    expect(variantFor(LAYOUT_ROWS_BY_ID.phone, 'partyStrip', 'combat')).toBe('strip');
  });
  // The page-level wiring (page.tsx passes variantFor's answer, not a literal) is pinned in
  // play.render-matrix.real-page.test.tsx (D5).
});

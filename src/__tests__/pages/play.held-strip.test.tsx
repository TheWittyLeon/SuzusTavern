/**
 * TPK-HOLD W4 — the held strip. Every character has fallen after a DM override; the fight waits for the DM.
 *
 * Pinned: the DM's strip is the status line, then Revive…, then ONE End combat that sends exactly `tpk` and opens no chooser (the engine ends a
 * held fight as a TPK whatever is sent, so a chooser would offer untrue outcomes); everyone else gets the waiting line and no buttons; the buttons
 * are siblings of the stable role="status" node; the generic End combat and its chooser are gone while held; focus lands on the scene head when
 * the fight ends; the dialog opened from the strip offers Revive only.
 */
import fs from 'fs';
import path from 'path';
import { useEffect, useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockSubmitOverride = jest.fn();
jest.mock('../../lib/api/dnd', () => ({ submitOverride: (...a: unknown[]) => mockSubmitOverride(...a) }));

import SceneStage from '@/app/play/[sessionId]/regions/SceneStage';
import { HELD_LINE_DM, HELD_LINE_WAITING } from '@/app/play/[sessionId]/format';
import { OverrideHostFor } from '@/test-utils/OverrideHostFor';
import type { CombatParticipantState, CombatState } from '@/lib/api/types';

const mk = (id: string, name: string, hp: number, max: number, extra: Partial<CombatParticipantState> = {}): CombatParticipantState => ({
  participant_id: id, entity_id: id, name, is_pc: id.startsWith('pc'), initiative: 10, hp_current: hp, hp_max: max, ac: 12,
  conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false, ...extra,
});
const fight = (state: CombatState['state']): CombatState => ({
  combat_id: 'c1', session_id: 's1', round: 2, state, turn_index: 0, active_participant_id: null,
  initiative: ['pc-1', 'goblin-1'], participants: [mk('pc-1', 'Kestrel', 0, 34, { is_alive: false }), mk('goblin-1', 'Goblin', 7, 7)],
});

const endCalls: string[] = [];
let setChooser: ((open: boolean) => void) | null = null;

function Stage({ state = 'held', dm = true, variant }: { state?: CombatState['state'] | null; dm?: boolean; variant?: 'inline' | 'panel' | 'hero' }) {
  const headRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const beginRef = useRef<HTMLButtonElement>(null);
  const [chooser, setChooserOpen] = useState(false);
  const [live, setLive] = useState(state !== null);
  useEffect(() => { setChooser = setChooserOpen; }, []);
  const cs = fight(state ?? 'ended');
  const stage = (
    <aside data-region-slot="sceneStage">
      <SceneStage
        sceneName="The Sundered Hollow" objective="Find the source." sceneHeadRef={headRef} combatIsActive={live} activeEncounterId={null}
        sceneHasEncounter={false} combatBusy={false} endCombatBtnRef={endRef} outcomeChooserOpen={chooser} setOutcomeChooserOpen={setChooserOpen}
        lastOpenerRef={openerRef} allHostilesDown={false} anyMonsterDown onEndCombat={(o) => { endCalls.push(o); setLive(false); }}
        beginCombatRef={beginRef} onBeginEncounter={() => {}} talking={false} sessionLocked={false} rollBusy={false}
        held={state === 'held'} variant={variant} round={2}
      />
    </aside>
  );
  return dm ? <OverrideHostFor combatState={cs}>{stage}</OverrideHostFor> : stage;
}

const status = () => document.querySelector('[data-region="sceneStage"] [role="status"]') as HTMLElement;
const names = () => Array.from(document.querySelectorAll('[data-region="sceneStage"] button')).map((b) => b.textContent?.trim());

beforeEach(() => { endCalls.length = 0; jest.clearAllMocks(); });

describe('the DM sees the line and both exits', () => {
  it('the status node says it; Revive… then End combat, in that order, as siblings of the status node', () => {
    render(<Stage />);
    expect(status()).toHaveTextContent(HELD_LINE_DM);
    expect(status().textContent).not.toMatch(/The DM decides/);
    expect(names()).toEqual(['Revive…', 'End combat']);
    expect(status().querySelector('button')).toBeNull();
    const [revive, end] = Array.from(document.querySelectorAll('[data-region="sceneStage"] button'));
    expect(status().parentElement).toBe(revive.parentElement);
    expect(status().parentElement).toBe(end.parentElement);
    expect(status().compareDocumentPosition(revive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(revive.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('End combat sends exactly `tpk`, once, and opens no chooser', () => {
    render(<Stage />);
    fireEvent.click(screen.getByRole('button', { name: 'End combat' }));
    expect(endCalls).toEqual(['tpk']);
    expect(screen.queryByText('How does this fight end?')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Choose combat outcome' })).toBeNull();
  });

  it('the generic End combat (and its "choose outcome" name) is gone while held, and back when it is not', () => {
    const { rerender } = render(<Stage />);
    expect(screen.queryByRole('button', { name: /choose outcome/ })).toBeNull();
    rerender(<Stage state="active" />);
    expect(screen.getByRole('button', { name: /End combat — choose outcome/ })).toBeInTheDocument();
    expect(names()).toEqual(['End combat']);
    expect(status()).toHaveTextContent('In combat · use the action bar');
  });

  it('44px targets: both buttons carry the 44x44 classes', () => {
    render(<Stage />);
    const css = fs.readFileSync(path.join(__dirname, '../../app/play/[sessionId]/Play.module.css'), 'utf8');
    for (const cls of ['reviveBtn', 'endCombatBtn']) {
      const rule = css.match(new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`))?.[0] ?? '';
      expect(rule).toMatch(/min-height:\s*44px/);
      expect(rule).toMatch(/min-inline-size:\s*44px/);
    }
  });
});

describe('the DM strip\'s grid (the status line takes the whole width under the buttons)', () => {
  const root = () => document.querySelector('[data-region="sceneStage"]') as HTMLElement;
  it('the DM\'s held stage carries the heldDm class (inline and hero); nobody else\'s does, and neither does a running fight', () => {
    const { rerender } = render(<Stage variant="inline" />);
    expect(root().className).toMatch(/heldDm/);
    rerender(<Stage variant="hero" />);
    expect(root().className).toMatch(/heldDm/);
    rerender(<Stage dm={false} variant="inline" />);
    expect(root().className).not.toMatch(/heldDm/);
    rerender(<Stage state="active" variant="inline" />);
    expect(root().className).not.toMatch(/heldDm/);
  });

  it('the stylesheet gives it its own areas in both the strip and the hero: the note spans all three columns, the buttons keep the name\'s row', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../app/play/[sessionId]/regions/SceneStage.module.css'), 'utf8');
    for (const sel of ['\\.strip\\.heldDm', '\\.hero\\.heldDm']) {
      const rule = css.match(new RegExp(`${sel}\\s*\\{[^}]*\\}`))?.[0] ?? '';
      expect(rule).toMatch(/head end wrap/);
      expect(rule).toMatch(/note note note/);
    }
  });
});

describe('everyone else sees the waiting line and nothing to press', () => {
  it('no buttons; the longer line', () => {
    render(<Stage dm={false} />);
    expect(status()).toHaveTextContent(HELD_LINE_WAITING);
    expect(names()).toEqual([]);
  });
});

describe('the stable status node', () => {
  it('is the same DOM node across active -> held -> active (never re-created), with the buttons mounting around it', () => {
    const { rerender } = render(<Stage state="active" />);
    const before = status();
    rerender(<Stage state="held" />);
    expect(status()).toBe(before);
    rerender(<Stage state="active" />);
    expect(status()).toBe(before);
  });

  it('a chooser left open when the fight turns held is closed, and does not reopen on resume', () => {
    const { rerender } = render(<Stage state="active" />);
    act(() => setChooser!(true));
    expect(screen.getByRole('group', { name: 'Choose combat outcome' })).toBeInTheDocument();
    rerender(<Stage state="held" />);
    expect(screen.queryByRole('group', { name: 'Choose combat outcome' })).toBeNull();
    rerender(<Stage state="active" />);
    expect(screen.queryByRole('group', { name: 'Choose combat outcome' })).toBeNull();
  });
});

describe('focus', () => {
  it('after End combat the scene head has focus, never <body>', () => {
    render(<Stage />);
    const end = screen.getByRole('button', { name: 'End combat' });
    end.focus();
    fireEvent.click(end);
    expect(screen.queryByRole('button', { name: 'End combat' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('group', { name: /^Scene:/ }));
  });
});

describe('focus when the fight turns held under the DM', () => {
  it('the generic End combat held focus and is replaced: focus goes to the scene head, never <body>', () => {
    const { rerender } = render(<Stage state="active" />);
    const end = screen.getByRole('button', { name: /End combat — choose outcome/ });
    end.focus();
    expect(document.activeElement).toBe(end);
    rerender(<Stage state="held" />);
    expect(document.activeElement).toBe(screen.getByRole('group', { name: /^Scene:/ }));
  });

  it('focus that is somewhere else is left alone', () => {
    const { rerender } = render(<><input aria-label="draft" /><Stage state="active" /></>);
    const draft = screen.getByLabelText('draft');
    draft.focus();
    rerender(<><input aria-label="draft" /><Stage state="held" /></>);
    expect(document.activeElement).toBe(draft);
  });
});

describe('Revive… opens the dialog, Revive only', () => {
  it('opens on Revive with the fallen character preselected, and offers no other kind', () => {
    render(<Stage />);
    fireEvent.click(screen.getByRole('button', { name: 'Revive…' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Revive/i })).toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect((screen.getByLabelText(/^Character/) as HTMLSelectElement).value).toBe('pc-1');
    expect(screen.queryByLabelText('Actor')).toBeNull();
  });
});

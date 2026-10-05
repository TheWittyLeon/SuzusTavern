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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockSubmitOverride = jest.fn();
jest.mock('../../lib/api/dnd', () => ({ submitOverride: (...a: unknown[]) => mockSubmitOverride(...a) }));

import SceneStage from '@/app/play/[sessionId]/regions/SceneStage';
import { HELD_END_BODY, HELD_LINE_DM, HELD_LINE_WAITING } from '@/app/play/[sessionId]/format';
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

function Stage({ state = 'held', dm = true, host = false, aiTable = false, standing = false, variant, onEnd }: { state?: CombatState['state'] | null; dm?: boolean; host?: boolean; aiTable?: boolean; standing?: boolean; variant?: 'inline' | 'panel' | 'hero'; onEnd?: (o: string) => Promise<boolean | void> | void }) {
  const headRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const beginRef = useRef<HTMLButtonElement>(null);
  const [chooser, setChooserOpen] = useState(false);
  const [live, setLive] = useState(state !== null);
  useEffect(() => { setChooser = setChooserOpen; }, []);
  const cs = fight(state ?? 'ended');
  if (standing) cs.participants = [mk('pc-1', 'Kestrel', 5, 34), cs.participants[1]];
  const stage = (
    <aside data-region-slot="sceneStage">
      <SceneStage
        sceneName="The Sundered Hollow" objective="Find the source." sceneHeadRef={headRef} combatIsActive={live} activeEncounterId={null}
        sceneHasEncounter={false} combatBusy={false} endCombatBtnRef={endRef} outcomeChooserOpen={chooser} setOutcomeChooserOpen={setChooserOpen}
        lastOpenerRef={openerRef} allHostilesDown={false} anyMonsterDown onEndCombat={(o) => { endCalls.push(o); if (onEnd) return onEnd(o); setLive(false); }}
        beginCombatRef={beginRef} onBeginEncounter={() => {}} talking={false} sessionLocked={false} rollBusy={false}
        held={state === 'held' && live} canEndHeld={host} humanDmTable={!aiTable} heldStanding={standing} variant={variant} round={2}
      />
    </aside>
  );
  return dm ? <OverrideHostFor combatState={cs} isHumanDM={!aiTable}>{stage}</OverrideHostFor> : stage;
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

  it('End combat asks first, then sends exactly `tpk`, once, and opens no chooser', () => {
    render(<Stage />);
    fireEvent.click(screen.getByRole('button', { name: 'End combat' }));
    expect(endCalls).toEqual([]);
    const dialog = screen.getByRole('dialog', { name: 'End the fight?' });
    expect(dialog).toHaveTextContent(HELD_END_BODY);
    fireEvent.click(within(dialog).getByRole('button', { name: 'End the fight' }));
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
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End the fight' }));
    expect(screen.queryByRole('button', { name: 'End combat' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
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

describe('the held End combat confirm', () => {
  const confirm = () => screen.getByRole('dialog', { name: 'End the fight?' });
  const press = () => fireEvent.click(screen.getByRole('button', { name: 'End combat' }));

  it('Cancel is the default focus, and the confirm names its two buttons', async () => {
    render(<Stage />);
    press();
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(document.activeElement).toBe(within(confirm()).getByRole('button', { name: 'Keep waiting' }));
    expect(within(confirm()).getByRole('button', { name: 'End the fight' })).toBeInTheDocument();
  });

  it('Keep waiting sends nothing and returns focus to End combat', async () => {
    render(<Stage />);
    press();
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    fireEvent.click(within(confirm()).getByRole('button', { name: 'Keep waiting' }));
    expect(endCalls).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'End combat' }));
  });

  it('Escape sends nothing and returns focus to End combat', async () => {
    render(<Stage />);
    press();
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    fireEvent.keyDown(confirm(), { key: 'Escape' });
    expect(endCalls).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'End combat' }));
  });

  it('a double press of the confirm is one request', () => {
    render(<Stage />);
    press();
    const go = within(confirm()).getByRole('button', { name: 'End the fight' });
    fireEvent.click(go);
    fireEvent.click(go);
    expect(endCalls).toEqual(['tpk']);
  });

  it('does not open over the revive dialog', () => {
    render(<Stage />);
    fireEvent.click(screen.getByRole('button', { name: 'Revive…' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    // A programmatic click on the strip's button (the modal makes a real one unreachable) opens nothing.
    fireEvent.click(document.querySelector('[data-region="sceneStage"] button:last-of-type') as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'End the fight?' })).toBeNull();
    expect(endCalls).toEqual([]);
  });

  it('a held fight that resolves under an open confirm closes it', () => {
    const { rerender } = render(<Stage />);
    press();
    expect(screen.getByRole('dialog', { name: 'End the fight?' })).toBeInTheDocument();
    rerender(<Stage state="active" />);
    expect(screen.queryByRole('dialog', { name: 'End the fight?' })).toBeNull();
  });
});

describe('the session host at a Suzu-DM table (QA F3)', () => {
  it('sees the DM line and End combat, no Revive…; End asks, then sends `tpk`', () => {
    render(<Stage aiTable host />);
    expect(status()).toHaveTextContent('Every character has fallen. You can end the fight.');
    expect(status().textContent).not.toMatch(/The DM decides/);
    expect(names()).toEqual(['End combat']);
    fireEvent.click(screen.getByRole('button', { name: 'End combat' }));
    expect(endCalls).toEqual([]);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'End the fight?' })).getByRole('button', { name: 'End the fight' }));
    expect(endCalls).toEqual(['tpk']);
  });

  it('with no host and no override host: the waiting line and no buttons (a player at an AI-DM table)', () => {
    render(<Stage dm={false} host={false} />);
    expect(status()).toHaveTextContent(HELD_LINE_WAITING);
    expect(names()).toEqual([]);
  });

  it('a player whose seat is not the DM account, inside an AI-DM host, also gets nothing', () => {
    render(<Stage aiTable host={false} />);
    expect(status()).toHaveTextContent('Every character has fallen. The host can end the fight.');
    expect(names()).toEqual([]);
  });

  it('the host keeps the DM strip\'s grid class', () => {
    render(<Stage aiTable host variant="inline" />);
    expect((document.querySelector('[data-region="sceneStage"]') as HTMLElement).className).toMatch(/heldDm/);
  });
});

describe('the line at every table (a map, not a branch)', () => {
  const line = () => status().textContent?.replace(/\s*· round \d+\s*$/, '').trim();
  it.each([
    ['human table, the DM, all fallen', { }, 'Every character has fallen.'],
    ['human table, the DM, one standing', { standing: true }, 'The fight is on hold. A character is still standing.'],
    ['human table, a player, all fallen', { dm: false }, 'Every character has fallen. The DM decides what happens next.'],
    ['human table, a player, one standing', { dm: false, standing: true }, 'The fight is on hold. The DM decides what happens next.'],
    ['Suzu table, the host, all fallen', { aiTable: true, host: true }, 'Every character has fallen. You can end the fight.'],
    ['Suzu table, the host, one standing', { aiTable: true, host: true, standing: true }, 'The fight is on hold. You can end the fight.'],
    ['Suzu table, a player, all fallen', { aiTable: true, dm: true, host: false }, 'Every character has fallen. The host can end the fight.'],
    ['Suzu table, a player, one standing', { aiTable: true, dm: false, standing: true }, 'The fight is on hold. The host can end the fight.'],
  ] as const)('%s', (_n, props, want) => {
    render(<Stage {...(props as object)} />);
    expect(line()).toBe(want);
  });
});

describe('Resume… (a character still standing) takes Revive…\'s place', () => {
  it('the DM\'s strip: Resume… then End combat, no Revive…', () => {
    render(<Stage standing />);
    expect(names()).toEqual(['Resume…', 'End combat']);
  });
  it('Resume… opens the one dialog: "Resume the fight", the living character listed with their HP, no kind radios', () => {
    render(<Stage standing />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume…' }));
    const dlg = screen.getByRole('dialog', { name: 'Resume the fight' });
    expect(within(dlg).queryAllByRole('radio')).toHaveLength(0);
    expect(within(dlg).getByRole('option', { name: 'Kestrel (5 of 34 HP)' })).toBeInTheDocument();
  });
  it('the host at a Suzu-DM table with a living PC still has End combat only', () => {
    render(<Stage aiTable host standing />);
    expect(names()).toEqual(['End combat']);
  });
});

describe('the confirm: a failed request keeps it open for a retry; the end hands focus to the scene head', () => {
  it('a /end that fails (false) leaves the confirm up, says so, and the button is live again', async () => {
    let n = 0;
    render(<Stage onEnd={async () => { n += 1; return n === 1 ? false : true; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'End combat' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End the fight' })); });
    const dlg = screen.getByRole('dialog', { name: 'End the fight?' });
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Could not end the fight. Try again.');
    expect(within(dlg).getByRole('button', { name: 'End the fight' })).toBeEnabled();
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'End the fight' })); });
    expect(endCalls).toEqual(['tpk', 'tpk']);
  });

  it('the confirm awaits the request: it is busy (both buttons dead) until it settles, however the page\'s busy flag moves', async () => {
    let release!: (v: boolean) => void;
    render(<Stage onEnd={() => new Promise<boolean>((r) => { release = r; })} />);
    fireEvent.click(screen.getByRole('button', { name: 'End combat' }));
    const dlg = screen.getByRole('dialog', { name: 'End the fight?' });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'End the fight' })); });
    expect(within(dlg).getByRole('button', { name: 'Keep waiting' })).toBeDisabled();
    expect(within(dlg).getByRole('button', { name: /End the fight/ })).toBeDisabled();
    await act(async () => { release(false); });
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep waiting' })).toBeEnabled();
  });

  it('a pointer press on the confirm button (which forgets the control focus was on) still ends with focus on the scene head, never <body>', async () => {
    render(<Stage />);
    const end = screen.getByRole('button', { name: 'End combat' });
    end.focus();
    fireEvent.click(end);
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    const go = within(screen.getByRole('dialog')).getByRole('button', { name: 'End the fight' });
    fireEvent.pointerDown(go);
    await act(async () => { fireEvent.click(go); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('group', { name: /^Scene:/ }));
  });
});

describe('focus nobody lost is left alone (Kage T-1)', () => {
  it('a cold load into a held fight: nothing was focused, so nothing is moved', () => {
    render(<Stage />);
    expect(document.activeElement).toBe(document.body);
  });
  it('a user resting on <body> when the hold lifts keeps resting there', () => {
    const { rerender } = render(<Stage />);
    expect(document.activeElement).toBe(document.body);
    rerender(<Stage state="active" />);
    expect(document.activeElement).toBe(document.body);
  });
  it('a verb that was natively disabled under focus counts as taken away (the hold arriving under a focused control is rescued)', () => {
    const { rerender } = render(<Stage state="active" />);
    const end = screen.getByRole('button', { name: /End combat — choose outcome/ });
    end.focus();
    rerender(<Stage state="held" />);
    expect(document.activeElement).toBe(screen.getByRole('group', { name: /^Scene:/ }));
  });
});

describe('the round span (the phone\'s strip) is not drawn while held (Tora M-1: the two-sentence line already costs a line)', () => {
  it('held, inline: no " · round N"; running, inline: it is there', () => {
    const { rerender } = render(<Stage variant="inline" dm={false} />);
    expect(status().textContent).not.toMatch(/round/);
    rerender(<Stage variant="inline" state="active" dm={false} />);
    expect(status().textContent).toMatch(/· round 2/);
  });
});

describe('the phone\'s held strip clamps the scene NAME to one line (Aoi addendum 3, 5); a running fight\'s name wraps as it always did', () => {
  const root = () => document.querySelector('[data-region="sceneStage"]') as HTMLElement;
  const name = () => root().querySelector('p') as HTMLElement;
  it.each([['a player', { dm: false }], ['the DM', {}], ['the host at a Suzu-DM table', { aiTable: true, host: true }]] as const)('%s: held and inline: heldClamp, and the name carries its full text as `title`', (_n, props) => {
    render(<Stage variant="inline" {...(props as object)} />);
    expect(root().className).toMatch(/heldClamp/);
    expect(name()).toHaveAttribute('title', 'The Sundered Hollow');
    expect(name()).toHaveTextContent('The Sundered Hollow');
  });
  it('a running fight has neither the class nor the title; nor does a wide (panel / hero) held stage', () => {
    const { rerender } = render(<Stage state="active" variant="inline" dm={false} />);
    expect(root().className).not.toMatch(/heldClamp/);
    expect(name()).not.toHaveAttribute('title');
    rerender(<Stage variant="panel" dm={false} />);
    expect(root().className).not.toMatch(/heldClamp/);
    rerender(<Stage variant="hero" dm={false} />);
    expect(root().className).not.toMatch(/heldClamp/);
  });
  it('the stylesheet: one line, ellipsis, nothing hidden from the DOM; and the 1.2 leading hack is gone', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../app/play/[sessionId]/regions/SceneStage.module.css'), 'utf8');
    const rule = css.match(/\.strip\.heldClamp \.name\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(css).not.toMatch(/heldWatch/);
  });
});

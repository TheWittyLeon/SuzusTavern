/**
 * B8c-3 run 2 (Iro-A11y must-fix): the no-board band scrolls (six chips in three rows), so it must be a keyboard stop in EVERY engine: WebKit does not make a scroller one, so a Tab sequence on a
 * `space: null` fight never reached it and chips 5 and 6 were mouse- or touch-only (WCAG 2.1.1). `tabIndex={0}`, its name kept, and a visible `:focus-visible` ring drawn inside its box.
 * The harness's `board-band-keys` leg focuses it and presses ArrowDown in a real browser. Mutation seen red: `tabIndex={0}` removed -> the tab stop row; the ring rule removed -> the ring row.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TacticalMap from '@/components/tactical-map/TacticalMap';
import type { CombatParticipantState } from '@/lib/api/types';

const person = (id: string) => ({ participant_id: id, entity_id: id, name: `Wolf ${id}`, is_pc: false, initiative: 1, hp_current: 5, hp_max: 5, ac: 10, conditions: [], is_alive: true, can_be_targeted: true, is_active_turn: false, took_turn: false }) as unknown as CombatParticipantState;

describe('the no-board band is a keyboard-scrollable region', () => {
  it('is a tab stop (tabindex 0) that keeps its name "Combatants" and its list role', () => {
    render(<TacticalMap space={null} participants={['a', 'b', 'c'].map(person)} moveMode={false} onMove={() => {}} onExitMove={() => {}} />);
    const band = screen.getByRole('list', { name: 'Combatants' });
    expect(band).toHaveAttribute('tabindex', '0');
    expect(band).toHaveAccessibleName('Combatants');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('draws a visible focus ring inside its own box (the stage body clips what is outside)', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/components/tactical-map/TacticalMap.module.css'), 'utf8');
    const rule = /\.tomBand:focus-visible\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/outline:\s*var\(--focus-ring-width\)\s+solid\s+var\(--accent\)/);
    expect(rule).toMatch(/outline-offset:\s*calc\(-1 \* var\(--focus-ring-width\)\)/);
  });
});

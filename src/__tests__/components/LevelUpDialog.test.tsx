/**
 * LEVELUP-UX — LevelUpDialog: the two-phase level-up modal.
 *
 * Contract under test:
 *   - Confirm phase: roll-or-average radio (roll PRESELECTED per the
 *     accepted design), onConfirm carries the chosen mode, busy disables
 *     everything and announces "Rolling…" on the roll path.
 *   - The trap-violation fix that justified this component over
 *     ConfirmDialog: forward Tab from the LAST control wraps to the FIRST,
 *     which is a radio — so the radio group is always reachable.
 *   - Results phase: die value when the engine rolled, "took the average"
 *     when it didn't, gains from the sheet diff, and the Resolve-your-
 *     choices CTA exactly when choices are pending.
 *   - Esc/backdrop close (gated on !busy), phase driven purely by `result`.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import LevelUpDialog, {
  type LevelUpDialogResult,
} from '../../components/LevelUpDialog';
import type { LevelUpGain } from '../../components/LevelUpButton';

const GAIN: LevelUpGain = {
  fromLevel: 4,
  toLevel: 5,
  hpGain: 9,
  hpMax: 47,
  slotChanges: [{ level: '2', from: 0, to: 2 }],
  newFeatures: ['Extra Attack'],
  hasAsiFeature: false,
};

const STEP_ROLL: NonNullable<LevelUpDialogResult['step']> = {
  from_level: 4,
  to_level: 5,
  hp_gain: 9,
  hp_roll: 7,
  hp_mode: 'roll',
  hp_max: 47,
  new_features: ['Extra Attack'],
  newly_queued: 0,
};

function renderDialog(over: Partial<React.ComponentProps<typeof LevelUpDialog>> = {}) {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  const onResolveChoices = jest.fn();
  const utils = render(
    <LevelUpDialog
      open
      characterName="Aria"
      nextLevel={5}
      isSpellcaster={false}
      busy={false}
      result={null}
      pendingChoiceCount={0}
      onConfirm={onConfirm}
      onClose={onClose}
      onResolveChoices={onResolveChoices}
      {...over}
    />,
  );
  return { onConfirm, onClose, onResolveChoices, ...utils };
}

describe('LevelUpDialog — confirm phase', () => {
  it('renders the radio group with Roll preselected', () => {
    renderDialog();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    const roll = screen.getByRole('radio', { name: /roll for it/i });
    const average = screen.getByRole('radio', { name: /take the average/i });
    expect(roll).toBeChecked();
    expect(average).not.toBeChecked();
  });

  it('confirm carries the selected mode — default roll', () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /^yes, level up$/i }));
    expect(onConfirm).toHaveBeenCalledWith('roll');
  });

  it('confirm carries the selected mode — switched to average', () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: /take the average/i }));
    fireEvent.click(screen.getByRole('button', { name: /^yes, level up$/i }));
    expect(onConfirm).toHaveBeenCalledWith('average');
  });

  it('busy on the roll path announces Rolling… and disables everything', () => {
    const { onClose } = renderDialog({ busy: true });
    expect(screen.getByRole('button', { name: /rolling…/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /not yet/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /roll for it/i })).toBeDisabled();
    // Escape while busy: consumed but must NOT close.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape and Not-yet close while idle', () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /not yet/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('forward Tab from the last control wraps to the first (radio reachable — the ConfirmDialog trap fix)', () => {
    renderDialog();
    const confirm = screen.getByRole('button', { name: /^yes, level up$/i });
    confirm.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(screen.getByRole('radio', { name: /roll for it/i })).toHaveFocus();
  });
});

describe('LevelUpDialog — results phase', () => {
  it('shows the die roll, HP, slots and features when the engine rolled', () => {
    renderDialog({ result: { gain: GAIN, step: STEP_ROLL } });
    expect(screen.getByText(/level up! lv\.4 → lv\.5/i)).toBeInTheDocument();
    expect(screen.getByText(/the die came up/i)).toBeInTheDocument();
    expect(screen.getByText(/\+9 HP/)).toBeInTheDocument();
    expect(screen.getByText(/new spell slots: lv\.2 0→2/i)).toBeInTheDocument();
    expect(screen.getByText(/new: extra attack/i)).toBeInTheDocument();
    // No radio group in the results phase.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('says "took the average" (no die) on the average path', () => {
    renderDialog({
      result: {
        gain: GAIN,
        step: { ...STEP_ROLL, hp_roll: null, hp_mode: 'average' },
      },
    });
    expect(screen.getByText(/took the average/i)).toBeInTheDocument();
    expect(screen.queryByText(/the die came up/i)).not.toBeInTheDocument();
  });

  it('renders from the sheet diff alone on a pre-upgrade backend (step null)', () => {
    renderDialog({ result: { gain: GAIN, step: null } });
    expect(screen.getByText(/level up! lv\.4 → lv\.5/i)).toBeInTheDocument();
    expect(screen.getByText(/\+9 HP/)).toBeInTheDocument();
    expect(screen.queryByText(/the die came up/i)).not.toBeInTheDocument();
  });

  it('Done closes; no Resolve CTA when nothing is pending', () => {
    const { onClose, onResolveChoices } = renderDialog({
      result: { gain: GAIN, step: STEP_ROLL },
    });
    expect(
      screen.queryByRole('button', { name: /resolve your choices/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    expect(onClose).toHaveBeenCalled();
    expect(onResolveChoices).not.toHaveBeenCalled();
  });

  it('offers Resolve-your-choices when choices are pending and routes the CTA', () => {
    const { onResolveChoices } = renderDialog({
      result: { gain: GAIN, step: STEP_ROLL },
      pendingChoiceCount: 2,
    });
    expect(screen.getByText(/2 choices from this climb are waiting/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /resolve your choices/i }));
    expect(onResolveChoices).toHaveBeenCalled();
  });
});

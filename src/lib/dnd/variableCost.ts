// src/lib/dnd/variableCost.ts
//
// HB-P7e — variable-cost spend chooser math. Pure functions, no React, so
// CastSpellPanel's render logic stays focused on wiring and these stay
// independently unit-testable.
//
// CONTRACT GAP (2026-09-08, see the HB-P7 design doc §4-P7e and this lane's
// report): the engine's known-spells wire (`list_repertoire` /
// `_spell_wire_info`, NekoNova-DnDEngine engine/spells_msm.py) does not yet
// emit `variable_cost` at all, and separately does not emit the spell's own
// base `damage_dice` on that same payload (only on a CAST RESULT, after the
// fact — routes/combat.py). `resolveMaxSpend` below handles the two
// `max_spend` shapes the design's data contract (§5a) allows;
// `stepDicePreview`/`repeatNarrative` only ever see the STEP dice
// (`variable_cost.per_step.damage_dice`), never the spell's base dice,
// because the base isn't on the wire yet — see `previewSpend`'s doc comment
// for how the UI degrades until it is.

import type { SpellVariableCost, VariableCostMaxSpend } from '@/lib/api/types';

/** `{"pb_mult": 2}` -> PB x 2; a plain number passes through unchanged (the
 *  engine may eventually resolve `max_spend` server-side and send an int
 *  directly — §5a's contract allows either shape). */
export function resolveMaxSpend(maxSpend: VariableCostMaxSpend, proficiencyBonus: number): number {
  if (typeof maxSpend === 'number') return maxSpend;
  return proficiencyBonus * maxSpend.pb_mult;
}

/** The highest spend the character's CURRENT pool can actually afford, on a
 *  valid step boundary, never exceeding the resolved cap. `poolCurrent`
 *  null means "pool unknown" (e.g. a variable_cost spell surfaced without a
 *  spell_points block, which the engine should never do post-P7d, but the
 *  client degrades rather than crashes) — the resolved cap becomes the only
 *  ceiling. Never returns less than `baseCost`: a variable-cost spell is
 *  only castable_now (and thus ever offered) when the pool can afford at
 *  least the base cost (engine's C11 fix, design doc §4-P7e). */
export function affordableMaxSpend(
  baseCost: number,
  stepCost: number,
  resolvedMaxSpend: number,
  poolCurrent: number | null,
): number {
  const hardCap = poolCurrent == null ? resolvedMaxSpend : Math.min(resolvedMaxSpend, poolCurrent);
  if (stepCost <= 0 || hardCap <= baseCost) return baseCost;
  const steps = Math.floor((hardCap - baseCost) / stepCost);
  return baseCost + steps * stepCost;
}

/** Snaps an arbitrary raw value (from the range input's onChange) onto the
 *  nearest valid spend — a multiple of `stepCost` above `baseCost`, clamped
 *  to `[baseCost, ceiling]`. A native `<input type="range" step=...">`
 *  already only reports step-aligned values from real
 *  drag/keyboard/Home/End interaction, but this is the backstop that makes
 *  "steps land only on valid spends" (behavior spec) true regardless of
 *  how the raw value got there. */
export function snapSpend(raw: number, baseCost: number, stepCost: number, ceiling: number): number {
  if (stepCost <= 0) return baseCost;
  const clamped = Math.min(Math.max(raw, baseCost), Math.max(ceiling, baseCost));
  const steps = Math.round((clamped - baseCost) / stepCost);
  return baseCost + steps * stepCost;
}

/** How many step increments a spend represents above `base_cost`. Always
 *  clamped >= 0 — a spend below base_cost shouldn't reach here (the
 *  slider's own `min` prevents it) but this stays defensive rather than
 *  assuming the caller validated first. */
export function stepsFor(vc: SpellVariableCost, spend: number): number {
  if (vc.step_cost <= 0) return 0;
  return Math.max(0, Math.floor((spend - vc.base_cost) / vc.step_cost));
}

/** `per_step.narrative` joined once per step (the design's §4-P7e behavior
 *  spec: "per_step.narrative repeated per step") — e.g. 3 steps of "+15 ft
 *  of cone" reads "+15 ft of cone, +15 ft of cone, +15 ft of cone",
 *  mirroring the authored rule text's own "per 2 MP" phrasing rather than
 *  trying to parse and sum the geometry (the engine itself never
 *  interprets this string either — §5a). Comma-joined rather than " + "
 *  because authored narrative strings already carry their own leading
 *  "+"/"and" (§5a's own example is "+5 ft of cone") — " + " would read as
 *  a double plus. Returns null at 0 steps (base cast, nothing extra to
 *  narrate yet) or when the row has no narrative. */
export function repeatNarrative(vc: SpellVariableCost, steps: number): string | null {
  const narrative = vc.per_step?.narrative;
  if (!narrative || steps <= 0) return null;
  return Array.from({ length: steps }, () => narrative).join(', ');
}

/** The per-step damage-dice INCREMENT, formatted "+N×dice" (e.g. "+3×2d6").
 *  Deliberately not a resolved TOTAL ("12d6") — the spell's own base
 *  `damage_dice` is not on this wire payload yet (see this file's header
 *  contract-gap note), so the client can only ever show what it can prove:
 *  how much MORE this spend buys over the base. Returns null at 0 steps or
 *  when the row has no per-step dice. */
export function stepDicePreview(vc: SpellVariableCost, steps: number): string | null {
  const dice = vc.per_step?.damage_dice;
  if (!dice || steps <= 0) return null;
  return `+${steps}×${dice}`;
}

export interface SpendPreview {
  /** e.g. "Spend 8 Magic Power → +3×2d6 · +15 ft of cone + 15 ft of cone + 15 ft of cone" */
  line: string;
  /** Same content, phrased as a single sentence for a screen reader and
   *  always including the pool remaining after the spend when the pool is
   *  known (a11y section: "a polite live region announcing the resolved
   *  cost"). */
  live: string;
}

/** Builds both the visible preview line and the live-region announcement
 *  for a given spend. `poolCurrent` null when the pool is unknown (see
 *  `affordableMaxSpend`) — the remaining-pool clause is simply omitted. */
export function previewSpend(
  vc: SpellVariableCost,
  spend: number,
  resourceLabel: string,
  poolCurrent: number | null,
): SpendPreview {
  const steps = stepsFor(vc, spend);
  const dice = stepDicePreview(vc, steps);
  const narrative = repeatNarrative(vc, steps);
  const extra = [dice, narrative].filter((s): s is string => Boolean(s));
  const base = `Spend ${spend} ${resourceLabel}`;
  const line = extra.length > 0 ? `${base} → ${extra.join(' · ')}` : base;
  const remaining = poolCurrent == null ? null : poolCurrent - spend;
  const live = remaining == null ? `${line}.` : `${line}. ${remaining} ${resourceLabel} remaining.`;
  return { line, live };
}

/** `spell_points.label` when present and non-empty, else the generic
 *  fallback — never a hardcoded "MP" (HB-P7e behavior spec). */
export function resourceLabelFor(label: string | undefined | null): string {
  return label && label.trim().length > 0 ? label : 'points';
}

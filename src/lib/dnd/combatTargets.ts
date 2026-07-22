// src/lib/dnd/combatTargets.ts
//
// F2/CAST-DEAD-TARGET (WF-TAV-AUDIT-BATCH-2026-07-22 Pass P) — shared
// "living targetable participant" predicate, reused by both the Attack rail
// (play/[sessionId]/page.tsx's `targetableFoes`) and the Cast panel's own
// target picker (CastSpellPanel.tsx's `targets` memo), which layers a
// heal-downed-ally exception on TOP of the same base rule rather than
// re-deriving it.
//
// Wire facts (engine/combat.py::build_combat_state, verified by read):
//   is_alive        = Participant.is_active (false = dead or fled)
//   can_be_targeted = is_alive && hp_current > 0
// A monster killed at 0 HP goes is_active=False IMMEDIATELY (it never
// lingers at 0 HP with is_active still true) — only a PC can be "downed but
// alive" (0 HP, is_alive still true, tracked via death saves). So a
// downed-but-targetable-for-healing participant is, by construction, always
// a PC (ally or self), never a monster.
import type { CombatParticipantState } from '@/lib/api/types';

/** Base rule: a living, standing participant is always a legal default
 *  target regardless of caster/attacker context. */
export function isLivingTargetable(p: CombatParticipantState): boolean {
  return p.is_alive && p.can_be_targeted;
}

/** Attack rail (page.tsx's `targetableFoes`): enemies only, living, targetable. */
export function isLivingTargetableFoe(p: CombatParticipantState): boolean {
  return !p.is_pc && isLivingTargetable(p);
}

/**
 * Cast panel target picker: spell-kind-aware, NOT a blunt Attack mirror.
 *   - a living/standing participant (ally or foe) is always kept;
 *   - a downed (0-HP, still alive) participant is kept ONLY when the
 *     selected spell heals AND the participant is a PC (ally/self) — never
 *     a downed enemy (structurally always dead already per the header
 *     comment, but guarded explicitly rather than relying on that);
 *   - a genuinely-dead participant (`is_alive: false`) is excluded from
 *     every spell, healing included — Cure Wounds doesn't raise the dead,
 *     that's Revivify's job, not this panel's.
 */
export function isCastableCombatTarget(
  p: CombatParticipantState,
  healSpellSelected: boolean,
): boolean {
  if (isLivingTargetable(p)) return true;
  if (!healSpellSelected) return false;
  if (!p.is_pc) return false;
  return p.is_alive;
}

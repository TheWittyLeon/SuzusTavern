'use client';
/**
 * Character creation wizard — /character/new (ST-047–052, S2.4).
 *
 * Race/class/background lists are fetched LIVE from the engine catalog via
 * GET /api/dnd/catalog (useCatalog hook). The hardcoded srd.ts mirror has been
 * deleted (S2.4). If the catalog fetch fails, the wizard shows an error/retry
 * state — it does not fall back to a hardcoded list.
 *
 * 6 steps for a non-caster: Race → Class → Abilities (27-point buy) →
 * Background → Equipment → Review. A CASTER class (wizard/cleric/sorcerer/…,
 * gated on WizardClass.isCaster — data-driven off the class row's own
 * spellcasting block, see helpers.ts's casterKindFromSpellcasting,
 * TAV-WIZARD-HOMEBREW-CASTERS) gets a 7th "Spells" step inserted between
 * Equipment and Review (T4/DDX-11t). TAV-WIZARD-HOMEBREW-CASTERS also
 * inserts Subclass/Rung steps right after Class — see buildSteps.
 *
 * ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP (2026-09-08): a class's own skill
 * PROFICIENCY choice (`skill_choices`/`skill_count`, distinct from the
 * Subclass/Rung archetype menus above) gets a "Skills" step inserted right
 * after Background, gated on `WizardClass.skillCount > 0` (hasSkillsStep —
 * see buildSteps). Its option pool is background-DEPENDENT (excludes
 * whatever the chosen background already grants, mirroring the engine's own
 * RAW "duplicate skill lets you pick another from the class list" rule), so
 * it renders after Background rather than alongside Subclass/Rung. Unlike
 * Subclass/Rung, a class with a Skills step does NOT necessarily need the
 * early silent-create — see needsSilentCreate's own doc comment for why.
 *
 * Equipment (2026-07-24 Starting Equipment design) sits after Background (a
 * background contributes its own gear package) and before Spells (so the
 * caster silent-create — see below — fires with equipment_selections already
 * collected). It applies to EVERY class, caster or not. On entering the step
 * the wizard fetches GET /api/dnd/starting-equipment?class=&background= (no
 * character required — a pure function of class+background) and renders each
 * package's fixed grants read-only plus one radio group per choice, defaulted
 * to each choice's first option so a player who breezes through still gets
 * valid gear. A failed fetch degrades gracefully (allow proceeding — creation
 * just goes gearless, matching the engine's fail-open/no-selections-sent
 * no-op contract) rather than hard-blocking Continue.
 *
 * TAV-CREATE-SUBRACE-ASI-PICKER: the Race step grows two optional inline
 * sub-pickers once a race is chosen — a subrace radiogroup (any race whose
 * catalog subraces are non-empty, e.g. Elf) and/or Half-Elf's floating
 * "+1 to two other abilities" checkbox group. Both are required (gate
 * Continue) when applicable; see canContinue/canCreatePrereqs.
 *
 * Most choices are held in local React state and POSTed once, at Review's
 * final "Begin your campaign" — POST /api/dnd/characters (ST-052). The
 * engine validates race/class and the point-buy spread server-side and
 * applies racial bonuses — we POST the BASE (pre-racial) scores; the review
 * preview applies bonuses locally only for display, mirroring the engine so
 * what you see equals what gets saved.
 *
 * Spells are the ONE exception to "only POSTed at Review": the engine has no
 * pre-create spell-selection endpoint — GET /spells/{id}/available (the
 * server-computed pool + budget) requires a real character_id (verified by
 * reading NekoNova-DnDEngine's routes/spells.py + engine/spells_msm.py: every
 * spell route is character-scoped, and CharacterCreateRequest has no spells/
 * cantrips field for the engine to consume even if we wanted to send one).
 * So for a caster, the character is created SILENTLY when leaving the
 * Equipment step (Continue → Spells) rather than at Review — by then
 * equipment_selections are collected, so the silent create's payload carries
 * real starting gear too. The Spells step then fetches the real pool/budget
 * for that just-created character via getAvailableSpells, same hop the
 * shipped sheet Spells tab (SpellbookPanel) uses. Review still reads as the
 * final look (now including the spells you picked) and "Begin your campaign"
 * still does exactly one thing per path:
 * non-caster → create the character; caster → the character already exists,
 * so this batch-applies the picks via learnSpell/prepareSpell (sequential,
 * best-effort — a failed pick surfaces a toast but does not block navigating
 * to the new sheet, since the character itself was already created).
 *
 * Edit-after-create fix (F7/TAV-CREATE-EDIT-NOT-RETRO): changing race/
 * subrace/abilities/background/name AFTER a caster's character has been
 * silently created used to be silently dropped — the silent create is a
 * POST, and no character PATCH endpoint exists engine-side (verified
 * against NekoNova-DnDEngine's routes/characters.py). Since there is nothing
 * to PATCH, `handleSubmit` instead snapshot-compares the fields the silent
 * create actually persisted (`createdSnapshot`) against the live wizard
 * state at final submit; on any drift it recreates a fresh character with
 * the CURRENT fields, reapplies the spell picks to the new id, and only
 * THEN soft-deletes the stale one (create-first ordering — never deletes
 * before the replacement create has succeeded; a failed recreate aborts and
 * deletes nothing). Changing CLASS after creation takes the simpler existing
 * path: it invalidates the stale character (and its picks) outright via the
 * effect below, so Review never POSTs spells against the wrong class.
 *
 * Accessibility:
 *  - Race/Class/Background are native <input type="radio"> grids.
 *  - Focus moves to the step heading on each step change (not on first mount).
 *  - Point-buy steppers have explicit aria-labels; the budget is an aria-live region.
 *  - "Continue" is disabled until the step's required selection is made.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useAuthGate } from '@/lib/auth/useAuthGate';
import {
  createCharacter,
  deleteCharacter,
  getAvailableSpells,
  getCatalog,
  getCharacterSheet,
  getFeaturePicks,
  getStartingEquipment,
  learnFeaturePick,
  learnSpell,
  prepareSpell,
  resolveLevelChoice,
} from '@/lib/api/dnd';
import { useCatalog } from '@/lib/dnd/useCatalog';
import { raceSpeedLabel, spellComponentsLabel, spellLevelLabel } from '@/lib/dnd/codex';
import { useWizardCommentary } from '@/lib/dnd/useWizardCommentary';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Card from '@/components/Card';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import Icon from '@/components/Icon';
import SuzuDM from '@/components/SuzuDM';
import Waveform from '@/components/Waveform';
import { useToast } from '@/components/Toast';
import CodexDetailModal from '@/app/codex/CodexDetailModal';
import {
  ABILITIES,
  DEFAULT_SCORES,
  POINT_BUY_BUDGET,
  POINT_BUY_MAX,
  POINT_BUY_MIN,
  SUZU_LINES,
  WIZARD_LEVEL1_SPELLBOOK_SIZE,
  abilityAbbrLabel,
  abilityDisplayName,
  applyRacialBonuses,
  costFor,
  derivedStats,
  formatMod,
  hasBackgroundBlurb,
  humanizeSkill,
  normalizeSkillOptions,
  normalizeSkillSlug,
  pointsRemaining,
  type AbilityKey,
  type AbilityScores,
} from '@/lib/dnd/helpers';
import { indefiniteArticle } from '@/lib/text/indefiniteArticle';
import { extractReason, engineErrorMessage, isApiError } from '@/lib/dnd/engineError';
import {
  catalogItemToSubclass,
  subclassesForClass,
  type WizardRace,
  type WizardClass,
  type WizardBackground,
  type WizardSubclass,
  type WizardRungMenu,
} from '@/lib/dnd/catalog';
import type {
  ApiError,
  AvailableSpellEntry,
  AvailableSpellsResult,
  CatalogItem,
  CatalogSpellData,
  EquipmentSelection,
  FeatureChoiceOption,
  StartingEquipmentResult,
} from '@/lib/api/types';
import styles from './CharacterCreate.module.css';

// dnd5e — the only system this wizard drives today (matches useCatalog.ts's
// own SYSTEM constant and LevelChoicePicker's).
const SYSTEM = 'dnd5e';

type StepKey =
  | 'race'
  | 'class'
  | 'subclass'
  | 'rung'
  | 'abilities'
  | 'background'
  | 'skills'
  | 'equipment'
  | 'spells'
  | 'review';

interface StepMeta {
  key: StepKey;
  t: string;
  heading: string;
  intro: string;
}

// Base 6 steps, always present (Equipment applies to every class — see the
// module doc comment). "Spells" (T4/DDX-11t) is spliced in between Equipment
// and Review — ONLY for a caster class — by buildSteps below, so the kicker
// ("Step N of TOTAL") and every index-sensitive bit of UI derives from the
// built array's length/position rather than a hardcoded "of 6".
const BASE_STEPS: readonly StepMeta[] = [
  {
    key: 'race',
    t: 'Race',
    heading: 'Who, broadly speaking, are you?',
    intro:
      'Race shapes the small things — how tall you are, what you can see in the dark, what languages you know without thinking. Pick one. You can come back.',
  },
  {
    key: 'class',
    t: 'Class',
    heading: 'And what do you do when things go sideways?',
    intro: 'Class is the verb. Sneak, smite, study, summon, sing. Pick your verb.',
  },
  {
    key: 'abilities',
    t: 'Abilities',
    heading: 'How are you wired?',
    intro:
      'Point-buy. 27 points. Every score starts at 8; raising it costs more the higher you go. Racial bonuses come after.',
  },
  {
    key: 'background',
    t: 'Background',
    heading: 'Where did you come from?',
    intro:
      'Background gives Suzu something to needle you about for forty sessions. Pick one. Tell her your name.',
  },
  {
    key: 'equipment',
    t: 'Equipment',
    heading: 'What did you bring?',
    intro:
      "Your class and background both chip in gear. Some of it's fixed; some of it you choose. Suzu already picked the first option for everything — change your mind wherever you like.",
  },
];

const SPELLS_STEP: StepMeta = {
  key: 'spells',
  t: 'Spells',
  heading: 'What do you already know?',
  intro:
    "Cantrips you can always call on; a handful of first-level spells to start. Suzu created your sheet a step early so she could show you the real list — not a guess.",
};

const REVIEW_STEP: StepMeta = {
  key: 'review',
  t: 'Review',
  heading: 'Sound about right?',
  intro: "A last look. Once you confirm, Suzu writes it down. (She doesn't forget.)",
};

// TAV-WIZARD-HOMEBREW-CASTERS — inserted right after Class, gated on
// `WizardClass.subclassLevel === 1` (data-driven — replaces the sheet-only
// LevelChoicePicker path for the six classes that pick an archetype at
// level 1: bard/cleric/sorcerer/warlock get it post-create today; this adds
// three homebrew casters and, per the design doc's flagged side effect,
// SRD cleric/sorcerer/warlock now ALSO get it at creation instead of
// leaving it as a post-create sheet nag).
const SUBCLASS_STEP: StepMeta = {
  key: 'subclass',
  t: 'Archetype',
  heading: 'And which path do you follow?',
  intro:
    'Some classes fork early — a school, a domain, an order, a bloodline. Pick yours now; it shapes what you can do from level one.',
};

// Inserted after Subclass, gated on `WizardClass.rungMenu.knownAtLevel1 > 0`
// (§3 of the design — Rung MUST come after Subclass so archetype-scoped
// options are resolvable; see the design's engine fact 4).
const RUNG_STEP: StepMeta = {
  key: 'rung',
  t: 'Techniques',
  heading: 'What do you already know how to do?',
  intro:
    "Your archetype comes with its own starting menu. Pick from what your path allows — you'll unlock more as you climb.",
};

// ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP (2026-09-08) — inserted right after
// Background, gated on `WizardClass.skillCount > 0` (hasSkillsStep). Placed
// AFTER Background (not before, unlike Subclass/Rung's placement after
// Class) because its own option pool is background-DEPENDENT — the engine
// excludes whatever the background already granted, and this step mirrors
// that client-side, so the background must already be chosen by the time
// this renders.
const SKILLS_STEP: StepMeta = {
  key: 'skills',
  t: 'Skills',
  heading: 'What are you actually good at?',
  intro:
    "Your class grants its own skill proficiencies, on top of your background's. Pick from what's left on the list.",
};

/** TAV-WIZARD-HOMEBREW-CASTERS — generalized from a bare `isCaster` boolean
 *  to the four independent, data-driven gates (`isCaster`/`hasSubclassStep`/
 *  `hasRungStep`/`hasSkillsStep`) each step now has. Order is fixed: Race,
 *  Class, [Subclass], [Rung], Abilities, Background, [Skills], Equipment,
 *  [Spells], Review — Subclass/Rung/Skills all render well before their
 *  actual resolveLevelChoice calls fire (Equipment→next for a class that
 *  needs the early silent create, or Review's final submit otherwise — see
 *  needsSilentCreate/applyPendingSetup), same deferred-POST idiom as every
 *  other early-picked field (see the design's §"What I changed from a
 *  literal reading" item 1). */
function buildSteps(flags: {
  isCaster: boolean;
  hasSubclassStep: boolean;
  hasRungStep: boolean;
  hasSkillsStep: boolean;
}): StepMeta[] {
  const [race, cls, abilities, background, equipment] = BASE_STEPS;
  const steps: StepMeta[] = [race, cls];
  if (flags.hasSubclassStep) steps.push(SUBCLASS_STEP);
  if (flags.hasRungStep) steps.push(RUNG_STEP);
  steps.push(abilities, background);
  if (flags.hasSkillsStep) steps.push(SKILLS_STEP);
  steps.push(equipment);
  if (flags.isCaster) steps.push(SPELLS_STEP);
  steps.push(REVIEW_STEP);
  return steps;
}

// ── F7/TAV-CREATE-EDIT-NOT-RETRO — snapshot-compare-and-recreate ──────────────
// The `createdSnapshot` state (below, in the component) captures exactly the
// fields `createNow` persisted for a silently-created caster character.
// `handleSubmit` diffs the LIVE wizard state against it at final submit —
// this is a plain field comparison, not a re-derivation from catalog objects
// (which could reorder/refetch), so it's cheap and exact.
interface CreatedSnapshot {
  name: string;
  race: string;
  subrace: string | undefined;
  halfElfAsi: AbilityKey[];
  background: string;
  scores: AbilityScores;
  /** 2026-07-24 Starting Equipment design §5.3 — canonicalized
   *  `{choiceId: optionId}` selections (see canonicalizeEquipmentSelections),
   *  so a post-silent-create equipment change is caught by snapshotsEqual the
   *  same way a race/background edit already is. */
  equipment: string;
}

/**
 * Order-independent, stable string form of an equipment-selections map — two
 * Records with the same entries in a different insertion order must compare
 * equal (mirrors halfElfAsi's own sort-before-compare for the same reason).
 */
function canonicalizeEquipmentSelections(sel: Record<string, string>): string {
  return Object.keys(sel)
    .sort()
    .map((choiceId) => `${choiceId}=${sel[choiceId]}`)
    .join('|');
}

function abilityScoresEqual(a: AbilityScores, b: AbilityScores): boolean {
  return (
    a.strength === b.strength &&
    a.dexterity === b.dexterity &&
    a.constitution === b.constitution &&
    a.intelligence === b.intelligence &&
    a.wisdom === b.wisdom &&
    a.charisma === b.charisma
  );
}

function snapshotsEqual(a: CreatedSnapshot, b: CreatedSnapshot): boolean {
  return (
    a.name === b.name &&
    a.race === b.race &&
    (a.subrace ?? '') === (b.subrace ?? '') &&
    a.background === b.background &&
    a.halfElfAsi.length === b.halfElfAsi.length &&
    a.halfElfAsi.every((k, i) => k === b.halfElfAsi[i]) &&
    abilityScoresEqual(a.scores, b.scores) &&
    a.equipment === b.equipment
  );
}

/**
 * Kuro-Sec C1 (Cluster C security verdict — MANDATORY, do not deviate): a
 * learn/prepare rejection during the create-first recreate's spell
 * reapplication only "doesn't count" as a real failure when the ENGINE'S OWN
 * reason says the spell is already known/prepared. Never on HTTP status
 * alone, never on "any 4xx", never on `err.code` (which is just the
 * stringified HTTP status here — see src/lib/api/client.ts's apiFetch: `code`
 * only becomes a real machine string when the body carries `error`/`code`,
 * which the engine's spell routes don't — the reason lives at
 * `err.body.data.reason`). Every other reason/status — 401 actor_required,
 * 404 not_found, and the six other 400 business reasons (unknown_spell,
 * not_on_class_list, spell_level_too_high, over_cantrip_limit,
 * over_known_limit, over_spellbook_limit, not_a_learning_caster) — must
 * surface as a real failure.
 */
function isAlreadyKnownRejection(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  const body = (reason as ApiError).body;
  if (!body || typeof body !== 'object') return false;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return false;
  return (data as { reason?: unknown }).reason === 'already_known';
}

/**
 * TAV-WIZARD-HOMEBREW-CASTERS (Kage-CR review round 2) — curated copy for the
 * subclass-resolve and rung-learn refusal reasons, passed to
 * `engineErrorMessage` (lib/dnd/engineError.ts) rather than a hand-rolled
 * body-shape probe. `already_chosen`/`duplicate_option` are ALSO handled as
 * idempotent successes before either apply loop ever reaches an error path
 * (see applyPendingSetup) — kept here too as the honest fallback copy for
 * the case that reasoning doesn't apply (e.g. a genuinely-repeated attempt
 * that still somehow surfaces the reason as a hard refusal upstream).
 * Subclass-resolve reasons mirror LevelChoicePicker.tsx's own
 * RESOLVE_REFUSAL_COPY (one curated vocabulary for both surfaces); rung ones
 * are `learnFeaturePick`'s own documented refusal set (dnd.ts).
 */
const SETUP_REASON_MAP: Record<string, string> = {
  // resolveLevelChoice('subclass:1', …)
  choice_not_found: 'That choice is no longer pending — reload to see the current state.',
  invalid_subclass: "That archetype isn't available for this class.",
  already_chosen: 'That archetype is already set.',
  not_owner: "That's not your character.",
  // learnFeaturePick
  not_freeform: "This class's menu isn't set up for creation-time picks yet.",
  wrong_subclass: 'That technique belongs to another archetype.',
  unknown_option: "That technique isn't recognized — try again from the sheet.",
  option_level_unmet: 'That technique needs a higher level.',
  duplicate_option: 'That technique is already known.',
  over_menu_cap: "You've already picked the maximum for this menu.",
};

/**
 * ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP (2026-09-08) — curated copy for
 * resolveLevelChoice('skills:1', …) refusals, kept SEPARATE from
 * SETUP_REASON_MAP: `duplicate_option`/`unknown_option` are both reused by
 * that map's rung-learn wording ("That technique…"), which would be wrong
 * copy for a skill pick. `already_chosen` isn't a reason
 * `_resolve_skills_choice` actually emits (NekoNova-DnDEngine
 * engine/commands/character_msm.py has no such branch there today) but is
 * still checked for as an idempotent-success case in applyPendingSetup, the
 * same defense-in-depth the subclass branch already applies.
 */
const SKILLS_REASON_MAP: Record<string, string> = {
  choice_not_found: 'That choice is no longer pending — reload to see the current state.',
  invalid_skills_choice: "That selection doesn't match what's required.",
  duplicate_option: 'One of those skills is already yours (from your background).',
  unknown_option: "That isn't one of this class's skill choices.",
  not_owner: "That's not your character.",
};

const GENERIC_CREATE_ERROR =
  "Suzu couldn’t write that down. Check your choices and try again in a moment.";

/**
 * TAV-CREATE-DEADEND-DIAGNOSABLE: best-effort human-readable message for a
 * failed createNow() call, replacing the old always-generic string. The
 * engine's own error wire shape (NekoNova-DnDEngine routes/characters.py's
 * `_err()`) is `{success: false, message: <human string>, data: {reason?}}`
 * — `err.body.message` IS the engine's own explanation of what was rejected
 * (e.g. an invalid race/subrace/ASI combination), already written to be
 * shown to a player. Kage-CR review round 2: delegates to
 * `engineErrorMessage` (lib/dnd/engineError.ts) rather than reading
 * `body.message` raw — that raw read let the engine's `[DnD] ` subsystem
 * prefix leak into player-facing copy, and never withheld a 5xx's message
 * (a network/stack-adjacent "Internal server error" string) the way
 * engineErrorMessage's business-4xx-only gate does. No reasonMap: creation
 * failures are too varied (race/subrace/ASI/background/equipment combos)
 * for a fixed vocabulary — the engine's own cleaned message is still the
 * best available copy, same as before this fix, just laundered.
 */
function describeCreateError(err: unknown): string {
  // TAV-WIZARD-429-HANG: a limiter 429 is checked before delegating to
  // engineErrorMessage — the rate limiter's wire body
  // ({error:'rate_limited', retry_after}) carries no `message`, and 429 is
  // deliberately outside engineError.ts's BUSINESS_4XX_STATUSES (that set is
  // curated for the engine's own creation-refusal copy, not the limiter), so
  // without this early return a limiter refusal would fall through to
  // GENERIC_CREATE_ERROR and blame the player's picks. Covers both a direct
  // 429 and client.ts's refresh_unavailable throw (which carries the refresh
  // attempt's real 429 status).
  if (isApiError(err) && err.status === 429) {
    return 'Too many requests in a short window. Your choices are fine — wait a few seconds, then press Continue again.';
  }
  return engineErrorMessage(err, { fallback: GENERIC_CREATE_ERROR });
}

/**
 * TAV-WIZARD-HOMEBREW-CASTERS — "N noun[s]" phrasing, shared between
 * RungStep's own cap-hint/budget copy and the nav `continueHint` below
 * (Iro-A11y MINOR-1: one canonical pluralizer instead of two copies
 * drifting apart). Naive "+s" suffix — a label that's already plural on the
 * wire (e.g. a hypothetical "Techniques") would double-pluralize at n>1;
 * flagged, not fixed (MINOR severity), every verified homebrew menu label
 * today ("Path Technique", "Magic Rung") is singular.
 */
function countedLabel(label: string, n: number): string {
  return `${n} ${n === 1 ? label : `${label}s`}`;
}

// ── Suzu commentary for the abilities step (ST-053 v1) ─────────────────────────
function abilitiesComment(scores: AbilityScores): string {
  if (scores.charisma <= 8) return 'Charisma of 8. Suzu approves of honesty.';
  let topKey: AbilityKey = 'strength';
  let topVal = -1;
  for (const a of ABILITIES) {
    if (scores[a.key] > topVal) {
      topVal = scores[a.key];
      topKey = a.key;
    }
  }
  const top = ABILITIES.find((a) => a.key === topKey)!;
  if (topVal >= 15) return `Leaning hard on ${top.name}. Suzu will find a door that needs it.`;
  return 'Whatever you spend on charisma will be tested first.';
}

export default function CharacterNewPage(): ReactNode {
  const { user, retryAuth } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const catalog = useCatalog();

  const [step, setStep] = useState(0);
  const [race, setRace] = useState<string | null>(null);
  // TAV-CREATE-SUBRACE-ASI-PICKER — subrace display name (e.g. "Wood Elf"),
  // POSTed verbatim; Half-Elf's floating "+1 to two other abilities" (the
  // +2 CHA is automatic, engine-applied). Both reset whenever `race` changes
  // (see the effect below).
  const [subrace, setSubrace] = useState<string | null>(null);
  const [halfElfAsi, setHalfElfAsi] = useState<AbilityKey[]>([]);
  const [cls, setCls] = useState<string | null>(null);
  const [scores, setScores] = useState<AbilityScores>({ ...DEFAULT_SCORES });
  const [background, setBackground] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // T4/DDX-11t — set the moment a caster's character is silently created
  // (leaving Background → Spells); reused unchanged by Review's final submit.
  // A class change invalidates it (see the effect below) so Review never
  // POSTs spell picks against a character created for a different class.
  const [characterId, setCharacterId] = useState<string | null>(null);
  // F7/TAV-CREATE-EDIT-NOT-RETRO — see the module-level CreatedSnapshot
  // comment above. Set the moment the silent create succeeds; reset
  // alongside characterId whenever a class change invalidates it.
  const [createdSnapshot, setCreatedSnapshot] = useState<CreatedSnapshot | null>(null);
  const [spellCantrips, setSpellCantrips] = useState<Set<string>>(new Set());
  const [spellLeveled, setSpellLeveled] = useState<Set<string>>(new Set());
  // TAV-SPELLSTEP-CAP-MSG: the required pick counts SpellsStep reports after
  // its catalog fetch — null until reported (or on fetch error) = fail-open.
  const [spellReq, setSpellReq] = useState<{
    cantripsNeeded: number;
    leveledNeeded: number;
  } | null>(null);

  // 2026-07-24 Starting Equipment design — {choiceId: optionId}, one entry per
  // EquipChoice group across both the class and background packages. Defaults
  // to each choice's first option the moment the Equipment step's fetch
  // resolves (EquipmentStep's effect calls setEquipmentSelections). `ready`
  // choiceIds/loadState mirror what the LAST successful/failed fetch found —
  // used both to gate this step's Continue and to decide whether createNow
  // sends equipment_selections at all (omitted entirely on a failed fetch, so
  // the engine's own no-selections-sent no-op gate keeps that path gearless,
  // exactly like today).
  const [equipmentSelections, setEquipmentSelections] = useState<Record<string, string>>({});
  const [equipmentChoiceIds, setEquipmentChoiceIds] = useState<string[]>([]);
  const [equipmentLoadState, setEquipmentLoadState] = useState<'loading' | 'ok' | 'error'>(
    'loading',
  );

  // ── TAV-WIZARD-HOMEBREW-CASTERS — Subclass step ─────────────────────────────
  // Fetched once whenever a class with subclassLevel===1 is selected (own
  // `type=subclass` catalog fetch — races/classes/backgrounds arrive via
  // useCatalog, but subclasses don't, same reason LevelChoicePicker's own
  // SubclassChoiceCard fetches separately). `selectedSubclass` is the chosen
  // subclass SLUG, pure local state at pick time — resolved server-side only
  // once the silent create fires (§4 of the design).
  const [selectedSubclass, setSelectedSubclass] = useState<string | null>(null);
  const [subclassOptions, setSubclassOptions] = useState<WizardSubclass[]>([]);
  const [subclassLoadState, setSubclassLoadState] = useState<'loading' | 'ok' | 'error'>(
    'loading',
  );
  // Kage-CR IMPORTANT-2: the fetch effect's deps ([hasSubclassStep,
  // clsObj?.name]) never change on a plain back/forward — a real retry
  // needs its own counter to bump, same SubclassChoiceCard/SpellChoiceCard
  // convention as LevelChoicePicker.tsx's loadKey.
  const [subclassLoadKey, setSubclassLoadKey] = useState(0);

  // ── TAV-WIZARD-HOMEBREW-CASTERS — Rung step ─────────────────────────────────
  // No live fetch — `feature_choices[0].options` already rode in on the class
  // catalog item (see WizardClass.rungMenu). Picked slugs, pure local state.
  const [rungPicks, setRungPicks] = useState<Set<string>>(new Set());

  // ── ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP — Skills step ──────────────────────
  // No live fetch — the class's own skill_choices pool rode in on the class
  // catalog item (see WizardClass.skillChoices). Picked skill slugs, pure
  // local state; pruned whenever the OPTION POOL this depends on changes
  // (class OR background — see the reset effects below), since a stale pick
  // that overlaps a since-changed background would otherwise silently eat
  // the pick budget without ever rendering as a checked box.
  const [skillPicks, setSkillPicks] = useState<Set<string>>(new Set());

  // ── TAV-WIZARD-HOMEBREW-CASTERS — silent-create batch apply state ──────────
  // `subclassDone`/`rungDone` track whether THIS character's post-create
  // resolveLevelChoice/learnFeaturePick calls have fully succeeded — reset
  // alongside characterId whenever a class change (or an F7 recreate-on-drift)
  // invalidates the character they applied to. `setupIssues` is the
  // "resume, not dead-end" state: survives through Spells/Review so the
  // player is never stuck — Review renders it as a persistent callout with a
  // retry action.
  const [subclassDone, setSubclassDone] = useState(false);
  const [rungDone, setRungDone] = useState(false);
  const [skillsDone, setSkillsDone] = useState(false);
  const [setupIssues, setSetupIssues] = useState<string[]>([]);
  const [retryingSetup, setRetryingSetup] = useState(false);
  // Iro-A11y MINOR-4: a repeated identical failure re-renders the SAME
  // issue strings — role="alert" only re-announces on a text CHANGE, so a
  // content-identical re-fail would silently not re-announce. Appended to
  // the callout title once >0 so the alert's text content genuinely
  // differs attempt to attempt.
  const [retryAttempt, setRetryAttempt] = useState(0);
  // Kage-CR follow-up (2026-09-08): true from the moment a final-submit
  // (handleSubmit) apply attempt is blocked by a setup issue until either a
  // successful "Retry setup" or a class change clears it. handleRetrySetup
  // reads this to decide whether a clean retry should FINISH the submit the
  // player already tried (navigate straight to the sheet) or just clear the
  // callout (the ordinary early-create-then-still-browsing-Review case,
  // where the player never clicked "Begin your campaign" at all).
  const [awaitingSubmitRetry, setAwaitingSubmitRetry] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRetryRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);

  const username = user?.username ?? null;

  // Move focus to the step heading on step change — but not on first mount.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  // TAV-AUDIT-401-DEADEND — a CONFIRMED dead session is an auth problem, so
  // hand it to the component that already knows how to present one. Asking
  // AuthProvider to re-verify makes it set `authError`, and `useAuthGate`
  // (which runs BEFORE the catalog branches below) then renders the real
  // SessionExpired prompt instead of a connection error the user cannot act on.
  //
  // Why re-verify rather than assert "expired" from here: this page saw ONE
  // endpoint 401. AuthProvider asking `/auth/me` is what distinguishes "the
  // session is dead" from "that endpoint refused me" — and if the session
  // turns out to be fine, nothing changes and the page keeps its own error
  // state. Not a login attempt, so it cannot trip the IP-global login limiter.
  //
  // Fires at most once per unauthorized episode: the ref latches, and only a
  // successful catalog load clears it. Without that, `retryAuth` failing would
  // re-render, re-run this effect, and hammer /auth/me.
  const reverifiedForUnauthorizedRef = useRef(false);
  // Set only from retryAuth's own completion callback (never synchronously in
  // an effect — React 19's lint forbids that, and it cost a fix in
  // CampaignFloorPanel). True means: the re-verify finished and did NOT set an
  // authError, i.e. the session is fine and the catalog endpoint alone refused
  // us. Without this the "session was actually valid" case would sit on a
  // skeleton forever, which is worse than the card it replaced.
  const [sessionReverified, setSessionReverified] = useState(false);
  useEffect(() => {
    if (catalog.status !== 'unauthorized') return;
    if (reverifiedForUnauthorizedRef.current) return;
    reverifiedForUnauthorizedRef.current = true;
    // retryAuth never rejects — it classifies internally — so this always runs.
    void retryAuth().then(() => setSessionReverified(true));
  }, [catalog.status, retryAuth]);

  // Manage focus across catalog state transitions (Iro a11y MAJOR-1): on error
  // (initial or after a failed retry) move focus to the "Try again" button so the
  // alert is reachable and re-announced; once the catalog resolves after a retry,
  // move focus to the wizard step heading instead of dropping it at document top.
  useEffect(() => {
    // TAV-AUDIT-401-DEADEND: `unauthorized` reaches the same card once the
    // session has re-verified clean, so it needs the same focus move — without
    // this, that card mounts with focus stranded at document top.
    if (
      catalog.status === 'error' ||
      catalog.status === 'rate_limited' ||
      (catalog.status === 'unauthorized' && sessionReverified)
    ) {
      errorRetryRef.current?.focus();
    } else if (catalog.status === 'ok' && mountedRef.current) {
      headingRef.current?.focus();
    }
  }, [catalog.status, sessionReverified]);

  const raceObj = catalog.data.races.find((r) => r.id === race);
  const clsObj = catalog.data.classes.find((c) => c.id === cls);
  const bgObj = catalog.data.backgrounds.find((b) => b.id === background);
  const isCasterClass = !!clsObj?.isCaster;

  // TAV-WIZARD-HOMEBREW-CASTERS — the two new step gates. hasRungStep does
  // NOT require hasSubclassStep to be true (the design gates it purely on
  // the menu's own knownAtLevel1) but in practice every declared Rung menu
  // today rides on a subclassLevel:1 class too.
  const hasSubclassStep = clsObj?.subclassLevel === 1;
  const hasRungStep = (clsObj?.rungMenu?.knownAtLevel1 ?? 0) > 0;
  // Kage-CR BLOCKING-1: the engine refuses ANY option whose declared `level`
  // exceeds the character's level (`class_feature_choice_options`'s per-
  // option gate, enforced again by `learn_feature_pick` -> `option_level_
  // unmet`) — a creation-time character is ALWAYS level 1, so an unfiltered
  // menu offered ~4/16 (shinobi/ninjutsu), ~3/14 (ft-caster), ~4/8
  // (ki-warrior) genuinely pickable options behind checkboxes that would
  // 400 on apply. Archetype scoping alone isn't the whole gate.
  const rungOptions = (clsObj?.rungMenu?.options ?? []).filter(
    (o) => (!o.subclass || o.subclass === selectedSubclass) && (o.level ?? 0) <= 1,
  );

  // ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP — gated purely on the class row
  // (independent of Subclass/Rung, unlike Rung's practical-but-not-required
  // subclass coupling). `skillOptions` mirrors the engine's own exclusion
  // rule client-side (`_resolve_skills_choice`'s "pool minus proficient_
  // skills"): the class's pool minus whatever the CHOSEN background already
  // grants, so a duplicate is never even offered as a checkbox (obs #168) —
  // the exact "options include known picks" bug class feature_choice's own
  // enrichment already had to fix once (ENGINE-PENDING-OPTIONS-INCLUDE-
  // KNOWN-PICKS).
  const hasSkillsStep = (clsObj?.skillCount ?? 0) > 0 && (clsObj?.skillChoices?.length ?? 0) > 0;
  const bgSkillSet = new Set(bgObj?.skills ?? []);
  const skillOptions = (clsObj?.skillChoices ?? []).filter((s) => !bgSkillSet.has(s));

  // TAV-CREATE-SUBRACE-ASI-PICKER — gates the Race step's pickers/Continue.
  const raceHasSubraces = (raceObj?.subraces.length ?? 0) > 0;
  /* Whether the wizard BLOCKS on the subrace step. Not the same question as
   * "does this race have subraces": Dragon Ball's Saiyan has exactly one
   * (Half-Saiyan) and a full-blooded Saiyan is the campaign's default lineage,
   * so gating unconditionally made it uncreatable in the browser even though
   * the engine accepts `subrace=None`. Content decides via
   * `data.subrace_required`; absent means required, so SRD is unchanged. */
  const subraceRequired = raceHasSubraces && (raceObj?.subraceRequired ?? true);
  const raceNeedsAsi = !!raceObj?.needsAsiChoice;
  const selectedSubrace = raceObj?.subraces.find((sr) => sr.name === subrace);

  // T4/DDX-11t — the step list adapts to the chosen class (Spells only for a
  // caster; TAV-WIZARD-HOMEBREW-CASTERS added Subclass/Rung on the same
  // per-class basis; ORACLE-CANDIDATE-1 added Skills). Recomputed whenever
  // any of the four flags change.
  const steps = useMemo(
    () => buildSteps({ isCaster: isCasterClass, hasSubclassStep, hasRungStep, hasSkillsStep }),
    [isCasterClass, hasSubclassStep, hasRungStep, hasSkillsStep],
  );
  const stepKey: StepKey = steps[Math.min(step, steps.length - 1)]?.key ?? 'race';

  // A shorter/longer step list (class toggled caster<->non-caster after the
  // user had already advanced past it) can leave `step` pointing past the end
  // — clamp back onto the new last step (Review) rather than crash. Adjusted
  // during render (not an effect) per React's documented pattern for
  // "adjusting state when a prop changes" — avoids an extra render pass.
  const [prevStepsLength, setPrevStepsLength] = useState(steps.length);
  if (steps.length !== prevStepsLength) {
    setPrevStepsLength(steps.length);
    setStep((s) => Math.min(s, steps.length - 1));
  }

  // Changing class invalidates any character silently created for the
  // PREVIOUS class (see the module doc comment) — Review must never learn/
  // prepare spells, or navigate to a sheet, for the wrong class.
  const prevClsRef = useRef(cls);
  useEffect(() => {
    if (prevClsRef.current !== cls) {
      prevClsRef.current = cls;
      setCharacterId(null);
      setCreatedSnapshot(null);
      setSpellCantrips(new Set());
      setSpellLeveled(new Set());
      // A class change invalidates the class half of the equipment package
      // too (different class → different fixed grants/choice groups) — clear
      // selections/choiceIds so a stale pick can't survive onto the new
      // class's create payload; EquipmentStep re-fetches and re-defaults the
      // moment the player reaches the step again.
      setEquipmentSelections({});
      setEquipmentChoiceIds([]);
      setEquipmentLoadState('loading');
      // TAV-WIZARD-HOMEBREW-CASTERS — a stale Subclass/Rung pick (or applied
      // state) can't survive onto a DIFFERENT class's menu.
      setSelectedSubclass(null);
      setSubclassOptions([]);
      setSubclassLoadState('loading');
      setRungPicks(new Set());
      setSubclassDone(false);
      setRungDone(false);
      // ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP — a stale Skills pick (or
      // applied state) can't survive onto a DIFFERENT class's skill pool
      // either.
      setSkillPicks(new Set());
      setSkillsDone(false);
      setSetupIssues([]);
      setRetryAttempt(0);
      setAwaitingSubmitRetry(false);
    }
  }, [cls]);

  // ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP — a stale Skills pick can also be
  // invalidated by a BACKGROUND change alone (same class, different
  // background): `skillOptions` excludes whatever the background grants, so
  // a pick that's now a background duplicate must not silently survive as a
  // phantom selection that inflates skillPicks.size past what renders as
  // checked. `skillsDone` is deliberately NOT reset here — a background
  // change is caught by the F7/TAV-CREATE-EDIT-NOT-RETRO snapshot compare
  // (CreatedSnapshot.background) instead, which resets it on recreate.
  const prevBackgroundRef = useRef(background);
  useEffect(() => {
    if (prevBackgroundRef.current !== background) {
      prevBackgroundRef.current = background;
      setSkillPicks(new Set());
    }
  }, [background]);

  // TAV-WIZARD-HOMEBREW-CASTERS — fetch the subclass catalog (own type,
  // doesn't arrive via useCatalog) whenever a subclassLevel:1 class is
  // selected. Mirrors LevelChoicePicker's SubclassChoiceCard fetch-on-mount
  // pattern (AbortController + Kage abort guard). TAV-FT-SUBCLASS-SLUG-
  // PREFIX (2026-09-07): filters by `clsObj.id` (the class's catalog SLUG),
  // not its display name — a prefixed slug like "ft-caster" ("Caster (Fairy
  // Tail)") can't be derived from the name via slugifyName (see
  // subclassesForClass's doc comment), so passing the name silently
  // returned zero rows for every Fairy Tail class despite 59 seeded
  // subclasses.
  useEffect(() => {
    if (!hasSubclassStep || !clsObj) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubclassOptions([]);
      setSubclassLoadState('ok');
      return;
    }
    const ac = new AbortController();
    setSubclassLoadState('loading');
    // Kage-CR IMPORTANT-2: limit:500 — the seeded subclass catalog is ~69
    // rows today; a homebrew-heavy day crossing whatever the engine's
    // default page size is would silently truncate this list rather than
    // erroring, and a truncated (not empty) list would never trip the
    // content-bug empty state below.
    getCatalog(SYSTEM, { type: 'subclass', limit: 500 }, ac.signal)
      .then((res) => {
        const filtered = subclassesForClass(res.items, clsObj.id).map(catalogItemToSubclass);
        setSubclassOptions(filtered);
        setSubclassLoadState('ok');
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setSubclassLoadState('error');
      });
    return () => ac.abort();
    // clsObj?.id (not clsObj itself) is the dep — same discipline
    // EquipmentStep's own fetch effect uses for clsObj/bgObj, avoiding a
    // refetch loop if the catalog hook ever returns a fresh array/object
    // reference across renders without the underlying data changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSubclassStep, clsObj?.id, subclassLoadKey]);

  // TAV-CREATE-SUBRACE-ASI-PICKER — a subrace/ASI choice is only meaningful
  // for the race it was made under; changing race must clear both so a
  // stale Wood Elf pick can't survive a switch to Dwarf.
  const prevRaceRef = useRef(race);
  useEffect(() => {
    if (prevRaceRef.current !== race) {
      prevRaceRef.current = race;
      setSubrace(null);
      setHalfElfAsi([]);
    }
  }, [race]);

  const toggleHalfElfAsi = useCallback((key: AbilityKey) => {
    setHalfElfAsi((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= 2) return prev;
      return [...prev, key];
    });
  }, []);

  const remaining = pointsRemaining(scores);
  const finalScores = useMemo(
    () =>
      applyRacialBonuses(
        scores,
        raceObj?.bonuses,
        selectedSubrace?.bonuses,
        raceNeedsAsi ? halfElfAsi : undefined,
      ),
    [scores, raceObj, selectedSubrace, raceNeedsAsi, halfElfAsi],
  );
  const derived = useMemo(
    () => derivedStats(finalScores, clsObj, selectedSubrace?.speed ?? raceObj?.speed ?? 30),
    [finalScores, clsObj, raceObj, selectedSubrace],
  );

  const setScore = useCallback((key: AbilityKey, delta: number) => {
    setScores((prev) => {
      const next = prev[key] + delta;
      if (next < POINT_BUY_MIN || next > POINT_BUY_MAX) return prev;
      const candidate: AbilityScores = { ...prev, [key]: next };
      if (pointsRemaining(candidate) < 0) return prev;
      return candidate;
    });
  }, []);

  const canContinue = useMemo(() => {
    switch (stepKey) {
      case 'race':
        // TAV-CREATE-SUBRACE-ASI-PICKER: a race with named subraces requires
        // one to be chosen; Half-Elf requires its two floating +1s.
        if (!race) return false;
        if (subraceRequired && !subrace) return false;
        if (raceNeedsAsi && halfElfAsi.length !== 2) return false;
        return true;
      case 'class':
        return !!cls;
      case 'subclass':
        // Required, gates Continue (§2 of the design). Naturally covers the
        // loading/error/empty-catalog states too — there's nothing to click,
        // so selectedSubclass stays null and this returns false regardless
        // of WHY the grid is empty.
        return !!selectedSubclass;
      case 'rung': {
        // A non-freeform menu (future case) is read-only informational
        // content — nothing to pick, never blocks.
        if (clsObj?.rungMenu?.freeform === false) return true;
        const cap = clsObj?.rungMenu?.knownAtLevel1 ?? 0;
        return rungPicks.size === cap;
      }
      case 'abilities':
        return remaining >= 0;
      case 'background':
        return !!background && name.trim().length > 0;
      case 'skills': {
        // ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP: fail-closed when the
        // background has already eaten the entire class pool — an empty
        // `skillOptions` can never satisfy `size === cap` (cap is always
        // >=1 here, hasSkillsStep already guards that), so this is never a
        // silent dead end, it's an honest "nothing left to pick" refusal
        // rendered by SkillsStep's own empty state.
        if (skillOptions.length === 0) return false;
        const cap = clsObj?.skillCount ?? 0;
        return skillPicks.size === cap;
      }
      case 'equipment':
        // A failed fetch (equipmentLoadState === 'error') must never block
        // Continue — creation just goes gearless (see the module doc
        // comment). While still loading, block (nothing to default-select
        // yet). Once 'ok', every discovered choice group must have a pick —
        // EquipmentStep defaults them all to their first option on fetch
        // success, so in practice this only blocks mid-fetch.
        return (
          equipmentLoadState !== 'loading' &&
          (equipmentLoadState === 'error' ||
            equipmentChoiceIds.every((id) => !!equipmentSelections[id]))
        );
      case 'spells':
        // TAV-SPELLSTEP-CAP-MSG (2026-08-01 walk): a caster shipping with
        // zero cantrips and zero spells is exactly the "new player picks a
        // caster and gets punished" persona this wizard exists to protect.
        // Gate Continue on the requirement SpellsStep reports after its
        // fetch (min(cap, catalog size) — a thin dev catalog can't wedge).
        // null (still loading, or fetch failed) stays fail-open, matching
        // the equipment-step precedent and the "pick from the sheet later"
        // copy the error state already shows.
        return (
          !spellReq ||
          (spellCantrips.size >= spellReq.cantripsNeeded &&
            spellLeveled.size >= spellReq.leveledNeeded)
        );
      // 'review' — Review's Continue is the submit button, gated separately
      // by canSubmit below.
      default:
        return true;
    }
  }, [
    stepKey,
    race,
    subraceRequired,
    subrace,
    raceNeedsAsi,
    halfElfAsi,
    cls,
    remaining,
    background,
    name,
    equipmentLoadState,
    equipmentChoiceIds,
    equipmentSelections,
    spellReq,
    spellCantrips,
    spellLeveled,
    selectedSubclass,
    clsObj,
    rungPicks,
    skillOptions,
    skillPicks,
  ]);

  // 2026-07-24 Starting Equipment design — same defensive backstop rationale
  // as the subrace/ASI checks below: the Equipment step's own canContinue
  // already blocks Continue on an incomplete choice, but the silent-create
  // branch (handleContinue, equipment -> spells) re-checks this before firing
  // so a caster's create is never attempted mid-fetch or with a choice gap.
  // A failed fetch is NOT a gap here (equipmentLoadState === 'error' means
  // equipmentChoiceIds is already [] — the `every` is vacuously true).
  const equipmentReady =
    equipmentLoadState !== 'loading' &&
    equipmentChoiceIds.every((id) => !!equipmentSelections[id]);

  const canCreatePrereqs =
    !!username &&
    !!raceObj &&
    !!clsObj &&
    !!bgObj &&
    name.trim().length > 0 &&
    remaining >= 0 &&
    (!subraceRequired || !!subrace) &&
    (!raceNeedsAsi || halfElfAsi.length === 2) &&
    equipmentReady;

  // TAV-CREATE-DEADEND-DIAGNOSABLE: canCreatePrereqs's own "why". In practice
  // the race/class/background gaps below are already blocked by canContinue
  // disabling the Continue button on their own steps — this is a defensive
  // backstop for the Background -> Spells silent-create branch (handleContinue)
  // so that IF it's ever reached with a gap unmet, the user gets a real reason
  // instead of a silent no-op (the bug this hardens against).
  const missingPrereqsReason = useMemo((): string | null => {
    if (!username) return 'You need to be signed in to create a character.';
    if (!raceObj) return 'Pick a race before continuing.';
    if (subraceRequired && !subrace) return 'Choose a subrace before continuing.';
    if (raceNeedsAsi && halfElfAsi.length !== 2) {
      return 'Choose your two ability increases before continuing.';
    }
    if (!clsObj) return 'Pick a class before continuing.';
    if (remaining < 0) return 'Your ability scores are over budget — spend 27 points or fewer.';
    if (!bgObj) return 'Pick a background before continuing.';
    if (!name.trim()) return 'Give your character a name before continuing.';
    if (!equipmentReady) return 'Choose your starting equipment before continuing.';
    return null;
  }, [
    username,
    raceObj,
    subraceRequired,
    subrace,
    raceNeedsAsi,
    halfElfAsi,
    clsObj,
    remaining,
    bgObj,
    name,
    equipmentReady,
  ]);

  const canSubmit = canCreatePrereqs && !submitting;

  // F7/TAV-CREATE-EDIT-NOT-RETRO — captures the LIVE wizard fields in the
  // same shape as CreatedSnapshot, for comparison against the snapshot taken
  // right after the silent create. Half-Elf's ASI picks are order-
  // independent (the checkbox group can be toggled in any order and still
  // mean the same two abilities), so both sides sort before compare.
  const snapshotNow = useCallback(
    (): CreatedSnapshot => ({
      name: name.trim(),
      race: raceObj?.name ?? '',
      subrace: subrace ?? undefined,
      halfElfAsi: raceNeedsAsi ? [...halfElfAsi].sort() : [],
      background: bgObj?.name ?? '',
      scores: { ...scores },
      equipment: canonicalizeEquipmentSelections(equipmentSelections),
    }),
    [name, raceObj, subrace, raceNeedsAsi, halfElfAsi, bgObj, scores, equipmentSelections],
  );

  // POST /api/dnd/characters. Shared by handleContinue's silent caster-path
  // create (leaving Background) and handleSubmit's non-caster-path create
  // (Review) — same payload either way.
  const createNow = useCallback(async (): Promise<string> => {
    if (!username || !raceObj || !clsObj || !bgObj || !name.trim()) {
      throw new Error('missing required fields');
    }
    // 2026-07-24 Starting Equipment design §4.1/§6 — the presence gate IS the
    // kill-switch: only send equipment_selections when the Equipment step's
    // fetch actually resolved ('ok'). A failed fetch omits the field entirely
    // (undefined, not []) so the engine's `_apply_starting_equipment` stamp
    // no-ops exactly as it does for a pre-this-feature/Twitch create — never
    // send [] as a stand-in for "fetch failed" (that would still grant every
    // FIXED item, a different and wrong degraded behavior). Filtered to only
    // the choiceIds from the LAST successful fetch — a stale key left over
    // from a since-changed class/background is dropped rather than sent as a
    // phantom selection.
    const equipmentSelectionsPayload: EquipmentSelection[] | undefined =
      equipmentLoadState === 'ok'
        ? equipmentChoiceIds
            .filter((id) => !!equipmentSelections[id])
            .map((choice_id) => ({ choice_id, option_id: equipmentSelections[choice_id] }))
        : undefined;
    const created = await createCharacter({
      username,
      name: name.trim(),
      race: raceObj.name,
      char_class: clsObj.name,
      background: bgObj.name,
      ability_scores: scores,
      // TAV-CREATE-SUBRACE-ASI-PICKER — only sent when meaningful; the
      // engine 400s a subrace that isn't one of the chosen race's, or an
      // ASI submitted for a non-Half-Elf race.
      subrace: subrace ?? undefined,
      half_elf_asi: raceNeedsAsi && halfElfAsi.length === 2 ? halfElfAsi : undefined,
      equipment_selections: equipmentSelectionsPayload,
    });
    if (!created.character_id) throw new Error('missing character_id');
    return created.character_id;
  }, [
    username,
    raceObj,
    clsObj,
    bgObj,
    name,
    scores,
    subrace,
    raceNeedsAsi,
    halfElfAsi,
    equipmentLoadState,
    equipmentChoiceIds,
    equipmentSelections,
  ]);

  // TAV-WIZARD-HOMEBREW-CASTERS — post-create Subclass/Rung apply. Called
  // once from handleContinue's silent-create branch, and again (idempotent)
  // from Review's "Retry setup" action. Returns the outstanding issue
  // strings (empty = fully applied) — never throws; every failure mode
  // degrades to an issue string instead ("resume, not dead-end", §4/§7).
  //
  // Ordering is the load-bearing part: resolveLevelChoice('subclass:1', …)
  // MUST complete before getFeaturePicks is called, or the engine's
  // class_feature_choice_options(subclass=None) branch strips every
  // archetype-tagged rung option (engine fact 4) — getFeaturePicks is also
  // what lets a RETRY diff against what's already known server-side, so a
  // partial-failure resume never double-submits an already-learned pick.
  const applyPendingSetup = useCallback(
    async (id: string): Promise<string[]> => {
      const issues: string[] = [];
      if (!username) return issues;
      let subclassOk = !hasSubclassStep || subclassDone;
      if (hasSubclassStep && !subclassDone) {
        // Kage-CR #9: canContinue on the Subclass step already requires a
        // pick before Continue enables — this branch guards the (should-be-
        // unreachable, hence no test) case of arriving here with none
        // anyway, rather than POSTing {subclass: null} and letting the
        // engine's own 400 stand in for a copy line this file could write
        // itself.
        if (!selectedSubclass) {
          issues.push(
            `${clsObj?.name ?? 'Your'} archetype was never chosen — pick one from the character sheet.`,
          );
          subclassOk = false;
        } else {
          try {
            await resolveLevelChoice(id, username, 'subclass:1', { subclass: selectedSubclass });
            setSubclassDone(true);
            subclassOk = true;
          } catch (err) {
            // Kage-CR #3: already_chosen means a PRIOR attempt actually
            // landed (e.g. the first apply succeeded server-side but this
            // client never observed it before erroring elsewhere) — that is
            // success, not a failure to retry forever.
            if (isApiError(err) && extractReason(err) === 'already_chosen') {
              setSubclassDone(true);
              subclassOk = true;
            } else {
              issues.push(
                engineErrorMessage(err, {
                  fallback: `${clsObj?.name ?? 'Your'} archetype couldn't be saved — finish it from the character sheet.`,
                  reasonMap: SETUP_REASON_MAP,
                }),
              );
              if (hasRungStep) {
                issues.push(
                  "Your starting techniques couldn't be picked yet — they depend on your archetype being set first.",
                );
              }
              subclassOk = false;
              // Kage-CR #4: never swallow the engine's own explanation.
              console.warn('TAV-WIZARD-HOMEBREW-CASTERS: subclass resolve failed', err);
            }
          }
        }
      }
      if (hasRungStep && subclassOk && !rungDone) {
        try {
          const current = await getFeaturePicks(id, username);
          const known = new Set(current.known.map((o) => o.slug));
          // Kage-CR #8: reconcile against the server-authoritative eligible
          // list rather than trusting the render-time filter alone —
          // options.length/level can't drift mid-wizard, but this is the
          // same defense-in-depth discipline `class_feature_choice_options`
          // itself applies (never trust a client-computed set as the
          // entitlement answer). A picked slug that's neither known nor
          // eligible is a genuine, nameable failure — never attempted (it
          // would just 400 option_level_unmet/wrong_subclass) and never
          // silently dropped from the count either.
          const eligible = new Set(current.eligible.map((o) => o.slug));
          const picked = Array.from(rungPicks);
          const toLearn = picked.filter((slug) => !known.has(slug) && eligible.has(slug));
          const ineligible = picked.filter((slug) => !known.has(slug) && !eligible.has(slug));

          // Kage-CR #6: sequential, not Promise.allSettled — concurrent
          // learnFeaturePick calls are a lost-update race on the same
          // character body (no optimistic locking server-side; each call
          // reads-modifies-writes the full feature_choices bag).
          let failed = ineligible.length;
          // Kage-CR review round 2: the FIRST real failure's curated reason
          // rides along with the aggregate count — a bare "N couldn't be
          // learned" told the player nothing they could act on; "(That
          // technique needs a higher level.)" does.
          let firstFailureReason: string | undefined;
          for (const slug of toLearn) {
            try {
              await learnFeaturePick(id, username, slug);
            } catch (err) {
              // Kage-CR #3: duplicate_option means it's already known —
              // getFeaturePicks's own `known` list can lag a stamp the
              // ledger already has (see feature_picks.py's orphan-stamp
              // docstring); treat it the same as isAlreadyKnownRejection
              // does for spells.
              if (!(isApiError(err) && extractReason(err) === 'duplicate_option')) {
                failed += 1;
                if (!firstFailureReason) {
                  firstFailureReason = engineErrorMessage(err, {
                    fallback: "a starting technique couldn't be learned",
                    reasonMap: SETUP_REASON_MAP,
                  });
                }
                console.warn('TAV-WIZARD-HOMEBREW-CASTERS: learnFeaturePick failed', slug, err);
              }
            }
          }
          if (failed > 0) {
            issues.push(
              `${failed} starting technique${failed > 1 ? 's' : ''} couldn't be learned${
                firstFailureReason ? ` (${firstFailureReason})` : ''
              } — add ${failed > 1 ? 'them' : 'it'} from the character sheet.`,
            );
          } else {
            setRungDone(true);
          }
        } catch (err) {
          issues.push(
            engineErrorMessage(err, {
              fallback: "Your starting techniques couldn't be checked — add them from the character sheet.",
              reasonMap: SETUP_REASON_MAP,
            }),
          );
          console.warn('TAV-WIZARD-HOMEBREW-CASTERS: getFeaturePicks failed', err);
        }
      }
      // ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP — independent of subclass/rung
      // (no ordering coupling: skillOptions is derived purely from class +
      // background, both already fixed by the time this runs).
      //
      // Coordinator note (2026-09-08, on Kage-CR's engine review): the
      // engine queues NOTHING for a homebrew class row that lacks
      // skill_count server-side, even when hasSkillsStep (derived PRE-
      // RENDER from the wizard's own catalog copy of WizardClass.skillCount)
      // said otherwise. Never assume the choice exists post-create — check
      // the real sheet first, same discipline the Rung branch above already
      // applies via getFeaturePicks. Absence is NOT a failure: it means this
      // class genuinely has nothing to resolve, so skillsOk without an issue.
      if (hasSkillsStep && !skillsDone) {
        try {
          const currentSheet = await getCharacterSheet(id, username);
          const pending = (currentSheet.pending_choices ?? []).find(
            (c) => c.type === 'skills',
          );
          if (!pending) {
            setSkillsDone(true);
          } else {
            const cap = pending.count ?? clsObj?.skillCount ?? 0;
            // Kage-CR follow-up (2026-09-08, "suggestion 1"): validate
            // against `pending.options` — the AUTHORITATIVE, server-
            // enriched pool (already excludes proficient_skills, the same
            // ENGINE-PENDING-OPTIONS-INCLUDE-KNOWN-PICKS / obs #168
            // discipline `feature_choice` already applies) — rather than
            // trusting the wizard's own client-side `skillOptions` mirror,
            // which was computed against whatever background/class were
            // selected at THAT render and can't see a server-side edit.
            // Closes obs #168 without re-deriving the exclusion rule here.
            //
            // Kage-CR follow-up #4: normalize BOTH sides the way the
            // engine's own `_resolve_skills_choice` normalizes a submitted
            // pick (`str(p).strip().lower().replace(" ","_").replace("-",
            // "_")`) before comparing — a stray case/whitespace/hyphen
            // mismatch between the wizard's own slug and the sheet's must
            // never produce a false refusal.
            const normalizedPicks = Array.from(skillPicks, normalizeSkillSlug);
            const validSlugs = new Set(
              normalizeSkillOptions(pending.options).map((o) => normalizeSkillSlug(o.slug)),
            );
            const invalidPicks = normalizedPicks.filter((slug) => !validSlugs.has(slug));
            if (skillPicks.size !== cap) {
              // Kage-CR #9 precedent (subclass branch above): canContinue on
              // the Skills step already requires exactly `cap` picks before
              // Continue enables — this guards the should-be-unreachable
              // case of arriving here with fewer/more anyway, rather than
              // letting the engine's own `invalid_skills_choice` 400 stand
              // in for copy this file can write itself.
              issues.push(
                `${clsObj?.name ?? 'Your'} class skills were never chosen — pick them from the character sheet.`,
              );
            } else if (validSlugs.size > 0 && invalidPicks.length > 0) {
              // Kage-CR follow-up #1 (CRITICAL): `validSlugs.size > 0` is
              // the fail-OPEN guard — the engine's own enrichment
              // (`get_character_sheet_data`'s pending_choices loop)
              // degrades to an empty pool on ANY exception ("display
              // enrichment only", NekoNova-DnDEngine engine/commands/
              // character_msm.py), and `_resolve_skills_choice` re-derives
              // the real pool server-side regardless of what shipped here —
              // an empty/absent `pending.options` is NOT a refusal signal.
              // Without this guard, probes A1 (`options: []`) and A2 (no
              // `options` key at all) permanently blocked creation:
              // resolveLevelChoice was never even attempted, the callout
              // never clears, and "Retry setup" loops forever against the
              // same empty list.
              //
              // Kage-CR follow-up #3: name the offending skill(s) — a bare
              // "one of the picks isn't on this class's list" gave the
              // player nothing to act on.
              const names = invalidPicks.map((slug) => humanizeSkill(slug)).join(', ');
              const plural = invalidPicks.length === 1;
              issues.push(
                `${names} ${plural ? "isn't" : "aren't"} on ${clsObj?.name ?? 'this class'}'s skill list anymore — fix ${plural ? 'it' : 'them'} from the character sheet.`,
              );
            } else {
              try {
                await resolveLevelChoice(id, username, pending.id, {
                  picks: normalizedPicks,
                });
                setSkillsDone(true);
              } catch (err) {
                // Same idempotent-success defense the subclass branch
                // applies — see SKILLS_REASON_MAP's doc comment for why this
                // reason isn't one `_resolve_skills_choice` actually emits
                // today.
                if (isApiError(err) && extractReason(err) === 'already_chosen') {
                  setSkillsDone(true);
                } else {
                  issues.push(
                    engineErrorMessage(err, {
                      fallback: `${clsObj?.name ?? 'Your'} class skills couldn't be saved — finish them from the character sheet.`,
                      reasonMap: SKILLS_REASON_MAP,
                    }),
                  );
                  console.warn('TAV-WIZARD-HOMEBREW-CASTERS: skills resolve failed', err);
                }
              }
            }
          }
        } catch (err) {
          issues.push(
            engineErrorMessage(err, {
              fallback: "Your class skills couldn't be checked — add them from the character sheet.",
              reasonMap: SKILLS_REASON_MAP,
            }),
          );
          console.warn('TAV-WIZARD-HOMEBREW-CASTERS: skills sheet check failed', err);
        }
      }
      if (issues.length > 0) {
        toast({
          message: 'Character created, but setup needs a follow-up — see Review.',
          tone: 'warn',
        });
      }
      return issues;
    },
    [
      username,
      hasSubclassStep,
      hasRungStep,
      hasSkillsStep,
      subclassDone,
      rungDone,
      skillsDone,
      selectedSubclass,
      rungPicks,
      skillPicks,
      clsObj,
      toast,
    ],
  );

  // Nav "Continue" — the ONE special case is Equipment -> next for a caster
  // and/or a class with a Subclass/Rung step: the character must exist
  // before the Spells step can fetch a real pool/budget, and before
  // resolveLevelChoice/learnFeaturePick have anything to act on (see the
  // module doc comment), so this is async there and synchronous everywhere
  // else. Moved here (was Background -> Spells) by the 2026-07-24 Starting
  // Equipment design so equipment_selections are already collected when
  // this POST fires. Generalized (TAV-WIZARD-HOMEBREW-CASTERS) from a bare
  // isCaster check to isCaster || hasSubclassStep || hasRungStep.
  //
  // ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP — deliberately NOT added here.
  // Nearly every real class has a skill_count > 0 (12/12 SRD classes), so
  // folding hasSkillsStep into this gate would force EVERY class creation
  // through the early-silent-create UX (character exists before Equipment,
  // name locked on Review, F7 recreate-on-drift machinery engaged) for a
  // choice that has no actual ordering dependency on anything else — unlike
  // Spells (needs a real character_id to fetch the pool) or Rung (needs
  // subclass resolved first), skills:1 only needs class+background, both
  // already fixed by Background. `applyPendingSetup` still resolves it
  // correctly EITHER way: early (via this branch, for a class that already
  // needs silent create for another reason) or once, at Review's final
  // submit (via handleSubmit's own `hasSkillsStep` gate below) for a class
  // that has no other reason to create early.
  const needsSilentCreate = isCasterClass || hasSubclassStep || hasRungStep;
  const handleContinue = useCallback(async () => {
    if (stepKey === 'equipment' && needsSilentCreate && !characterId) {
      if (!canCreatePrereqs) {
        // TAV-CREATE-DEADEND-DIAGNOSABLE: was a silent `return` — the user
        // stayed on Background with zero feedback. Surface the specific gap.
        setError(missingPrereqsReason ?? GENERIC_CREATE_ERROR);
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const id = await createNow();
        setCharacterId(id);
        setCreatedSnapshot(snapshotNow());
        const issues = await applyPendingSetup(id);
        setSetupIssues(issues);
        setStep((s) => Math.min(steps.length - 1, s + 1));
      } catch (err) {
        // TAV-CREATE-DEADEND-DIAGNOSABLE: was always the generic line — a
        // rejected race/subrace/ASI/choice combination was undiagnosable.
        setError(describeCreateError(err));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setStep((s) => Math.min(steps.length - 1, s + 1));
  }, [
    steps,
    stepKey,
    needsSilentCreate,
    characterId,
    canCreatePrereqs,
    missingPrereqsReason,
    createNow,
    snapshotNow,
    applyPendingSetup,
  ]);

  const handleSubmit = useCallback(async () => {
    if (!canCreatePrereqs && !characterId) return;
    setSubmitting(true);
    setError(null);
    try {
      let charId = characterId;
      // F7/TAV-CREATE-EDIT-NOT-RETRO — `staleCharId` stays null on the happy
      // path (no prior silent create, or no drift since it ran); it's only
      // ever set right before a replacement create is attempted, so the
      // delete near the bottom can never fire ahead of a successful create
      // (Kuro-Sec C2 — create-first ordering). If that replacement create
      // throws, execution jumps straight to the catch below and nothing is
      // deleted.
      let staleCharId: string | null = null;
      if (!charId) {
        charId = await createNow();
        // Kage-CR follow-up (2026-09-08): this used to leave `characterId`
        // state null on this (previously rare, now the MAJORITY — 12/12 SRD
        // classes declare a skill pool) path, so "Retry setup" below
        // (which reads `characterId` state, not this local `charId`) could
        // never find the character to retry against, and a second submit
        // click would silently create a SECOND character instead of
        // resuming this one. Mirrors the F7-recreate branch's own stamp.
        setCharacterId(charId);
        setCreatedSnapshot(snapshotNow());
      } else if (createdSnapshot && !snapshotsEqual(createdSnapshot, snapshotNow())) {
        staleCharId = charId;
        charId = await createNow();
        setCharacterId(charId);
        setCreatedSnapshot(snapshotNow());
        // TAV-WIZARD-HOMEBREW-CASTERS — an F7 recreate invalidates whatever
        // subclass/rung/skills work already landed on the STALE id; the
        // fresh id needs a full re-apply below.
        setSubclassDone(false);
        setRungDone(false);
        setSkillsDone(false);
      }

      // TAV-WIZARD-HOMEBREW-CASTERS — apply Subclass/Rung/Skills against
      // whichever character is now current. For Subclass/Rung this is
      // normally a no-op (already done by handleContinue's silent-create
      // branch, since subclassDone/rungDone are already true) — reached for
      // real only on an F7 recreate. For Skills (ORACLE-CANDIDATE-1) this is
      // the FIRST and only application for a class with no other reason to
      // silent-create early (see needsSilentCreate's doc comment) — `charId`
      // was just created a few lines up in that case, and — Kage-CR follow-
      // up (2026-09-08) — this is now the MAJORITY final-submit path: every
      // SRD class declares a skill pool (12/12), and barbarian/fighter/
      // monk/rogue have no OTHER early-create trigger at all, so this is
      // their only apply attempt.
      if (hasSubclassStep || hasRungStep || hasSkillsStep) {
        const issues = await applyPendingSetup(charId);
        setSetupIssues(issues);
        if (issues.length > 0) {
          // Kage-CR follow-up: used to fall through to router.push
          // unconditionally — the player got a "needs a follow-up" toast
          // pointing at a Review screen that had just been unmounted out
          // from under them, and never saw "Retry setup". The character
          // already exists (createNow succeeded above) — stay on Review
          // with the persistent callout instead; a successful "Retry
          // setup" (see its own doc comment) finishes this submit for them.
          setAwaitingSubmitRetry(true);
          setSubmitting(false);
          return;
        }
        setAwaitingSubmitRetry(false);
      }

      // Caster path: batch-apply the spell picks against whichever character
      // is now current (the original silent create, or its replacement).
      // Cantrips are always a `learn`; leveled picks are `learn` for known/
      // spellbook casters or `prepare` for a prepared caster (cleric/druid —
      // see casterKindFromSpellcasting's docstring in helpers.ts). Best-effort: a
      // failed pick surfaces a toast but never blocks navigating to the new
      // sheet — the character itself already exists either way.
      if (isCasterClass && username) {
        const leveledAction = clsObj?.casterKind === 'prepared' ? 'prepare' : 'learn';
        // Slice B Fix 3: a wizard's (spellbook caster's) PICKED leveled
        // spells must land prepared=true -- picked == prepared -- or
        // is_spell_castable refuses them under DND_ENFORCE_SPELL_KNOWN
        // (spellbook leveled entries otherwise default un-prepared until a
        // separate `prepare` call). Cantrips are unaffected (already
        // unconditionally prepared=true engine-side); known/prepared caster
        // paths are unaffected (already correct).
        const leveledPrepared = clsObj?.casterKind === 'spellbook' ? true : undefined;
        const picks: Promise<unknown>[] = [
          ...Array.from(spellCantrips, (slug) => learnSpell(charId as string, username, slug)),
          ...Array.from(spellLeveled, (slug) =>
            leveledAction === 'prepare'
              ? prepareSpell(charId as string, username, slug, true)
              : learnSpell(charId as string, username, slug, undefined, undefined, leveledPrepared),
          ),
        ];
        if (picks.length > 0) {
          const results = await Promise.allSettled(picks);
          // Kuro-Sec C1 (MANDATORY): an `already_known` rejection is the
          // ONLY rejection reason that doesn't count as a real failure — see
          // isAlreadyKnownRejection's doc comment for the full list of
          // reasons that must still surface. This also folds in the
          // CREATE-ORPHAN fix: a redundant re-learn against a freshly
          // recreated character would otherwise inflate this count.
          const failed = results.filter(
            (r) => r.status === 'rejected' && !isAlreadyKnownRejection(r.reason),
          ).length;
          if (failed > 0) {
            toast({
              message: `Character created, but ${failed} starting spell${failed > 1 ? 's' : ''} couldn’t be added. You can add ${failed > 1 ? 'them' : 'it'} from the sheet.`,
              tone: 'warn',
            });
          }
        }
      }

      // Kuro-Sec C2: only now, after the replacement create (and its spell
      // picks) has fully succeeded, remove the stale character it replaced.
      // Best-effort — a failed cleanup here leaves an orphan (same class of
      // issue as CREATE-ORPHAN, not fatal) but never blocks navigating to
      // the new, fully-playable sheet.
      if (staleCharId && username) {
        try {
          await deleteCharacter(staleCharId, username);
        } catch {
          // Orphan cleanup is best-effort; full GC of abandoned-wizard
          // orphans is out of scope for this fix (see the F7 handoff).
        }
      }

      router.push(`/character/${encodeURIComponent(charId)}`);
    } catch (err) {
      // TAV-CREATE-DEADEND-DIAGNOSABLE: same generic-string bug as
      // handleContinue's silent-create catch — surface the real reason here
      // too (Review's final submit hits this same createNow() call for a
      // non-caster, and for a caster's F7 recreate-on-drift path).
      setError(describeCreateError(err));
      setSubmitting(false);
    }
  }, [
    canCreatePrereqs,
    characterId,
    createdSnapshot,
    snapshotNow,
    createNow,
    hasSubclassStep,
    hasRungStep,
    hasSkillsStep,
    applyPendingSetup,
    isCasterClass,
    username,
    clsObj,
    spellCantrips,
    spellLeveled,
    toast,
    router,
  ]);

  // Review's "Retry setup" — re-runs applyPendingSetup (the "ordinary"
  // case) or resumes the FULL blocked submit (the "awaitingSubmitRetry"
  // case) against the CURRENT characterId. Idempotent: subclassDone/
  // rungDone/skillsDone skip whatever already succeeded, and getFeaturePicks
  // diffs rungPicks against what the server already knows before
  // re-attempting learnFeaturePick.
  //
  // Kage-CR follow-up #2 (2026-09-08): a retry that follows a BLOCKED final
  // submit (`awaitingSubmitRetry`) now calls handleSubmit() itself instead
  // of a bare applyPendingSetup + a direct router.push. The earlier
  // shortcut bypassed handleSubmit's own F7 drift check (probe B2 — a
  // rename made after the block was silently discarded, since the shortcut
  // never re-ran createNow()/snapshotsEqual at all), the caster spell
  // batch (a retried caster navigated to their sheet with an empty
  // spellbook, since that block lives inside handleSubmit and the shortcut
  // never reached it), and the staleCharId cleanup (a rename-triggered
  // recreate's pre-rename character was never deleted, an orphan of the
  // same family as the F7 abandoned-wizard case). handleSubmit is safe to
  // call again here: characterId/createdSnapshot are already stamped (see
  // its own doc comment on the first createNow() branch), so this resumes
  // the SAME character unless something genuinely changed since the block,
  // in which case handleSubmit's own F7 path recreates correctly and
  // re-applies against the fresh id.
  //
  // The ORDINARY case (an early-create apply failed and the player is
  // still browsing Spells/Review, never having clicked "Begin your
  // campaign" at all) is unchanged — clear the callout, toast, stay put;
  // "Begin your campaign" remains a separate, explicit action.
  const handleRetrySetup = useCallback(async () => {
    if (!characterId) return;
    if (awaitingSubmitRetry) {
      setRetryingSetup(true);
      try {
        await handleSubmit();
      } finally {
        setRetryingSetup(false);
      }
      return;
    }
    setRetryingSetup(true);
    try {
      const issues = await applyPendingSetup(characterId);
      setSetupIssues(issues);
      if (issues.length === 0) {
        // Iro-A11y MINOR-3: the callout just unmounting on success gives AT
        // no confirmation — fire the existing Toast (role="status" for a
        // non-error tone) so success is actually announced.
        toast({ message: 'Setup finished — everything is saved.', tone: 'success' });
      } else {
        // Iro-A11y MINOR-4: bump even on a still-failing retry so the
        // callout's text content changes and role="alert" re-announces a
        // repeated identical failure (see retryAttempt's own comment).
        setRetryAttempt((n) => n + 1);
      }
    } finally {
      setRetryingSetup(false);
    }
  }, [characterId, applyPendingSetup, toast, awaitingSubmitRetry, handleSubmit]);

  // ── Suzu's line for the current step ──────────────────────────────────────────
  let suzuLine: string;
  if (stepKey === 'race') suzuLine = race ? (SUZU_LINES.race[race] ?? 'An unusual choice. Suzu is intrigued.') : 'Take your time. The tavern will keep.';
  else if (stepKey === 'class') suzuLine = cls ? (SUZU_LINES.class[cls] ?? 'An interesting calling.') : 'Pick a verb.';
  else if (stepKey === 'subclass')
    suzuLine = selectedSubclass
      ? `${subclassOptions.find((s) => s.id === selectedSubclass)?.name ?? 'That path'}. Suzu approves — probably.`
      : 'Every class forks somewhere. Pick your fork.';
  else if (stepKey === 'rung')
    suzuLine =
      rungPicks.size > 0
        ? `${rungPicks.size} technique${rungPicks.size === 1 ? '' : 's'} down. Suzu is taking notes.`
        : "First tricks. Choose wisely — or don't, Suzu will still watch.";
  else if (stepKey === 'abilities') suzuLine = abilitiesComment(scores);
  else if (stepKey === 'background')
    suzuLine = name.trim()
      ? `${name.trim()}. Suzu likes the sound of it.`
      : 'Names matter. Even the ones you change later.';
  else if (stepKey === 'skills')
    suzuLine =
      skillPicks.size > 0
        ? `${skillPicks.size} skill${skillPicks.size === 1 ? '' : 's'} claimed. Suzu will hold you to it.`
        : "What you're good at, on paper at least.";
  else if (stepKey === 'equipment')
    suzuLine = 'A pack, a weapon, something sharp for emergencies. Suzu already picked for you — check her work.';
  else if (stepKey === 'spells')
    suzuLine = 'Cantrips are free tricks. First-level spells are the ones that cost you a slot — spend wisely.';
  else
    suzuLine = name.trim()
      ? `${name.trim()}, I'll have a table ready by Tuesday. Bring a coat — the coast is colder than the brochure suggests.`
      : 'Welcome to the tavern. Mind the chimney.';

  // ── Live Suzu commentary (ST-053) ─────────────────────────────────────────────
  // Product default is full assist (the wizard has no session/ai-context source
  // yet — FLAGGED); 'off' makes the panel ABSENT and issues no narration request.
  // The streamed text is primary; `suzuLine` above is the deterministic fallback
  // shown while waiting or if the stream is unavailable (graceful — AC#3).
  const aiAssistLevel: 'full' | 'assist' | 'off' = 'full';
  const commentaryKey = `${stepKey}|${race ?? ''}|${cls ?? ''}|${background ?? ''}`;
  const commentaryPrompt =
    stepKey === 'race'
      ? `In one wry sentence, react to my new D&D character being a ${raceObj?.name ?? 'race I haven’t picked yet'}.`
      : stepKey === 'class'
        ? `In one wry sentence, react to my character's class: ${clsObj?.name ?? 'undecided'}.`
        : stepKey === 'subclass'
          ? `In one wry sentence, react to my character's archetype choice within ${clsObj?.name ?? 'their class'}.`
          : stepKey === 'rung'
            ? `In one wry sentence, react to my character picking their first starting techniques.`
            : stepKey === 'abilities'
          ? `In one wry sentence, react to how I've spread my character's ability scores.`
          : stepKey === 'background'
            ? `In one wry sentence, react to my character's name and background: ${name.trim() || 'unnamed'}, ${bgObj?.name ?? 'no background yet'}.`
            : stepKey === 'skills'
              ? `In one wry sentence, react to my ${clsObj?.name ?? 'character'} picking their class skills.`
              : stepKey === 'equipment'
              ? `In one wry sentence, react to my ${clsObj?.name ?? 'character'}'s starting gear choices.`
              : stepKey === 'spells'
                ? `In one wry sentence, react to my ${clsObj?.name ?? 'caster'} picking their starting spells.`
                : `In one wry sentence, send off my finished character ${name.trim() || 'the adventurer'}, a ${raceObj?.name ?? ''} ${clsObj?.name ?? ''}.`;
  const {
    enabled: suzuEnabled,
    text: suzuStream,
    streaming: suzuStreaming,
  } = useWizardCommentary({ aiAssistLevel, username, commentaryKey, prompt: commentaryPrompt });
  const suzuDisplay = suzuStream.trim() || suzuLine;

  const continueHint =
    stepKey === 'race'
      ? !race
        ? 'Select a race to continue.'
        : subraceRequired && !subrace
          ? 'Select a subrace to continue.'
          : raceNeedsAsi && halfElfAsi.length !== 2
            ? 'Choose two ability scores to increase to continue.'
            : ''
      : stepKey === 'class'
        ? 'Select a class to continue.'
        : stepKey === 'subclass'
          ? 'Choose an archetype to continue.'
          : stepKey === 'rung' && clsObj?.rungMenu
            ? // Iro-A11y MINOR-1: countedLabel pluralizes at cap>1 ("Pick 2
              // Path Techniques to continue."); dropped the old .toLowerCase()
              // to match RungStep's own Title Case usage of menu.label.
              `Pick ${countedLabel(clsObj.rungMenu.label, clsObj.rungMenu.knownAtLevel1)} to continue.`
            : stepKey === 'background'
          ? 'Enter a name and choose a background to continue.'
          : stepKey === 'skills'
            ? skillOptions.length === 0
              ? "This class's skills are already covered by your background — nothing left to pick."
              : `Pick ${countedLabel('skill', clsObj?.skillCount ?? 0)} to continue.`
            : stepKey === 'equipment' && equipmentLoadState === 'loading'
            ? 'Loading your starting equipment…'
            : stepKey === 'spells' && spellReq
              ? `Pick your ${spellReq.cantripsNeeded} cantrip${spellReq.cantripsNeeded === 1 ? '' : 's'} and ${spellReq.leveledNeeded} first-level spell${spellReq.leveledNeeded === 1 ? '' : 's'} to continue.`
              : '';

  const totalSpellPicks = spellCantrips.size + spellLeveled.size;
  const railSub = (key: StepKey): string => {
    switch (key) {
      case 'race':
        return raceObj ? (subrace ? `${raceObj.name} · ${subrace}` : raceObj.name) : '—';
      case 'class':
        return clsObj?.name ?? '—';
      case 'subclass':
        return selectedSubclass
          ? (subclassOptions.find((s) => s.id === selectedSubclass)?.name ?? '—')
          : '—';
      case 'rung':
        return rungPicks.size > 0 ? `${rungPicks.size} chosen` : '—';
      case 'abilities': {
        // TAV-28: pluralize so a single point reads "1 pt spent", not "1 pts".
        const spent = POINT_BUY_BUDGET - remaining;
        return `${spent} ${spent === 1 ? 'pt' : 'pts'} spent`;
      }
      case 'background':
        return bgObj?.name ?? (name.trim() ? name.trim() : '—');
      case 'skills':
        return skillPicks.size > 0 ? `${skillPicks.size} chosen` : '—';
      case 'equipment': {
        const chosen = equipmentChoiceIds.filter((id) => !!equipmentSelections[id]).length;
        if (equipmentLoadState === 'error') return 'gearless';
        if (equipmentChoiceIds.length === 0) return equipmentLoadState === 'ok' ? 'all set' : '—';
        return `${chosen}/${equipmentChoiceIds.length} chosen`;
      }
      case 'spells':
        return totalSpellPicks > 0 ? `${totalSpellPicks} chosen` : '—';
      default:
        return 'all done';
    }
  };

  // Resolving (silent refresh) → bounded skeleton; failed refresh → re-auth
  // prompt; genuinely logged out → redirect to /login (UIR2-TAV-3).
  const gate = useAuthGate({
    skeleton: <PageSkeleton variant="card" lines={4} />,
    label: 'Loading character creation',
  });
  if (gate) return gate;

  // TAV-AUDIT-401-DEADEND — a confirmed-dead session is still being verified.
  // `useAuthGate` above pre-empts this branch the moment AuthProvider sets an
  // authError, so this skeleton is the short handover window, not a state the
  // user gets stuck in: if the re-verify comes back clean, `sessionReverified`
  // flips and the error branch below renders instead.
  if (catalog.status === 'unauthorized' && !sessionReverified) {
    return (
      <TavernShell active="dashboard" title="New character" actions={<Button variant="ghost" href="/dashboard">Cancel</Button>}>
        <PageSkeleton variant="card" lines={4} />
      </TavernShell>
    );
  }

  // ── Catalog rate-limited state (TAV-WIZARD-429-HANG) ──────────────────────────
  // A limiter 429 during boot used to collapse into the generic 'error' card,
  // whose copy told the player to check a connection that was fine. Name the
  // real condition and the real remedy — wait, then retry. Same Card/alert
  // structure and focus handling as the error card below.
  if (catalog.status === 'rate_limited') {
    return (
      <TavernShell active="dashboard" title="New character" actions={<Button variant="ghost" href="/dashboard">Cancel</Button>}>
        <Card
          className={styles.catalogError}
          role="alert"
          aria-labelledby="catalog-error-title"
        >
          <p id="catalog-error-title" className={styles.catalogErrorTitle}>Hold on a moment.</p>
          <p id="catalog-error-body" className={styles.catalogErrorBody}>
            Too many requests in a short window. Wait a few seconds, then try again.
          </p>
          <Button
            ref={errorRetryRef}
            variant="primary"
            size="lg"
            onClick={catalog.retry}
            aria-describedby="catalog-error-body"
          >
            Try again
          </Button>
        </Card>
      </TavernShell>
    );
  }

  // ── Catalog error state — surface a retry UI, not a crash ─────────────────────
  if (catalog.status === 'error' || catalog.status === 'unauthorized') {
    return (
      <TavernShell active="dashboard" title="New character" actions={<Button variant="ghost" href="/dashboard">Cancel</Button>}>
        {/* role="alert" announces on mount; aria-labelledby surfaces the title in
            the alert text for screen readers that include it. The "Try again"
            button is aria-describedby the error body so its context is announced
            alongside the action name when focused. */}
        <Card
          className={styles.catalogError}
          role="alert"
          aria-labelledby="catalog-error-title"
        >
          <p id="catalog-error-title" className={styles.catalogErrorTitle}>Suzu can&rsquo;t reach the catalog right now.</p>
          {/* TAV-AUDIT-401-DEADEND: never tell someone to check a connection
              that is demonstrably fine. Reaching this branch with
              'unauthorized' means the request DID reach the server, the
              session re-verified as still valid, and the catalog endpoint
              alone refused it — a different problem with a different remedy. */}
          <p id="catalog-error-body" className={styles.catalogErrorBody}>
            {catalog.status === 'unauthorized'
              ? 'Your session is fine, but the catalog refused this request. Try again — if it keeps happening, sign out and back in.'
              : 'The race, class, and background lists couldn’t be loaded. Check your connection or try again in a moment.'}
          </p>
          <Button
            ref={errorRetryRef}
            variant="primary"
            size="lg"
            onClick={catalog.retry}
            aria-describedby="catalog-error-body"
          >
            Try again
          </Button>
        </Card>
      </TavernShell>
    );
  }

  // ── Catalog loading state ──────────────────────────────────────────────────────
  if (catalog.status === 'loading') {
    return (
      <TavernShell active="dashboard" title="New character" actions={<Button variant="ghost" href="/dashboard">Cancel</Button>}>
        {/* PageSkeleton carries role="status" aria-busy="true" aria-label="Loading…"
            internally. A bare <div> with aria-busy/aria-label has no implicit role
            and the attributes are ignored by screen readers — let the component
            own its own announcement. */}
        <PageSkeleton variant="card" lines={4} />
      </TavernShell>
    );
  }

  const meta = steps[step] ?? steps[steps.length - 1];

  return (
    <TavernShell
      active="dashboard"
      title="New character"
      actions={
        <Button variant="ghost" href="/dashboard">
          Cancel
        </Button>
      }
    >
      <div className={styles.layout}>
        {/* Steps rail */}
        <Card as="nav" className={styles.rail} aria-label="Creation steps">
          <p className="label" style={{ marginBottom: 8 }}>
            Steps
          </p>
          <ol className={styles.railList}>
            {steps.map((s, i) => {
              const state = i === step ? 'active' : i < step ? 'done' : 'todo';
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    className={styles.railStep}
                    data-state={state}
                    aria-current={i === step ? 'step' : undefined}
                    disabled={i > step || submitting}
                    onClick={() => {
                      if (i <= step && !submitting) setStep(i);
                    }}
                  >
                    <span className={styles.railDot} aria-hidden>
                      {state === 'done' ? <Icon name="Check" size={13} /> : i + 1}
                    </span>
                    <span className={styles.railText}>
                      <span className={styles.railTitle}>{s.t}</span>
                      <span className={styles.railSub}>{railSub(s.key)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </Card>

        {/* Main step */}
        <div className={styles.main}>
          <header className={styles.stepHead}>
            <p className="label">{`Step ${step + 1} of ${steps.length}`}</p>
            <h2 ref={headingRef} tabIndex={-1} className={styles.stepHeading}>
              {meta.heading}
            </h2>
            <p className={styles.stepIntro}>{meta.intro}</p>
          </header>

          <div className={styles.stepBody}>
            {stepKey === 'race' && (
              <RaceStep
                races={catalog.data.races}
                value={race}
                onChange={setRace}
                subrace={subrace}
                onSubraceChange={setSubrace}
                halfElfAsi={halfElfAsi}
                onToggleHalfElfAsi={toggleHalfElfAsi}
              />
            )}
            {stepKey === 'class' && (
              <ClassStep
                classes={catalog.data.classes}
                value={cls}
                onChange={setCls}
              />
            )}
            {stepKey === 'subclass' && clsObj && (
              <SubclassStep
                className={clsObj.name}
                options={subclassOptions}
                loadState={subclassLoadState}
                value={selectedSubclass}
                onChange={setSelectedSubclass}
                onRetry={() => setSubclassLoadKey((k) => k + 1)}
              />
            )}
            {stepKey === 'rung' && clsObj?.rungMenu && (
              <RungStep
                menu={clsObj.rungMenu}
                options={rungOptions}
                picked={rungPicks}
                onChange={setRungPicks}
              />
            )}
            {stepKey === 'abilities' && (
              <AbilitiesStep
                scores={scores}
                remaining={remaining}
                onStep={setScore}
                cls={clsObj}
              />
            )}
            {stepKey === 'background' && (
              <BackgroundStep
                backgrounds={catalog.data.backgrounds}
                value={background}
                onChange={setBackground}
                name={name}
                onName={setName}
              />
            )}
            {stepKey === 'skills' && (
              <SkillsStep
                className={clsObj?.name}
                options={skillOptions}
                count={clsObj?.skillCount ?? 0}
                picked={skillPicks}
                onChange={setSkillPicks}
              />
            )}
            {stepKey === 'equipment' && (
              <EquipmentStep
                clsObj={clsObj}
                bgObj={bgObj}
                selections={equipmentSelections}
                onSelectionsChange={setEquipmentSelections}
                onChoiceIdsChange={setEquipmentChoiceIds}
                onLoadStateChange={setEquipmentLoadState}
              />
            )}
            {stepKey === 'spells' && username && (
              <SpellsStep
                characterId={characterId}
                username={username}
                clsObj={clsObj}
                cantrips={spellCantrips}
                onCantrips={setSpellCantrips}
                leveled={spellLeveled}
                onLeveled={setSpellLeveled}
                onRequirement={setSpellReq}
              />
            )}
            {stepKey === 'review' && (
              <ReviewStep
                name={name}
                onName={setName}
                // Once a caster's character is silently created (leaving
                // Background), a Review-step name edit would be silently
                // dropped (submit only re-creates when characterId is null),
                // so lock the field here and point the user at the sheet.
                nameLocked={!!characterId}
                raceObj={raceObj}
                clsObj={clsObj}
                bgObj={bgObj}
                finalScores={finalScores}
                derived={derived}
                spellCantripCount={isCasterClass ? spellCantrips.size : undefined}
                spellLeveledCount={isCasterClass ? spellLeveled.size : undefined}
                subclassName={
                  hasSubclassStep
                    ? (subclassOptions.find((s) => s.id === selectedSubclass)?.name ?? undefined)
                    : undefined
                }
                rungPickNames={
                  hasRungStep
                    ? rungOptions.filter((o) => rungPicks.has(o.slug)).map((o) => o.name)
                    : undefined
                }
                rungMenuLabel={clsObj?.rungMenu?.label}
                skillPickNames={
                  hasSkillsStep ? Array.from(skillPicks).map((s) => humanizeSkill(s)) : undefined
                }
                pointsLabel={
                  isCasterClass && clsObj?.castingModel === 'points' ? clsObj.pointsLabel : undefined
                }
                setupIssues={setupIssues}
                onRetrySetup={setupIssues.length > 0 ? () => void handleRetrySetup() : undefined}
                retryingSetup={retryingSetup}
                retryAttempt={retryAttempt}
              />
            )}
          </div>

          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}

          <div className={styles.nav}>
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || submitting}
              aria-label="Back"
            >
              ← Back
            </Button>
            <span className={`mono ${styles.navCount}`}>
              {step + 1} / {steps.length}
            </span>
            <span className={styles.navSpacer} />
            {!canContinue && continueHint && (
              <span id="continue-hint" className={styles.srOnly}>
                {continueHint}
              </span>
            )}
            {step < steps.length - 1 ? (
              <Button
                variant="primary"
                size="lg"
                onClick={() => void handleContinue()}
                disabled={!canContinue || submitting}
                aria-describedby={!canContinue && continueHint ? 'continue-hint' : undefined}
              >
                {submitting ? 'Creating…' : 'Continue'}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                leadingIcon={<Icon name="Check" size={14} aria-hidden />}
              >
                {submitting ? 'Creating…' : 'Begin your campaign'}
              </Button>
            )}
          </div>
        </div>

        {/* Suzu commentary (ST-053) — real SSE-streamed narration. ABSENT (not an
            empty shell) when AI assist is off; no narration request is issued. */}
        {suzuEnabled && (
          <Card pop as="aside" className={styles.suzu} aria-label="Suzu's commentary">
            <div className={styles.suzuMascot}>
              <SuzuDM size={112} talking={suzuStreaming} aria-hidden />
            </div>
            <p className="label" style={{ fontSize: '0.7rem', marginBottom: 6 }}>
              Suzu
            </p>
            {/* aria-busy while streaming so AT announces the completed line once,
                not every cumulative chunk (per-line, not per-token — S3.5). */}
            <p className={styles.suzuLine} aria-live="polite" aria-busy={suzuStreaming || undefined}>
              &ldquo;{suzuDisplay}&rdquo;
            </p>
            <div className={styles.suzuWave}>
              <Waveform bars={26} height={20} active={suzuStreaming} />
            </div>
          </Card>
        )}
      </div>
    </TavernShell>
  );
}

// ── Step: Race ────────────────────────────────────────────────────────────────
// TAV-CREATE-SUBRACE-ASI-PICKER: two optional sub-pickers appear beneath the
// race grid once a race is selected — a subrace radiogroup (any race whose
// catalog data.subraces is non-empty, e.g. Elf -> High/Wood/Dark) and/or
// Half-Elf's floating "+1 to two other abilities" checkbox group (the +2 CHA
// is automatic/engine-applied, so Charisma isn't offered here). Both gate the
// step's Continue via canContinue in the parent.
function RaceStep({
  races,
  value,
  onChange,
  subrace,
  onSubraceChange,
  halfElfAsi,
  onToggleHalfElfAsi,
}: {
  races: WizardRace[];
  value: string | null;
  onChange: (id: string) => void;
  subrace: string | null;
  onSubraceChange: (name: string) => void;
  halfElfAsi: AbilityKey[];
  onToggleHalfElfAsi: (key: AbilityKey) => void;
}) {
  const selected = races.find((r) => r.id === value);
  return (
    <div>
      <fieldset className={styles.optGrid}>
        <legend className={styles.srOnly}>Choose a race</legend>
        {races.map((r) => (
          <label key={r.id} className={styles.optCard} data-selected={value === r.id}>
            <input
              type="radio"
              name="race"
              value={r.id}
              checked={value === r.id}
              onChange={() => onChange(r.id)}
              className={styles.srOnly}
            />
            <span className={styles.optIcon} aria-hidden>
              <Icon name={r.icon} size={18} />
            </span>
            <span className={styles.optName}>{r.name}</span>
            <span className={styles.optSub}>{r.sub}</span>
            <span className={`mono ${styles.optBonus}`}>{r.bonusLabel}</span>
          </label>
        ))}
      </fieldset>

      {selected && selected.subraces.length > 0 && (
        <div className={styles.subStep}>
          <p className="label" style={{ marginBottom: 10 }}>
            Subrace
          </p>
          <fieldset className={styles.bgGrid}>
            {/* Grammar: "an Elf"/"an Aarakocra" vs "a Dwarf" — pick the article
                from the race name's leading sound (vowel-letter heuristic). */}
            <legend className={styles.srOnly}>{`Choose ${indefiniteArticle(selected.name)} ${selected.name} subrace`}</legend>
            {selected.subraces.map((sr) => {
              // Cosmetic: buildBonusLabel() returns the literal "none" for a
              // subrace with no ability bonus (catalog.ts), which rendered as
              // noise ("none · 30 ft speed"). Drop it and keep only real traits.
              const traits = [
                sr.bonusLabel !== 'none' ? sr.bonusLabel : null,
                sr.speed ? `${sr.speed} ft speed` : null,
              ].filter(Boolean);
              return (
                <label key={sr.name} className={styles.bgCard} data-selected={subrace === sr.name}>
                  <input
                    type="radio"
                    name="subrace"
                    value={sr.name}
                    checked={subrace === sr.name}
                    onChange={() => onSubraceChange(sr.name)}
                    className={styles.srOnly}
                  />
                  <span className={styles.bgName}>{sr.name}</span>
                  {traits.length > 0 && (
                    <span className={`mono ${styles.bgSkills}`}>{traits.join(' · ')}</span>
                  )}
                </label>
              );
            })}
          </fieldset>
        </div>
      )}

      {selected?.needsAsiChoice && (
        <div className={styles.subStep}>
          <div className={styles.budget}>
            <span
              className={styles.budgetNum}
              aria-live="polite"
              aria-atomic="true"
              aria-label={`${halfElfAsi.length} of 2 ability scores chosen`}
            >
              {halfElfAsi.length}/2
            </span>
            <span>
              <span className={styles.budgetTitle}>Ability score increase</span>
              <span className={styles.budgetSub}>
                +2 Charisma is automatic. Choose two other abilities to raise by +1 each.
              </span>
            </span>
          </div>
          <fieldset className={styles.asiList}>
            <legend className={styles.srOnly}>
              Choose two abilities, other than Charisma, to increase by 1
            </legend>
            {/* TAV-A11Y-CAP-HINT: explain why the remaining options go disabled
                once both picks are spent. */}
            <p id="halfelf-asi-cap-hint" className={styles.srOnly}>
              You&rsquo;ve chosen both abilities — deselect one to change your picks.
            </p>
            {ABILITIES.filter((a) => a.key !== 'charisma').map((a) => {
              const checked = halfElfAsi.includes(a.key);
              const disabled = !checked && halfElfAsi.length >= 2;
              return (
                <label key={a.key} className={styles.asiOption} data-selected={checked}>
                  <input
                    type="checkbox"
                    className={styles.spellCheckbox}
                    checked={checked}
                    disabled={disabled}
                    aria-describedby={disabled ? 'halfelf-asi-cap-hint' : undefined}
                    onChange={() => onToggleHalfElfAsi(a.key)}
                  />
                  <span>{a.name} +1</span>
                </label>
              );
            })}
          </fieldset>
        </div>
      )}
    </div>
  );
}

// ── Step: Class ───────────────────────────────────────────────────────────────
function ClassStep({
  classes,
  value,
  onChange,
}: {
  classes: WizardClass[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset className={styles.optGrid}>
      <legend className={styles.srOnly}>Choose a class</legend>
      {classes.map((c) => (
        <label
          key={c.id}
          className={styles.optCard}
          data-selected={value === c.id}
          style={{
            ['--opt-accent' as string]: c.accent,
            // text-safe accent for the selected bonus label (candlelit AA)
            ['--opt-accent-ink' as string]: c.accentInk ?? c.accent,
          }}
        >
          <input
            type="radio"
            name="class"
            value={c.id}
            checked={value === c.id}
            onChange={() => onChange(c.id)}
            className={styles.srOnly}
          />
          <span className={styles.optIcon} aria-hidden>
            <Icon name={c.icon} size={18} />
          </span>
          <span className={styles.optName}>{c.name}</span>
          <span className={styles.optSub}>{c.flavor}</span>
          {/* TAV-CLASS-STAT-GUIDANCE — declared recommendation only; a class
              with no catalog guidance renders no chip (never fabricated). */}
          {c.primary.length > 0 && (
            <span className={`mono ${styles.optFocus}`}>
              Suggested focus: {abilityAbbrLabel(c.primary)}
            </span>
          )}
          <span className={`mono ${styles.optBonus}`}>d{c.hitDie} hit die</span>
        </label>
      ))}
    </fieldset>
  );
}

// ── Step: Subclass (TAV-WIZARD-HOMEBREW-CASTERS) ──────────────────────────────
// Mirrors ClassStep's exact card grid — native <input type="radio"> in a
// <label>, `.optGrid`/`.optCard` reused verbatim (design §5). Native radios
// get arrow-key roving for free from the browser; no custom keyboard
// handling needed (see LevelChoicePicker.tsx's note on why its OWN
// button-based radiogroups need radioStepIndex and this one doesn't).
function SubclassStep({
  className,
  options,
  loadState,
  value,
  onChange,
  onRetry,
}: {
  /** Display name of the chosen class, for copy ("archetypes for Shinobi"). */
  className: string;
  options: WizardSubclass[];
  loadState: 'loading' | 'ok' | 'error';
  value: string | null;
  onChange: (id: string) => void;
  /** Kage-CR IMPORTANT-2: bumps subclassLoadKey — the fetch effect's own
   *  deps never change on a plain step back/forward, so "go back and
   *  forward to retry" was false; a real retry needs a real trigger. */
  onRetry: () => void;
}) {
  if (loadState === 'loading') {
    return (
      <p className={styles.spellHint} aria-busy="true" aria-live="polite">
        Suzu is pulling up {className}&rsquo;s archetypes…
      </p>
    );
  }
  if (loadState === 'error') {
    return (
      <p className={styles.spellHint} role="alert">
        Suzu couldn&rsquo;t load {className}&rsquo;s archetypes right now.{' '}
        <Button variant="ghost" size="default" onClick={onRetry}>
          Retry
        </Button>
      </p>
    );
  }
  // Content-bug state (design's state table): a class that DECLARES
  // subclassLevel:1 but has zero seeded subclass rows. Never silently skip
  // the step — say so, and keep Continue disabled (value stays null).
  if (options.length === 0) {
    return (
      <p className={styles.spellHint} role="alert">
        No archetypes are seeded for {className} yet.
      </p>
    );
  }
  return (
    <fieldset className={styles.optGrid}>
      <legend className={styles.srOnly}>{`Choose ${className}'s archetype`}</legend>
      {options.map((s) => (
        <label key={s.id} className={styles.optCard} data-selected={value === s.id}>
          <input
            type="radio"
            name="subclass"
            value={s.id}
            checked={value === s.id}
            onChange={() => onChange(s.id)}
            className={styles.srOnly}
          />
          <span className={styles.optName}>{s.name}</span>
          {s.blurb && <span className={styles.optSub}>{s.blurb}</span>}
        </label>
      ))}
    </fieldset>
  );
}

// ── Step: Rung (TAV-WIZARD-HOMEBREW-CASTERS) ──────────────────────────────────
// Mirrors SpellsStep's fieldset+checklist pattern (design §6) — no live
// fetch, `menu.options` already rode in on the class catalog item; `options`
// prop here is the CALLER's pre-filtered set (scoped to the chosen
// archetype, computed in the parent as `rungOptions`).
function RungStep({
  menu,
  options,
  picked,
  onChange,
}: {
  menu: WizardRungMenu;
  options: FeatureChoiceOption[];
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const cap = menu.knownAtLevel1;

  // Non-freeform menu (future case, §3): read-only, no API call attempted —
  // finish this pick from the sheet after creation.
  if (!menu.freeform) {
    return (
      <p className={styles.spellHint}>
        {menu.label} isn&rsquo;t ready to pick here yet — finish this from the
        character sheet once you&rsquo;re created.
      </p>
    );
  }

  function toggle(slug: string) {
    const next = new Set(picked);
    if (next.has(slug)) {
      next.delete(slug);
    } else if (next.size < cap) {
      next.add(slug);
    }
    onChange(next);
  }

  return (
    <fieldset className={styles.spellSection}>
      <legend className={styles.srOnly}>{`Choose your ${menu.label}`}</legend>
      <div className={styles.budget}>
        <span
          className={styles.budgetNum}
          aria-live="polite"
          aria-atomic="true"
          // Iro-A11y MINOR-1: countedLabel (module-level, shared with the
          // nav continueHint) so the noun pluralizes at cap>1 — was a bare
          // `${cap} ${menu.label}` that never pluralized.
          aria-label={`${picked.size} of ${countedLabel(menu.label, cap)} chosen`}
        >
          {picked.size}/{cap}
        </span>
        <span>
          <span className={styles.budgetTitle}>{menu.label}</span>
          <span className={styles.budgetSub}>
            Pick {cap} to start — you&rsquo;ll unlock more as you grow.
          </span>
        </span>
      </div>
      {/* Iro-A11y CRITICAL-1 (TAV-A11Y-CAP-HINT, mirrors SpellsStep.renderRow
          exactly): explain why the remaining options go disabled once the
          cap is hit — native `disabled` drops a row from the Tab order, so a
          capped keyboard/switch user needs the reason surfaced some other
          way. */}
      <p id="rung-cap-hint" className={styles.srOnly}>
        {picked.size >= cap ? (
          <>
            You&rsquo;ve chosen all {countedLabel(menu.label, cap)} — deselect one to pick
            another.
          </>
        ) : (
          <>
            {picked.size} of {cap} {menu.label} chosen — pick {cap - picked.size} more.
          </>
        )}
      </p>
      <ul className={styles.spellList}>
        {options.length === 0 && (
          <li className={styles.spellEmpty}>
            No {menu.label.toLowerCase()} options for this archetype yet.
          </li>
        )}
        {options.map((o) => {
          const checked = picked.has(o.slug);
          const disabled = !checked && picked.size >= cap;
          // Iro-A11y MAJOR-1: descId only when there's a description to
          // associate — mirrors SpellsStep.renderRow's `hasMeta` gate so
          // aria-describedby never points at an id that isn't rendered.
          const descId = o.description ? `rung-desc-${o.slug}` : undefined;
          const describedBy =
            [descId, disabled ? 'rung-cap-hint' : undefined].filter(Boolean).join(' ') ||
            undefined;
          return (
            <li key={o.slug} className={styles.spellRow}>
              <label className={styles.spellRowLabel}>
                <input
                  type="checkbox"
                  className={styles.spellCheckbox}
                  checked={checked}
                  disabled={disabled}
                  aria-describedby={describedBy}
                  onChange={() => toggle(o.slug)}
                />
                <span className={styles.spellRowName}>{o.name}</span>
              </label>
              {o.description && (
                <p className={`mono ${styles.spellRowMeta}`} id={descId}>
                  {o.description}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

// ── Step: Skills (ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP, 2026-09-08) ──────────
// Mirrors RungStep's fieldset + native-checkbox + cap-hint mechanism above
// (same touch-target/aria-describedby idiom, new element ids so the two
// steps never collide when both render in the same DOM at different times)
// — the class's own skill_choices/skill_count, with `options` already
// excluding the chosen background's skills (see the parent's `skillOptions`
// derivation). No description/popover per option — the wire carries bare
// skill slugs, not FeatureChoiceOption objects.
function SkillsStep({
  className,
  options,
  count,
  picked,
  onChange,
}: {
  /** The chosen class's display name, for the legend/empty-state copy only. */
  className?: string;
  options: string[];
  count: number;
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  function toggle(skill: string) {
    const next = new Set(picked);
    if (next.has(skill)) {
      next.delete(skill);
    } else if (next.size < count) {
      next.add(skill);
    }
    onChange(next);
  }

  return (
    <fieldset className={styles.spellSection}>
      <legend className={styles.srOnly}>{`Choose ${className ?? 'your class'}'s skills`}</legend>
      <div className={styles.budget}>
        <span
          className={styles.budgetNum}
          aria-live="polite"
          aria-atomic="true"
          aria-label={`${picked.size} of ${countedLabel('skill', count)} chosen`}
        >
          {picked.size}/{count}
        </span>
        <span>
          <span className={styles.budgetTitle}>Class skills</span>
          <span className={styles.budgetSub}>
            Pick {count} — anything your background already grants isn&rsquo;t offered twice.
          </span>
        </span>
      </div>
      {/* Iro-A11y CRITICAL-1 precedent (TAV-A11Y-CAP-HINT, mirrors RungStep's
          own rung-cap-hint exactly): explain why the remaining options go
          disabled once the cap is hit. */}
      <p id="skills-cap-hint" className={styles.srOnly}>
        {picked.size >= count ? (
          <>You&rsquo;ve chosen all {countedLabel('skill', count)} — deselect one to pick another.</>
        ) : (
          <>
            {picked.size} of {count} skills chosen — pick {count - picked.size} more.
          </>
        )}
      </p>
      <ul className={styles.spellList}>
        {options.length === 0 && (
          <li className={styles.spellEmpty}>
            No class skills left to choose — {className ?? 'this class'}&rsquo;s whole list is
            already covered by your background.
          </li>
        )}
        {options.map((skill) => {
          const checked = picked.has(skill);
          const disabled = !checked && picked.size >= count;
          const describedBy = disabled ? 'skills-cap-hint' : undefined;
          return (
            <li key={skill} className={styles.spellRow}>
              <label className={styles.spellRowLabel}>
                <input
                  type="checkbox"
                  className={styles.spellCheckbox}
                  checked={checked}
                  disabled={disabled}
                  aria-describedby={describedBy}
                  onChange={() => toggle(skill)}
                />
                <span className={styles.spellRowName}>{humanizeSkill(skill)}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

// ── Step: Abilities (point buy) ───────────────────────────────────────────────
function AbilitiesStep({
  scores,
  remaining,
  onStep,
  cls,
}: {
  scores: AbilityScores;
  remaining: number;
  onStep: (key: AbilityKey, delta: number) => void;
  /** The chosen class, for the stat-guidance hint. Undefined (or a class
   *  with no declared guidance) renders no hint at all. */
  cls?: WizardClass;
}) {
  // TAV-CLASS-STAT-GUIDANCE — guidance, not command ("Suggested"), composed
  // ONLY from the class's declared catalog data: the primary-ability focus,
  // the spellcasting ability when it has one ("spellcasting runs off …"),
  // and the Unarmored Defense ability for barbarian/monk-likes. Static per
  // step (class is picked on an earlier step), so a plain paragraph — no
  // live region needed.
  const hintParts: string[] = [];
  if (cls) {
    if (cls.primary.length > 0) {
      hintParts.push(
        `Suggested focus for your ${cls.name}: ${abilityAbbrLabel(cls.primary)}.`,
      );
    }
    if (cls.spellcastingAbility) {
      hintParts.push(
        `Spellcasting runs off ${abilityDisplayName(cls.spellcastingAbility)}.`,
      );
    }
    if (cls.unarmoredDefenseAbility) {
      hintParts.push(
        `Unarmored Defense adds your ${abilityDisplayName(cls.unarmoredDefenseAbility)} modifier to AC.`,
      );
    }
  }
  return (
    <div>
      {hintParts.length > 0 && (
        <p className={styles.abilityHint}>{hintParts.join(' ')}</p>
      )}
      <div className={styles.budget}>
        <span
          className={styles.budgetNum}
          aria-live="polite"
          aria-atomic="true"
          aria-label={`${remaining} points remaining`}
        >
          {remaining}
        </span>
        <span>
          <span className={styles.budgetTitle}>
            {remaining === 0 ? 'All spent. Suzu approves.' : 'Points remaining'}
          </span>
          <span className={styles.budgetSub}>
            27 to spread. Costs: 9→1, 10→2, 11→3, 12→4, 13→5, 14→7, 15→9.
          </span>
        </span>
      </div>

      <div className={styles.abilityGrid}>
        {ABILITIES.map((a) => {
          const v = scores[a.key];
          const nextCost = costFor(v + 1) - costFor(v);
          const canInc = v < POINT_BUY_MAX && nextCost <= remaining;
          const canDec = v > POINT_BUY_MIN;
          return (
            <div key={a.key} className={styles.abilityCard} role="group" aria-label={a.name}>
              <div className={styles.abilityMeta}>
                <span className="label" style={{ fontSize: '0.72rem' }}>
                  {a.name}
                </span>
                <span className={styles.abilityBlurb}>{a.blurb}</span>
              </div>
              <div className={styles.abilityRight}>
                <span className={styles.abilityScore}>{v}</span>
                <span className={`mono ${styles.abilityMod}`}>{formatMod(v)}</span>
              </div>
              <div className={styles.stepper}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={`Decrease ${a.name}`}
                  onClick={() => onStep(a.key, -1)}
                  disabled={!canDec}
                >
                  −
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={`Increase ${a.name}`}
                  onClick={() => onStep(a.key, 1)}
                  disabled={!canInc}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Step: Background ──────────────────────────────────────────────────────────
function BackgroundStep({
  backgrounds,
  value,
  onChange,
  name,
  onName,
}: {
  backgrounds: WizardBackground[];
  value: string | null;
  onChange: (id: string) => void;
  name: string;
  onName: (v: string) => void;
}) {
  return (
    <div>
      <Card className={styles.nameCard}>
        <label className="label" htmlFor="char-name" style={{ marginBottom: 8, display: 'block' }}>
          Name
        </label>
        <input
          id="char-name"
          className="input"
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Velka of Little Hollow"
          maxLength={30}
          autoComplete="off"
        />
        <p className={styles.nameHint}>
          Suzu will use this. Often. Spell it the way you&rsquo;d like to hear it.
        </p>
      </Card>

      <p className="label" style={{ margin: '22px 0 10px' }}>
        Background
      </p>
      <fieldset className={styles.bgGrid}>
        <legend className={styles.srOnly}>Choose a background</legend>
        {backgrounds.map((b) => (
          <label key={b.id} className={styles.bgCard} data-selected={value === b.id}>
            <input
              type="radio"
              name="background"
              value={b.id}
              checked={value === b.id}
              onChange={() => onChange(b.id)}
              className={styles.srOnly}
            />
            <span className={styles.bgName}>{b.name}</span>
            {/* UIR2-TAV-22: an empty/whitespace-only blurb (background not
                yet decorated in BACKGROUND_DECORATION) must render nothing —
                never a literal "" — so the quote wrapper is guarded. */}
            {hasBackgroundBlurb(b.blurb) && (
              <span className={styles.bgBlurb}>&ldquo;{b.blurb}&rdquo;</span>
            )}
            <span className={styles.bgSkills}>
              {b.skills.map((s) => humanizeSkill(s)).join(' · ')}
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

// ── Step: Equipment (2026-07-24 Starting Equipment design) ───────────────────
// Applies to EVERY class (unlike Spells). Fetches GET /starting-equipment the
// moment class+background are both known — no character required, a pure
// function of the two. Renders each package's fixed grants read-only, then
// one radio group per choice group (class package's choices first, then the
// background package's), defaulted to each choice's first option on fetch
// success so a player who breezes through still gets valid gear. A failed
// fetch degrades gracefully — see the module doc comment — never hard-blocks.
type EquipmentLoadState = 'loading' | 'ok' | 'error';

function EquipmentStep({
  clsObj,
  bgObj,
  selections,
  onSelectionsChange,
  onChoiceIdsChange,
  onLoadStateChange,
}: {
  clsObj: WizardClass | undefined;
  bgObj: WizardBackground | undefined;
  selections: Record<string, string>;
  onSelectionsChange: (next: Record<string, string>) => void;
  onChoiceIdsChange: (ids: string[]) => void;
  onLoadStateChange: (state: EquipmentLoadState) => void;
}) {
  const [result, setResult] = useState<StartingEquipmentResult | null>(null);
  const [loadState, setLoadState] = useState<EquipmentLoadState>('loading');
  // Read inside the fetch effect without making `selections` a dependency —
  // re-running the fetch every time the player picks a radio would refetch
  // (and briefly flash a loading state) on every click. Only class/background
  // changes should re-fetch. Synced in its own effect (never during render —
  // React's react-hooks/refs rule forbids mutating a ref's `.current` in the
  // render body) so the fetch effect below always reads the latest value.
  const selectionsRef = useRef(selections);
  useEffect(() => {
    selectionsRef.current = selections;
  });

  useEffect(() => {
    if (!clsObj || !bgObj) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadState('loading');
    onLoadStateChange('loading');
    getStartingEquipment(clsObj.name, bgObj.name)
      .then((data) => {
        if (cancelled) return;
        setResult(data);
        setLoadState('ok');
        onLoadStateChange('ok');
        const ids: string[] = [];
        const merged: Record<string, string> = {};
        for (const pkg of [data.class_package, data.background_package]) {
          for (const choice of pkg.choices) {
            ids.push(choice.id);
            const existing = selectionsRef.current[choice.id];
            merged[choice.id] = existing ?? choice.options[0]?.id ?? '';
          }
        }
        onChoiceIdsChange(ids);
        onSelectionsChange(merged);
      })
      .catch(() => {
        if (cancelled) return;
        setResult(null);
        setLoadState('error');
        onLoadStateChange('error');
        onChoiceIdsChange([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clsObj?.name, bgObj?.name]);

  if (loadState === 'loading') {
    return (
      <p className={styles.spellHint} aria-busy="true" aria-live="polite">
        Suzu is checking what your class and background bring to the table…
      </p>
    );
  }

  if (loadState === 'error' || !result) {
    return (
      <p className={styles.spellHint} role="alert">
        Suzu couldn&rsquo;t load your starting gear right now — that&rsquo;s all right, you
        can add items from the character sheet once it&rsquo;s created instead.
      </p>
    );
  }

  const packages = [
    { label: `${clsObj?.name ?? 'Class'} gear`, pkg: result.class_package },
    { label: `${bgObj?.name ?? 'Background'} gear`, pkg: result.background_package },
  ];
  const anyFixed = packages.some(({ pkg }) => pkg.fixed.length > 0);
  const anyChoices = packages.some(({ pkg }) => pkg.choices.length > 0);

  function grantLabel(grants: { name: string; qty: number }[]): string {
    return grants.map((g) => (g.qty > 1 ? `${g.name} ×${g.qty}` : g.name)).join(', ');
  }

  return (
    <div>
      {anyFixed && (
        <div className={styles.equipSection}>
          <p className="label" style={{ marginBottom: 10 }}>
            You start with
          </p>
          <ul className={styles.equipFixedList}>
            {packages.flatMap(({ label, pkg }) =>
              pkg.fixed.map((grant) => (
                <li key={`${label}-${grant.slug}`} className={styles.equipFixedItem}>
                  <span className={styles.equipFixedName}>
                    {grant.qty > 1 ? `${grant.name} ×${grant.qty}` : grant.name}
                  </span>
                  {grant.description && (
                    <span className={styles.equipFixedDesc}>{grant.description}</span>
                  )}
                </li>
              )),
            )}
          </ul>
        </div>
      )}

      {!anyFixed && !anyChoices && (
        <p className={styles.spellHint}>
          Your class and background bring no starting gear of their own this time — Suzu
          shrugs. You can add items from the character sheet later.
        </p>
      )}

      {packages.map(({ label, pkg }) =>
        pkg.choices.map((choice) => {
          const legendId = `equip-choice-${choice.id}`;
          return (
            <fieldset key={choice.id} className={styles.equipSection} aria-labelledby={legendId}>
              <legend id={legendId} className={styles.equipPrompt}>
                {choice.prompt}
              </legend>
              <p className={styles.equipGroupSource}>{label}</p>
              <ul className={styles.equipOptionList}>
                {choice.options.map((option) => {
                  const checked = selections[choice.id] === option.id;
                  const descId = `equip-option-desc-${choice.id}-${option.id}`;
                  return (
                    <li key={option.id} className={styles.equipOption} data-selected={checked}>
                      <label className={styles.equipOptionLabel}>
                        <input
                          type="radio"
                          name={choice.id}
                          value={option.id}
                          checked={checked}
                          aria-describedby={option.grants.length > 0 ? descId : undefined}
                          onChange={() =>
                            onSelectionsChange({ ...selections, [choice.id]: option.id })
                          }
                          className={styles.spellCheckbox}
                        />
                        <span className={styles.equipOptionLabelText}>{option.label}</span>
                      </label>
                      {option.grants.length > 0 && (
                        <div className={styles.equipGrantDetail} id={descId}>
                          <p className={styles.equipGrantNames}>{grantLabel(option.grants)}</p>
                          {option.grants
                            .filter((g) => g.description)
                            .map((g) => (
                              <p key={g.slug} className={styles.equipGrantDesc}>
                                {g.description}
                              </p>
                            ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        }),
      )}
    </div>
  );
}

// ── Step: Review ──────────────────────────────────────────────────────────────
function ReviewStep({
  name,
  onName,
  nameLocked,
  raceObj,
  clsObj,
  bgObj,
  finalScores,
  derived,
  spellCantripCount,
  spellLeveledCount,
  subclassName,
  rungPickNames,
  rungMenuLabel,
  skillPickNames,
  pointsLabel,
  setupIssues,
  onRetrySetup,
  retryingSetup,
  retryAttempt,
}: {
  name: string;
  onName: (v: string) => void;
  /** True once a caster's character has been silently created — the name is
   *  already persisted, so editing it here would be lost; lock + hint instead. */
  nameLocked?: boolean;
  raceObj: WizardRace | undefined;
  clsObj: WizardClass | undefined;
  bgObj: WizardBackground | undefined;
  finalScores: AbilityScores;
  derived: ReturnType<typeof derivedStats>;
  /** T4/DDX-11t — undefined for a non-caster (no Spells step ran); a number
   *  (0 is valid — the picks are optional) once the Spells step has run. */
  spellCantripCount?: number;
  spellLeveledCount?: number;
  /** TAV-WIZARD-HOMEBREW-CASTERS — undefined when the class has no Subclass/
   *  Rung step; a name/label/list once picked (empty array is valid — the
   *  player may have zero rung picks selected only if cap is 0, which never
   *  happens while the step is gated on cap>0, but the type stays honest). */
  subclassName?: string;
  rungPickNames?: string[];
  rungMenuLabel?: string;
  /** ORACLE-CANDIDATE-1 / TAV-SKILLS-STEP — undefined when the class has no
   *  Skills step; a (possibly empty, same honesty as rungPickNames) list of
   *  humanized skill names once picked. */
  skillPickNames?: string[];
  /** The class's points-pool label, when castingModel==='points'. */
  pointsLabel?: string;
  /** Persistent "resume, not dead-end" callout content — empty = fully set up. */
  setupIssues?: string[];
  onRetrySetup?: () => void;
  retryingSetup?: boolean;
  /** Iro-A11y MINOR-4 — bumped on every still-failing retry so the alert's
   *  text content changes and role="alert" re-announces a repeated
   *  identical failure. 0 = never retried (no counter shown). */
  retryAttempt?: number;
}) {
  const initial = (name.trim() || '?').charAt(0).toUpperCase();
  const derivedRows: { label: string; value: string }[] = [
    { label: 'HP', value: String(derived.maxHp) },
    { label: 'AC', value: String(derived.ac) },
    { label: 'INIT', value: formatMod(finalScores.dexterity) },
    { label: 'PROF', value: `+${derived.proficiencyBonus}` },
    // F6b/MLP-SHEET-SPEED-CRASH (DDX21-1 precedent): a race's catalog `speed`
    // is typed as a plain number, but a dict-shaped multi-mode value (e.g.
    // MLP fly/swim speeds) can still arrive on the wire despite that type —
    // raceSpeedLabel is deliberately typed to accept `unknown` and always
    // reduces to a string, so this can never render "[object Object] ft".
    { label: 'SPD', value: raceSpeedLabel(derived.speed) },
  ];

  return (
    <div className={styles.review}>
      <Card pop className={styles.reviewHero}>
        <span
          className={styles.reviewAvatar}
          style={clsObj ? { ['--opt-accent' as string]: clsObj.accent } : undefined}
          aria-hidden
        >
          {initial}
        </span>
        <div className={styles.reviewIdentity}>
          <span className="label">
            {(bgObj?.name ?? 'background').toLowerCase()} · level 1
          </span>
          <h3 className={styles.reviewName}>{name.trim() || '(unnamed)'}</h3>
          <p className={styles.reviewSub}>
            {(raceObj?.name ?? 'race').toLowerCase()} · {(clsObj?.name ?? 'class').toLowerCase()}
          </p>
        </div>
        <dl className={styles.reviewStats}>
          {derivedRows.map((row) => (
            <div key={row.label} className={styles.reviewStat}>
              <dt className="label" style={{ fontSize: '0.7rem' }}>
                {row.label}
              </dt>
              <dd className={`mono ${styles.reviewStatValue}`}>{row.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* TAV-WIZARD-HOMEBREW-CASTERS — "resume, not dead-end" (§4/§7 of the
          design): a persistent callout, not a toast that vanishes before
          Review is reached. Character exists either way — this only ever
          points at a follow-up, never a blocker. role="alert" announces once
          on mount. */}
      {setupIssues && setupIssues.length > 0 && (
        <Card className={styles.setupIssues} role="alert">
          <p className={styles.setupIssuesTitle}>
            Setup incomplete
            {/* Iro-A11y MINOR-4: a repeated identical failure re-renders the
                SAME issue text — role="alert" only re-announces on a text
                CHANGE, so this counter is what makes attempt 2, 3, … actually
                differ from attempt 1 in the DOM. */}
            {!!retryAttempt && retryAttempt > 0 && ` (attempt ${retryAttempt + 1})`}
          </p>
          <ul id="setup-issues-list" className={styles.setupIssuesList}>
            {setupIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          {onRetrySetup && (
            <Button
              variant="ghost"
              size="default"
              disabled={retryingSetup}
              // Iro-A11y MINOR-2: label what the button retries — the
              // issues list itself, so its accessible description carries
              // the actual outstanding follow-ups, not just the button text.
              aria-describedby="setup-issues-list"
              onClick={onRetrySetup}
            >
              {retryingSetup ? 'Retrying…' : 'Retry setup'}
            </Button>
          )}
        </Card>
      )}

      <div className={styles.reviewCols}>
        <Card className={styles.reviewPanel}>
          <p className="label" style={{ marginBottom: 12 }}>
            Ability scores
          </p>
          <div className={styles.scoreGrid}>
            {ABILITIES.map((a) => (
              <div key={a.key} className={styles.scoreBox}>
                <span className="label" style={{ fontSize: '0.7rem' }}>
                  {a.abbr}
                </span>
                <span className={styles.scoreVal}>{finalScores[a.key]}</span>
                <span className={`mono ${styles.scoreMod}`}>
                  {formatMod(finalScores[a.key])}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className={styles.reviewPanel}>
          <p className="label" style={{ marginBottom: 12 }}>
            Proficiencies
          </p>
          <div className={styles.profGroup}>
            <span className={styles.profLabel}>Skills (background)</span>
            <div className={styles.profPills}>
              {(bgObj?.skills ?? []).map((s) => (
                <Pill key={s} tone="lav">
                  {humanizeSkill(s)}
                </Pill>
              ))}
              {!bgObj && <span className={styles.profEmpty}>pick a background</span>}
            </div>
          </div>
          {skillPickNames !== undefined && (
            <div className={styles.profGroup}>
              <span className={styles.profLabel}>Skills (class)</span>
              <div className={styles.profPills}>
                {skillPickNames.map((n) => (
                  <Pill key={n} tone="lav">
                    {n}
                  </Pill>
                ))}
                {skillPickNames.length === 0 && (
                  <span className={styles.profEmpty}>none picked</span>
                )}
              </div>
            </div>
          )}
          <div className={styles.profGroup}>
            <span className={styles.profLabel}>Saving throws (class)</span>
            <div className={styles.profPills}>
              {(clsObj?.saves ?? []).map((s) => (
                <Pill key={s} tone="muted">
                  {ABILITIES.find((a) => a.key === s)?.abbr ?? s}
                </Pill>
              ))}
              {!clsObj && <span className={styles.profEmpty}>pick a class</span>}
            </div>
          </div>
          {subclassName !== undefined && (
            <div className={styles.profGroup}>
              <span className={styles.profLabel}>Archetype</span>
              <div className={styles.profPills}>
                <Pill tone="lav">{subclassName}</Pill>
              </div>
            </div>
          )}
          {rungPickNames !== undefined && (
            <div className={styles.profGroup}>
              <span className={styles.profLabel}>{rungMenuLabel ?? 'Techniques'}</span>
              <div className={styles.profPills}>
                {rungPickNames.map((n) => (
                  <Pill key={n} tone="lav">
                    {n}
                  </Pill>
                ))}
                {rungPickNames.length === 0 && (
                  <span className={styles.profEmpty}>none picked</span>
                )}
              </div>
            </div>
          )}
          {spellCantripCount !== undefined && (
            <div className={styles.profGroup}>
              <span className={styles.profLabel}>Starting spells</span>
              <div className={styles.profPills}>
                <Pill tone="lav">{spellCantripCount} cantrip{spellCantripCount === 1 ? '' : 's'}</Pill>
                <Pill tone="lav">{spellLeveledCount ?? 0} 1st-level</Pill>
              </div>
              {/* TAV-WIZARD-HOMEBREW-CASTERS — the resource-model "pool
                  label" mention for a points caster (Chakra/Magic Power/Ki),
                  same static-string idiom as SpellsStep's own callout. */}
              {pointsLabel && (
                <span className={styles.profEmpty}>
                  Runs on {pointsLabel} — no fixed slots. You&rsquo;ll see your pool on the
                  sheet.
                </span>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card className={styles.reviewNameCard}>
        <label
          className="label"
          htmlFor="char-name-review"
          style={{ marginBottom: 8, display: 'block' }}
        >
          Name
        </label>
        <input
          id="char-name-review"
          className="input"
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Velka of Little Hollow"
          maxLength={30}
          autoComplete="off"
          disabled={nameLocked}
          aria-describedby={nameLocked ? 'char-name-review-hint' : undefined}
        />
        {nameLocked && (
          <p id="char-name-review-hint" className={styles.spellHint} style={{ marginTop: 6 }}>
            Name is set. You can rename from the character sheet later.
          </p>
        )}
      </Card>
    </div>
  );
}

// ── Step: Spells (T4/DDX-11t) ─────────────────────────────────────────────────
// Only rendered when the chosen class isCaster (see buildSteps). Fetches the
// REAL pool + budget for the character silently created leaving Background —
// same getAvailableSpells hop the shipped sheet Spells tab (SpellbookPanel)
// uses — rather than reimplementing the engine's per-class spell tables.
type SpellFetchState = 'loading' | 'ok' | 'error';

// TAV-SPELLPICK-DESCRIPTIONS v2 (LEVELUP-UX-A11Y-TAIL c): the engine now
// inlines `_spell_wire_info` (casting time/range/components/duration/
// description/higher levels) on every AvailableSpellEntry, so the wizard no
// longer fetches the whole spell catalog just for descriptions — the row
// meta line and the 🔍 overlay are both fed from the entry itself. The
// synthetic CatalogItem hands CodexDetailModal exactly the fields the entry
// carries: catalog-only extras (class list, damage dice, source badge)
// simply don't render, and an entry with no description keeps its 🔍
// disabled — the same graceful fallback the old catalog-fetch-failed path
// had. source_type is deliberately '' (the wire doesn't say; CodexDetail
// skips the badge for an empty label rather than mislabeling homebrew).
function spellEntryToCatalogItem(s: AvailableSpellEntry): CatalogItem {
  return {
    slug: s.slug,
    name: s.name,
    content_type: 'spell',
    source_type: '',
    data: {
      level: s.level,
      school: s.school,
      casting_time: s.casting_time,
      range: s.range,
      components: s.components as CatalogSpellData['components'],
      duration: s.duration,
      concentration: s.concentration,
      ritual: s.ritual,
      description: s.description,
      higher_levels: s.higher_levels,
    },
  };
}

function SpellsStep({
  characterId,
  username,
  clsObj,
  cantrips,
  onCantrips,
  leveled,
  onLeveled,
  onRequirement,
}: {
  characterId: string | null;
  username: string;
  clsObj: WizardClass | undefined;
  cantrips: Set<string>;
  onCantrips: (next: Set<string>) => void;
  leveled: Set<string>;
  onLeveled: (next: Set<string>) => void;
  // TAV-SPELLSTEP-CAP-MSG: reports the REQUIRED pick counts up to the wizard
  // once the catalog fetch lands (null on fetch error = wizard fails open).
  onRequirement: (
    req: { cantripsNeeded: number; leveledNeeded: number } | null,
  ) => void;
}) {
  const [available, setAvailable] = useState<AvailableSpellsResult | null>(null);
  const [fetchState, setFetchState] = useState<SpellFetchState>('loading');
  // TAV-SPELLPICK-OVERLAY: the one shared details overlay for both the
  // cantrip and 1st-level lists, driven by whichever row's 🔍 was clicked —
  // a synthetic CatalogItem built from that row's own inline wire info
  // (TAV-SPELLPICK-DESCRIPTIONS v2: no second catalog fetch anymore).
  const [openSpell, setOpenSpell] = useState<CatalogItem | null>(null);

  useEffect(() => {
    if (!characterId) return;
    let cancelled = false;
    // Canonical fetch-on-mount pattern (React docs "Fetching data" example):
    // set loading state, then resolve/reject into local state guarded by a
    // `cancelled` flag. There's no external store to subscribe to here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFetchState('loading');
    getAvailableSpells(characterId, username)
      .then((data) => {
        if (cancelled) return;
        setAvailable(data);
        setFetchState('ok');
        // TAV-SPELLSTEP-CAP-MSG: min(cap, catalog size) — a thin dev catalog
        // must never wedge Continue behind picks that don't exist.
        const kind = clsObj?.casterKind ?? 'known';
        const lvlCap =
          kind === 'known'
            ? (data.budget.spells_max ?? 0)
            : kind === 'prepared'
              ? (data.budget.prepared_max ?? 0)
              : WIZARD_LEVEL1_SPELLBOOK_SIZE;
        onRequirement({
          cantripsNeeded: Math.min(data.budget.cantrips_max, data.cantrips.length),
          leveledNeeded: Math.min(lvlCap, (data.by_level['1'] ?? []).length),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setFetchState('error');
          onRequirement(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [characterId, username, clsObj, onRequirement]);

  function toggle(picked: Set<string>, onChange: (n: Set<string>) => void, slug: string, cap: number) {
    const next = new Set(picked);
    if (next.has(slug)) {
      next.delete(slug);
    } else if (next.size < cap) {
      next.add(slug);
    }
    onChange(next);
  }

  if (!characterId || fetchState === 'loading') {
    return (
      <p className={styles.spellHint} aria-busy="true" aria-live="polite">
        Setting up your spellbook…
      </p>
    );
  }

  if (fetchState === 'error' || !available) {
    return (
      <p className={styles.spellHint} role="alert">
        Suzu couldn&rsquo;t load your class&rsquo;s spell list right now — that&rsquo;s all
        right, you can pick your starting spells from the character sheet once it&rsquo;s
        created instead.
      </p>
    );
  }

  const cantripCap = available.budget.cantrips_max;
  const leveledKind = clsObj?.casterKind ?? 'known';
  const leveledCap =
    leveledKind === 'known'
      ? (available.budget.spells_max ?? 0)
      : leveledKind === 'prepared'
        ? (available.budget.prepared_max ?? 0)
        : WIZARD_LEVEL1_SPELLBOOK_SIZE;
  // TAV-SPELLPICK-POOL-GROUPING: both lists are a single spell level each
  // (cantrips, 1st-level) so no by-level grouping applies here — just sort by
  // name for a stable, scannable order (was insertion order off the wire).
  const sortedCantrips = [...available.cantrips].sort((a, b) => a.name.localeCompare(b.name));
  const level1 = [...(available.by_level['1'] ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const renderRow = (
    s: AvailableSpellEntry,
    picked: Set<string>,
    onChange: (n: Set<string>) => void,
    cap: number,
    capHintId: string,
  ) => {
    const checked = picked.has(s.slug);
    const disabled = !checked && picked.size >= cap;
    // TAV-SPELLPICK-DESCRIPTIONS v2: the meta line reads the entry's own
    // inline wire info. A pre-upgrade backend (no inline fields) renders
    // name+school only — the same fallback the old catalog-fetch-failed
    // path had.
    const hasMeta = Boolean(s.casting_time || s.range || s.components);
    const descId = hasMeta ? `spell-desc-${s.slug}` : undefined;
    const describedBy = [descId, disabled ? capHintId : undefined].filter(Boolean).join(' ') || undefined;
    return (
      <li key={s.slug} className={styles.spellRow}>
        <div className={styles.spellRowTop}>
          <label className={styles.spellRowLabel}>
            <input
              type="checkbox"
              className={styles.spellCheckbox}
              checked={checked}
              disabled={disabled}
              // TAV-A11Y-CAP-HINT: when the pick cap is hit, the extra rows go
              // disabled with no spoken reason. Point AT at the section's hidden
              // explanation so "dimmed, unavailable" gains a "why". Also carries
              // the row's meta-line id (TAV-SPELLPICK-DESCRIPTIONS) when known.
              aria-describedby={describedBy}
              onChange={() => toggle(picked, onChange, s.slug, cap)}
            />
            <span className={styles.spellRowName}>{s.name}</span>
            {/* Iro MINOR-1: hide the school from the checkbox's accessible name —
             * without this a screen reader announces "Fire Bolt evocation" as
             * the label instead of just the spell name. */}
            <span className={`mono ${styles.spellRowSchool}`} aria-hidden="true">
              {s.school}
            </span>
          </label>
          {/* TAV-SPELLPICK-OVERLAY: a sibling of the <label>, not nested inside
           * it — descendants of a <label> fold into its control's accessible
           * name, which would make every checkbox's name include "View X
           * details". Opens the shared CodexDetailModal (same component the
           * read-only Codex uses) with a synthetic item built from this row's
           * inline wire info. Disabled when the entry carries no description
           * (pre-upgrade backend / a spell with none recorded) — nothing
           * meaningful to show. */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={styles.spellRowDetailBtn}
            aria-label={`View ${s.name} details`}
            disabled={!s.description}
            onClick={() => setOpenSpell(spellEntryToCatalogItem(s))}
          >
            <Icon name="Search" size={14} />
          </Button>
        </div>
        {/* TAV-SPELLPICK-DESCRIPTIONS: a sibling of the <label>, not nested
         * inside it — descendants of a <label> are folded into its control's
         * accessible name. Linked instead via aria-describedby above. Compact
         * card meta line only (level · casting time · range · components) —
         * the full description/higher-levels text lives in the 🔍 overlay now. */}
        {hasMeta && (
          <p className={`mono ${styles.spellRowMeta}`} id={descId}>
            {[
              spellLevelLabel(s.level),
              s.casting_time ?? '—',
              s.range ?? '—',
              spellComponentsLabel({
                level: s.level,
                components: s.components as CatalogSpellData['components'],
              }),
            ].join(' · ')}
          </p>
        )}
      </li>
    );
  };

  return (
    <div>
      {/* TAV-WIZARD-HOMEBREW-CASTERS — a points caster (Chakra/Magic Power/
          Ki) has no fixed slots to preview; static string, no new fetch (the
          engine's own budget shape is identical either way — see the design
          doc's §"What I changed from a literal reading" item 3). */}
      {clsObj?.castingModel === 'points' && (
        <p className={styles.spellHint}>
          Runs on {clsObj.pointsLabel ?? 'spell points'} — no fixed slots. You&rsquo;ll see
          your pool on the sheet.
        </p>
      )}
      {/* TAV-A11Y-SPELLSTEP-FIELDSET: group each checkbox list under a fieldset
          with an sr-only legend (mirrors the Race step's ASI/subrace groups) so a
          screen reader announces "Cantrips group" / "1st-level spells group"
          around the choices instead of a bare list of orphan checkboxes. */}
      <fieldset className={styles.spellSection}>
        <legend className={styles.srOnly}>Choose your cantrips</legend>
        <div className={styles.budget}>
          <span
            className={styles.budgetNum}
            aria-live="polite"
            aria-atomic="true"
            aria-label={`${cantrips.size} of ${cantripCap} cantrips chosen`}
          >
            {cantrips.size}/{cantripCap}
          </span>
          <span>
            <span className={styles.budgetTitle}>Cantrips</span>
            <span className={styles.budgetSub}>Free tricks — cast any time, no slot spent.</span>
          </span>
        </div>
        <p id="cantrip-cap-hint" className={styles.srOnly}>
          {cantrips.size >= cantripCap ? (
            <>You&rsquo;ve chosen all {cantripCap} cantrips — deselect one to pick another.</>
          ) : (
            // TAV-SPELLSTEP-CAP-MSG: the at-cap line used to render
            // unconditionally — an SR user at 0/2 was told they'd already
            // picked everything. Say what's actually true.
            <>
              {cantrips.size} of {cantripCap} cantrips chosen — pick{' '}
              {cantripCap - cantrips.size} more.
            </>
          )}
        </p>
        <ul className={styles.spellList}>
          {sortedCantrips.length === 0 && (
            <li className={styles.spellEmpty}>No cantrips for this class.</li>
          )}
          {sortedCantrips.map((s) =>
            renderRow(s, cantrips, onCantrips, cantripCap, 'cantrip-cap-hint'),
          )}
        </ul>
      </fieldset>

      <fieldset className={styles.spellSection}>
        <legend className={styles.srOnly}>Choose your 1st-level spells</legend>
        <div className={styles.budget}>
          <span
            className={styles.budgetNum}
            aria-live="polite"
            aria-atomic="true"
            aria-label={`${leveled.size} of ${leveledCap} first level spells chosen`}
          >
            {leveled.size}/{leveledCap}
          </span>
          <span>
            <span className={styles.budgetTitle}>1st-level spells</span>
            <span className={styles.budgetSub}>
              {leveledKind === 'prepared'
                ? 'Chosen from your full class list — you re-prepare daily once you adventure.'
                : 'Learned into your repertoire for good.'}
            </span>
          </span>
        </div>
        <p id="leveled-cap-hint" className={styles.srOnly}>
          {leveled.size >= leveledCap ? (
            <>
              You&rsquo;ve chosen all {leveledCap} first-level spells — deselect one to pick
              another.
            </>
          ) : (
            <>
              {leveled.size} of {leveledCap} first-level spells chosen — pick{' '}
              {leveledCap - leveled.size} more.
            </>
          )}
        </p>
        <ul className={styles.spellList}>
          {level1.length === 0 && (
            <li className={styles.spellEmpty}>No 1st-level spells for this class yet.</li>
          )}
          {level1.map((s) => renderRow(s, leveled, onLeveled, leveledCap, 'leveled-cap-hint'))}
        </ul>
      </fieldset>

      {/* TAV-SPELLPICK-OVERLAY: one shared overlay for every row's 🔍, driven
          by `openSpell` — reuses /codex's own detail modal (portal dialog,
          focus-trap, Escape, backdrop-click) rather than a bespoke dialog. */}
      <CodexDetailModal
        open={openSpell !== null}
        item={openSpell}
        kind="spell"
        onClose={() => setOpenSpell(null)}
      />
    </div>
  );
}

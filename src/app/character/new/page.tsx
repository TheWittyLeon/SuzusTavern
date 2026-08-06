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
 * gated on WizardClass.isCaster — see helpers.ts's CLASS_CASTER_KIND) gets a
 * 7th "Spells" step inserted between Equipment and Review (T4/DDX-11t).
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
  getStartingEquipment,
  learnSpell,
  prepareSpell,
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
  pointsRemaining,
  type AbilityKey,
  type AbilityScores,
} from '@/lib/dnd/helpers';
import { indefiniteArticle } from '@/lib/text/indefiniteArticle';
import type { WizardRace, WizardClass, WizardBackground } from '@/lib/dnd/catalog';
import type {
  ApiError,
  AvailableSpellEntry,
  AvailableSpellsResult,
  CatalogItem,
  CatalogSpellData,
  EquipmentSelection,
  StartingEquipmentResult,
} from '@/lib/api/types';
import styles from './CharacterCreate.module.css';

type StepKey = 'race' | 'class' | 'abilities' | 'background' | 'equipment' | 'spells' | 'review';

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

function buildSteps(isCaster: boolean): StepMeta[] {
  return isCaster ? [...BASE_STEPS, SPELLS_STEP, REVIEW_STEP] : [...BASE_STEPS, REVIEW_STEP];
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

const GENERIC_CREATE_ERROR =
  "Suzu couldn’t write that down. Check your choices and try again in a moment.";

/**
 * TAV-CREATE-DEADEND-DIAGNOSABLE: best-effort human-readable message for a
 * failed createNow() call, replacing the old always-generic string. The
 * engine's own error wire shape (NekoNova-DnDEngine routes/characters.py's
 * `_err()`) is `{success: false, message: <human string>, data: {reason?}}`
 * — `err.body.message` IS the engine's own explanation of what was rejected
 * (e.g. an invalid race/subrace/ASI combination), already written to be
 * shown to a player. `client.ts`'s apiFetch attaches the full parsed body
 * verbatim as `err.body` on every non-2xx response, so this is always
 * available except for a genuine network/abort failure or a malformed body
 * — those fall back to the generic line, never to an undefined/`[object
 * Object]` render.
 */
function describeCreateError(err: unknown): string {
  if (!(err instanceof Error)) return GENERIC_CREATE_ERROR;
  const body = (err as ApiError).body;
  if (body && typeof body === 'object') {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return GENERIC_CREATE_ERROR;
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
  const { user } = useAuth();
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

  // Manage focus across catalog state transitions (Iro a11y MAJOR-1): on error
  // (initial or after a failed retry) move focus to the "Try again" button so the
  // alert is reachable and re-announced; once the catalog resolves after a retry,
  // move focus to the wizard step heading instead of dropping it at document top.
  useEffect(() => {
    if (catalog.status === 'error') {
      errorRetryRef.current?.focus();
    } else if (catalog.status === 'ok' && mountedRef.current) {
      headingRef.current?.focus();
    }
  }, [catalog.status]);

  const raceObj = catalog.data.races.find((r) => r.id === race);
  const clsObj = catalog.data.classes.find((c) => c.id === cls);
  const bgObj = catalog.data.backgrounds.find((b) => b.id === background);
  const isCasterClass = !!clsObj?.isCaster;

  // TAV-CREATE-SUBRACE-ASI-PICKER — gates the Race step's pickers/Continue.
  const raceHasSubraces = (raceObj?.subraces.length ?? 0) > 0;
  const raceNeedsAsi = !!raceObj?.needsAsiChoice;
  const selectedSubrace = raceObj?.subraces.find((sr) => sr.name === subrace);

  // T4/DDX-11t — the step list adapts to the chosen class (Spells only for a
  // caster). Recomputed whenever the class changes.
  const steps = useMemo(() => buildSteps(isCasterClass), [isCasterClass]);
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
    }
  }, [cls]);

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
        if (raceHasSubraces && !subrace) return false;
        if (raceNeedsAsi && halfElfAsi.length !== 2) return false;
        return true;
      case 'class':
        return !!cls;
      case 'abilities':
        return remaining >= 0;
      case 'background':
        return !!background && name.trim().length > 0;
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
      // 'spells' and 'review' — the Spells step is optional (pick as few or
      // as many as you like up to budget); Review's Continue is the submit
      // button, gated separately by canSubmit below.
      default:
        return true;
    }
  }, [
    stepKey,
    race,
    raceHasSubraces,
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
    (!raceHasSubraces || !!subrace) &&
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
    if (raceHasSubraces && !subrace) return 'Choose a subrace before continuing.';
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
    raceHasSubraces,
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

  // Nav "Continue" — the ONE special case is Equipment -> Spells for a
  // caster: the character must exist before the Spells step can fetch a real
  // pool/budget (see the module doc comment), so this is async there and
  // synchronous everywhere else. Moved here (was Background -> Spells) by
  // the 2026-07-24 Starting Equipment design so equipment_selections are
  // already collected when this POST fires.
  const handleContinue = useCallback(async () => {
    const idx = steps.findIndex((s) => s.key === stepKey);
    const next = steps[idx + 1];
    if (stepKey === 'equipment' && next?.key === 'spells' && !characterId) {
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
  }, [steps, stepKey, characterId, canCreatePrereqs, missingPrereqsReason, createNow, snapshotNow]);

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
      } else if (createdSnapshot && !snapshotsEqual(createdSnapshot, snapshotNow())) {
        staleCharId = charId;
        charId = await createNow();
        setCharacterId(charId);
        setCreatedSnapshot(snapshotNow());
      }

      // Caster path: batch-apply the spell picks against whichever character
      // is now current (the original silent create, or its replacement).
      // Cantrips are always a `learn`; leveled picks are `learn` for known/
      // spellbook casters or `prepare` for a prepared caster (cleric/druid —
      // see CLASS_CASTER_KIND's docstring in helpers.ts). Best-effort: a
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
    isCasterClass,
    username,
    clsObj,
    spellCantrips,
    spellLeveled,
    toast,
    router,
  ]);

  // ── Suzu's line for the current step ──────────────────────────────────────────
  let suzuLine: string;
  if (stepKey === 'race') suzuLine = race ? (SUZU_LINES.race[race] ?? 'An unusual choice. Suzu is intrigued.') : 'Take your time. The tavern will keep.';
  else if (stepKey === 'class') suzuLine = cls ? (SUZU_LINES.class[cls] ?? 'An interesting calling.') : 'Pick a verb.';
  else if (stepKey === 'abilities') suzuLine = abilitiesComment(scores);
  else if (stepKey === 'background')
    suzuLine = name.trim()
      ? `${name.trim()}. Suzu likes the sound of it.`
      : 'Names matter. Even the ones you change later.';
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
        : stepKey === 'abilities'
          ? `In one wry sentence, react to how I've spread my character's ability scores.`
          : stepKey === 'background'
            ? `In one wry sentence, react to my character's name and background: ${name.trim() || 'unnamed'}, ${bgObj?.name ?? 'no background yet'}.`
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
        : raceHasSubraces && !subrace
          ? 'Select a subrace to continue.'
          : raceNeedsAsi && halfElfAsi.length !== 2
            ? 'Choose two ability scores to increase to continue.'
            : ''
      : stepKey === 'class'
        ? 'Select a class to continue.'
        : stepKey === 'background'
          ? 'Enter a name and choose a background to continue.'
          : stepKey === 'equipment' && equipmentLoadState === 'loading'
            ? 'Loading your starting equipment…'
            : '';

  const totalSpellPicks = spellCantrips.size + spellLeveled.size;
  const railSub = (key: StepKey): string => {
    switch (key) {
      case 'race':
        return raceObj ? (subrace ? `${raceObj.name} · ${subrace}` : raceObj.name) : '—';
      case 'class':
        return clsObj?.name ?? '—';
      case 'abilities': {
        // TAV-28: pluralize so a single point reads "1 pt spent", not "1 pts".
        const spent = POINT_BUY_BUDGET - remaining;
        return `${spent} ${spent === 1 ? 'pt' : 'pts'} spent`;
      }
      case 'background':
        return bgObj?.name ?? (name.trim() ? name.trim() : '—');
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

  // ── Catalog error state — surface a retry UI, not a crash ─────────────────────
  if (catalog.status === 'error') {
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
          <p id="catalog-error-body" className={styles.catalogErrorBody}>
            The race, class, and background lists couldn&rsquo;t be loaded. Check your connection
            or try again in a moment.
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
          {spellCantripCount !== undefined && (
            <div className={styles.profGroup}>
              <span className={styles.profLabel}>Starting spells</span>
              <div className={styles.profPills}>
                <Pill tone="lav">{spellCantripCount} cantrip{spellCantripCount === 1 ? '' : 's'}</Pill>
                <Pill tone="lav">{spellLeveledCount ?? 0} 1st-level</Pill>
              </div>
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
}: {
  characterId: string | null;
  username: string;
  clsObj: WizardClass | undefined;
  cantrips: Set<string>;
  onCantrips: (next: Set<string>) => void;
  leveled: Set<string>;
  onLeveled: (next: Set<string>) => void;
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
      })
      .catch(() => {
        if (!cancelled) setFetchState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [characterId, username]);

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
          You&rsquo;ve chosen all {cantripCap} cantrips — deselect one to pick another.
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
          You&rsquo;ve chosen all {leveledCap} first-level spells — deselect one to pick another.
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

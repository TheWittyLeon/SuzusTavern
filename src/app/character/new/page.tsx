'use client';
/**
 * Character creation wizard — /character/new (ST-047–052, S2.4).
 *
 * Race/class/background lists are fetched LIVE from the engine catalog via
 * GET /api/dnd/catalog (useCatalog hook). The hardcoded srd.ts mirror has been
 * deleted (S2.4). If the catalog fetch fails, the wizard shows an error/retry
 * state — it does not fall back to a hardcoded list.
 *
 * 5 steps for a non-caster: Race → Class → Abilities (27-point buy) →
 * Background → Review. A CASTER class (wizard/cleric/sorcerer/…, gated on
 * WizardClass.isCaster — see helpers.ts's CLASS_CASTER_KIND) gets a 6th
 * "Spells" step inserted between Background and Review (T4/DDX-11t).
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
 * Background step (Continue → Spells) rather than at Review — the Spells
 * step then fetches the real pool/budget for that just-created character via
 * getAvailableSpells, same hop the shipped sheet Spells tab (SpellbookPanel)
 * uses. Review still reads as the final look (now including the spells you
 * picked) and "Begin your campaign" still does exactly one thing per path:
 * non-caster → create the character; caster → the character already exists,
 * so this batch-applies the picks via learnSpell/prepareSpell (sequential,
 * best-effort — a failed pick surfaces a toast but does not block navigating
 * to the new sheet, since the character itself was already created).
 *
 * Edit-after-create caveat: changing race/abilities/background/name AFTER a
 * caster's character has been silently created does NOT retroactively
 * update it (known limitation, documented in the DDX-11t handoff — the
 * straight-through creation flow this ships for is unaffected). Changing
 * CLASS after creation, however, invalidates the stale character (and its
 * picks) outright so Review never POSTs spells against the wrong class.
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
import { createCharacter, getAvailableSpells, learnSpell, prepareSpell } from '@/lib/api/dnd';
import { useCatalog } from '@/lib/dnd/useCatalog';
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
import {
  ABILITIES,
  DEFAULT_SCORES,
  POINT_BUY_BUDGET,
  POINT_BUY_MAX,
  POINT_BUY_MIN,
  SUZU_LINES,
  WIZARD_LEVEL1_SPELLBOOK_SIZE,
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
import type { WizardRace, WizardClass, WizardBackground } from '@/lib/dnd/catalog';
import type { AvailableSpellEntry, AvailableSpellsResult } from '@/lib/api/types';
import styles from './CharacterCreate.module.css';

type StepKey = 'race' | 'class' | 'abilities' | 'background' | 'spells' | 'review';

interface StepMeta {
  key: StepKey;
  t: string;
  heading: string;
  intro: string;
}

// Base 5 steps, always present. "Spells" (T4/DDX-11t) is spliced in between
// Background and Review — ONLY for a caster class — by buildSteps below, so
// the kicker ("Step N of TOTAL") and every index-sensitive bit of UI derives
// from the built array's length/position rather than a hardcoded "of 5".
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
  const [spellCantrips, setSpellCantrips] = useState<Set<string>>(new Set());
  const [spellLeveled, setSpellLeveled] = useState<Set<string>>(new Set());

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
      setSpellCantrips(new Set());
      setSpellLeveled(new Set());
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
      // 'spells' and 'review' — the Spells step is optional (pick as few or
      // as many as you like up to budget); Review's Continue is the submit
      // button, gated separately by canSubmit below.
      default:
        return true;
    }
  }, [stepKey, race, raceHasSubraces, subrace, raceNeedsAsi, halfElfAsi, cls, remaining, background, name]);

  const canCreatePrereqs =
    !!username &&
    !!raceObj &&
    !!clsObj &&
    !!bgObj &&
    name.trim().length > 0 &&
    remaining >= 0 &&
    (!raceHasSubraces || !!subrace) &&
    (!raceNeedsAsi || halfElfAsi.length === 2);

  const canSubmit = canCreatePrereqs && !submitting;

  // POST /api/dnd/characters. Shared by handleContinue's silent caster-path
  // create (leaving Background) and handleSubmit's non-caster-path create
  // (Review) — same payload either way.
  const createNow = useCallback(async (): Promise<string> => {
    if (!username || !raceObj || !clsObj || !bgObj || !name.trim()) {
      throw new Error('missing required fields');
    }
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
    });
    if (!created.character_id) throw new Error('missing character_id');
    return created.character_id;
  }, [username, raceObj, clsObj, bgObj, name, scores, subrace, raceNeedsAsi, halfElfAsi]);

  // Nav "Continue" — the ONE special case is Background -> Spells for a
  // caster: the character must exist before the Spells step can fetch a real
  // pool/budget (see the module doc comment), so this is async there and
  // synchronous everywhere else.
  const handleContinue = useCallback(async () => {
    const idx = steps.findIndex((s) => s.key === stepKey);
    const next = steps[idx + 1];
    if (stepKey === 'background' && next?.key === 'spells' && !characterId) {
      if (!canCreatePrereqs) return;
      setSubmitting(true);
      setError(null);
      try {
        const id = await createNow();
        setCharacterId(id);
        setStep((s) => Math.min(steps.length - 1, s + 1));
      } catch {
        setError(
          "Suzu couldn’t write that down. Check your choices and try again in a moment.",
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setStep((s) => Math.min(steps.length - 1, s + 1));
  }, [steps, stepKey, characterId, canCreatePrereqs, createNow]);

  const handleSubmit = useCallback(async () => {
    if (!canCreatePrereqs && !characterId) return;
    setSubmitting(true);
    setError(null);
    try {
      let charId = characterId;
      if (!charId) charId = await createNow();

      // Caster path: the character already existed (silently created leaving
      // Background) — batch-apply the picks now. Cantrips are always a
      // `learn`; leveled picks are `learn` for known/spellbook casters or
      // `prepare` for a prepared caster (cleric/druid — see
      // CLASS_CASTER_KIND's docstring in helpers.ts). Best-effort: a failed
      // pick surfaces a toast but never blocks navigating to the new sheet —
      // the character itself was already created successfully.
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
          const failed = results.filter((r) => r.status === 'rejected').length;
          if (failed > 0) {
            toast({
              message: `Character created, but ${failed} starting spell${failed > 1 ? 's' : ''} couldn’t be added. You can add ${failed > 1 ? 'them' : 'it'} from the sheet.`,
              tone: 'warn',
            });
          }
        }
      }

      router.push(`/character/${encodeURIComponent(charId)}`);
    } catch {
      setError(
        "Suzu couldn’t write that down. Check your choices and try again in a moment.",
      );
      setSubmitting(false);
    }
  }, [
    canCreatePrereqs,
    characterId,
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
              <AbilitiesStep scores={scores} remaining={remaining} onStep={setScore} />
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
/** "a" / "an" for a following word, by its leading vowel letter. Good enough for
 *  the SRD race names we surface (Elf → "an", Dwarf → "a", Aarakocra → "an"). */
function indefiniteArticle(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word.trim()) ? 'an' : 'a';
}

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
}: {
  scores: AbilityScores;
  remaining: number;
  onStep: (key: AbilityKey, delta: number) => void;
}) {
  return (
    <div>
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
    { label: 'SPD', value: `${derived.speed} ft` },
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
    return (
      <li key={s.slug} className={styles.spellRow}>
        <label className={styles.spellRowLabel}>
          <input
            type="checkbox"
            className={styles.spellCheckbox}
            checked={checked}
            disabled={disabled}
            // TAV-A11Y-CAP-HINT: when the pick cap is hit, the extra rows go
            // disabled with no spoken reason. Point AT at the section's hidden
            // explanation so "dimmed, unavailable" gains a "why".
            aria-describedby={disabled ? capHintId : undefined}
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
    </div>
  );
}

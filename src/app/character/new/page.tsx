'use client';
/**
 * Character creation wizard — /character/new (ST-047–052, S2.4).
 *
 * Race/class/background lists are fetched LIVE from the engine catalog via
 * GET /api/dnd/catalog (useCatalog hook). The hardcoded srd.ts mirror has been
 * deleted (S2.4). If the catalog fetch fails, the wizard shows an error/retry
 * state — it does not fall back to a hardcoded list.
 *
 * 5 steps: Race → Class → Abilities (27-point buy) → Background → Review.
 * All choices are held in local React state; the only server call is the final
 * POST /api/dnd/characters (ST-052). The engine validates race/class and the
 * point-buy spread server-side and applies racial bonuses — we POST the BASE
 * (pre-racial) scores; the review preview applies bonuses locally only for
 * display, mirroring the engine so what you see equals what gets saved.
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
import { createCharacter } from '@/lib/api/dnd';
import { useCatalog } from '@/lib/dnd/useCatalog';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Card from '@/components/Card';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import Icon from '@/components/Icon';
import SuzuDM from '@/components/SuzuDM';
import Waveform from '@/components/Waveform';
import {
  ABILITIES,
  DEFAULT_SCORES,
  POINT_BUY_BUDGET,
  POINT_BUY_MAX,
  POINT_BUY_MIN,
  SUZU_LINES,
  applyRacialBonuses,
  costFor,
  derivedStats,
  formatMod,
  humanizeSkill,
  pointsRemaining,
  type AbilityKey,
  type AbilityScores,
} from '@/lib/dnd/helpers';
import type { WizardRace, WizardClass, WizardBackground } from '@/lib/dnd/catalog';
import styles from './CharacterCreate.module.css';

const STEP_META = [
  {
    t: 'Race',
    kicker: 'Step 1 of 5',
    heading: 'Who, broadly speaking, are you?',
    intro:
      'Race shapes the small things — how tall you are, what you can see in the dark, what languages you know without thinking. Pick one. You can come back.',
  },
  {
    t: 'Class',
    kicker: 'Step 2 of 5',
    heading: 'And what do you do when things go sideways?',
    intro: 'Class is the verb. Sneak, smite, study, summon, sing. Pick your verb.',
  },
  {
    t: 'Abilities',
    kicker: 'Step 3 of 5',
    heading: 'How are you wired?',
    intro:
      'Point-buy. 27 points. Every score starts at 8; raising it costs more the higher you go. Racial bonuses come after.',
  },
  {
    t: 'Background',
    kicker: 'Step 4 of 5',
    heading: 'Where did you come from?',
    intro:
      'Background gives Suzu something to needle you about for forty sessions. Pick one. Tell her your name.',
  },
  {
    t: 'Review',
    kicker: 'Step 5 of 5',
    heading: 'Sound about right?',
    intro: "A last look. Once you confirm, Suzu writes it down. (She doesn't forget.)",
  },
] as const;

const TOTAL_STEPS = STEP_META.length;

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
  const { user, loading, maybeAuthed } = useAuth();
  const router = useRouter();

  const catalog = useCatalog();

  const [step, setStep] = useState(0);
  const [race, setRace] = useState<string | null>(null);
  const [cls, setCls] = useState<string | null>(null);
  const [scores, setScores] = useState<AbilityScores>({ ...DEFAULT_SCORES });
  const [background, setBackground] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRetryRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);

  const username = user?.username ?? null;

  // Redirect out if genuinely logged out.
  useEffect(() => {
    if (!loading && !user && !maybeAuthed) router.replace('/login');
  }, [loading, user, maybeAuthed, router]);

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
  const remaining = pointsRemaining(scores);
  const finalScores = useMemo(
    () => applyRacialBonuses(scores, raceObj?.bonuses),
    [scores, raceObj],
  );
  const derived = useMemo(
    () => derivedStats(finalScores, clsObj, raceObj?.speed ?? 30),
    [finalScores, clsObj, raceObj],
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
    switch (step) {
      case 0:
        return !!race;
      case 1:
        return !!cls;
      case 2:
        return remaining >= 0;
      case 3:
        return !!background && name.trim().length > 0;
      default:
        return true;
    }
  }, [step, race, cls, remaining, background, name]);

  const canSubmit =
    !!username &&
    !!raceObj &&
    !!clsObj &&
    !!bgObj &&
    name.trim().length > 0 &&
    remaining >= 0 &&
    !submitting;

  const handleSubmit = useCallback(async () => {
    if (!username || !raceObj || !clsObj || !bgObj || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createCharacter({
        username,
        name: name.trim(),
        race: raceObj.name,
        char_class: clsObj.name,
        background: bgObj.name,
        ability_scores: scores,
      });
      if (!created.character_id) throw new Error('missing character_id');
      router.push(`/character/${encodeURIComponent(created.character_id)}`);
    } catch {
      setError(
        "Suzu couldn’t write that down. Check your choices and try again in a moment.",
      );
      setSubmitting(false);
    }
  }, [username, raceObj, clsObj, bgObj, name, scores, router]);

  // ── Suzu's line for the current step ──────────────────────────────────────────
  let suzuLine: string;
  if (step === 0) suzuLine = race ? (SUZU_LINES.race[race] ?? 'An unusual choice. Suzu is intrigued.') : 'Take your time. The tavern will keep.';
  else if (step === 1) suzuLine = cls ? (SUZU_LINES.class[cls] ?? 'An interesting calling.') : 'Pick a verb.';
  else if (step === 2) suzuLine = abilitiesComment(scores);
  else if (step === 3)
    suzuLine = name.trim()
      ? `${name.trim()}. Suzu likes the sound of it.`
      : 'Names matter. Even the ones you change later.';
  else
    suzuLine = name.trim()
      ? `${name.trim()}, I'll have a table ready by Tuesday. Bring a coat — the coast is colder than the brochure suggests.`
      : 'Welcome to the tavern. Mind the chimney.';

  const continueHint =
    step === 0
      ? 'Select a race to continue.'
      : step === 1
        ? 'Select a class to continue.'
        : step === 3
          ? 'Enter a name and choose a background to continue.'
          : '';

  const railSub = (i: number): string => {
    if (i === 0) return raceObj?.name ?? '—';
    if (i === 1) return clsObj?.name ?? '—';
    if (i === 2) return `${POINT_BUY_BUDGET - remaining} pts spent`;
    if (i === 3) return bgObj?.name ?? (name.trim() ? name.trim() : '—');
    return 'all done';
  };

  if (!user) {
    return (
      <main aria-busy="true" aria-label="Loading character creation" style={{ padding: '32px 28px' }}>
        <PageSkeleton variant="card" lines={4} />
      </main>
    );
  }

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

  const meta = STEP_META[step];

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
            {STEP_META.map((s, i) => {
              const state = i === step ? 'active' : i < step ? 'done' : 'todo';
              return (
                <li key={s.t}>
                  <button
                    type="button"
                    className={styles.railStep}
                    data-state={state}
                    aria-current={i === step ? 'step' : undefined}
                    disabled={i > step}
                    onClick={() => {
                      if (i <= step) setStep(i);
                    }}
                  >
                    <span className={styles.railDot} aria-hidden>
                      {state === 'done' ? <Icon name="Check" size={13} /> : i + 1}
                    </span>
                    <span className={styles.railText}>
                      <span className={styles.railTitle}>{s.t}</span>
                      <span className={styles.railSub}>{railSub(i)}</span>
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
            <p className="label">{meta.kicker}</p>
            <h2 ref={headingRef} tabIndex={-1} className={styles.stepHeading}>
              {meta.heading}
            </h2>
            <p className={styles.stepIntro}>{meta.intro}</p>
          </header>

          <div className={styles.stepBody}>
            {step === 0 && (
              <RaceStep
                races={catalog.data.races}
                value={race}
                onChange={setRace}
              />
            )}
            {step === 1 && (
              <ClassStep
                classes={catalog.data.classes}
                value={cls}
                onChange={setCls}
              />
            )}
            {step === 2 && (
              <AbilitiesStep scores={scores} remaining={remaining} onStep={setScore} />
            )}
            {step === 3 && (
              <BackgroundStep
                backgrounds={catalog.data.backgrounds}
                value={background}
                onChange={setBackground}
                name={name}
                onName={setName}
              />
            )}
            {step === 4 && (
              <ReviewStep
                name={name}
                onName={setName}
                raceObj={raceObj}
                clsObj={clsObj}
                bgObj={bgObj}
                finalScores={finalScores}
                derived={derived}
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
              disabled={step === 0}
              aria-label="Back"
            >
              ← Back
            </Button>
            <span className={`mono ${styles.navCount}`}>
              {step + 1} / {TOTAL_STEPS}
            </span>
            <span className={styles.navSpacer} />
            {!canContinue && continueHint && (
              <span id="continue-hint" className={styles.srOnly}>
                {continueHint}
              </span>
            )}
            {step < TOTAL_STEPS - 1 ? (
              <Button
                variant="primary"
                size="lg"
                onClick={() => setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1))}
                disabled={!canContinue}
                aria-describedby={!canContinue && continueHint ? 'continue-hint' : undefined}
              >
                Continue
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

        {/* Suzu commentary */}
        <Card pop as="aside" className={styles.suzu} aria-label="Suzu's commentary">
          <div className={styles.suzuMascot}>
            <SuzuDM size={112} talking aria-hidden />
          </div>
          <p className="label" style={{ fontSize: '0.7rem', marginBottom: 6 }}>
            Suzu
          </p>
          <p className={styles.suzuLine} aria-live="polite">
            &ldquo;{suzuLine}&rdquo;
          </p>
          <div className={styles.suzuWave}>
            <Waveform bars={26} height={20} active={false} />
          </div>
        </Card>
      </div>
    </TavernShell>
  );
}

// ── Step: Race ────────────────────────────────────────────────────────────────
function RaceStep({
  races,
  value,
  onChange,
}: {
  races: WizardRace[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
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
            <span className={styles.bgBlurb}>&ldquo;{b.blurb}&rdquo;</span>
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
  raceObj,
  clsObj,
  bgObj,
  finalScores,
  derived,
}: {
  name: string;
  onName: (v: string) => void;
  raceObj: WizardRace | undefined;
  clsObj: WizardClass | undefined;
  bgObj: WizardBackground | undefined;
  finalScores: AbilityScores;
  derived: ReturnType<typeof derivedStats>;
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
        />
      </Card>
    </div>
  );
}

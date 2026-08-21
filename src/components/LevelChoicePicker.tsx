'use client';
/**
 * LevelChoicePicker — T13 (DDX-14t/15t level-choice picker UI, character sheet).
 *
 * LevelUpButton (DDX-10) only bumps level/HP/hit dice/spell slots and lists
 * gained feature NAMES — its own header comment flags that neither subclass
 * selection nor Ability Score Improvement are actually pickable there. This
 * component is that seam's payoff: for every entry in `sheet.pending_choices`
 * (queued server-side by `_queue_level_choices`, NekoNova-DnDEngine
 * engine/commands/character_msm.py), it surfaces a picker and resolves it via
 * `POST /characters/{id}/level-choices/{choiceId}` (resolveLevelChoice,
 * dnd.ts), then refetches the sheet — same refetch-after-mutate contract as
 * every other mutating sheet component (LevelUpButton/InventoryPanel/
 * HpControl/SpellSlotsPanel): the engine owns every derived number
 * (subclass_features, ability_scores, hp, ac all recompute server-side), this
 * component only renders what the fresh sheet says happened.
 *
 * Rendering is owner-gated by the CALLER (mirrors LevelUpButton's isOwner
 * gate at character/[id]/page.tsx — a non-owner has no reason to resolve
 * someone else's build decisions, and the engine route is OWNER-authed
 * regardless). This component itself only checks `pending_choices` is
 * non-empty; it renders nothing otherwise.
 *
 * Three choice `type`s exist today (engine's `_queue_level_choices`):
 *   - `subclass` — pick an archetype. No `options` array ships on the
 *     pending-choice record itself (just {id,type,level,class,label}), so
 *     the options come from GET /api/dnd/catalog?type=subclass, filtered
 *     client-side to `data.class` matching the choice's class — the SAME
 *     filter `_resolve_subclass_choice` applies server-side, so an
 *     ineligible choice can never even be offered here.
 *   - `asi` — either a real Ability Score Improvement (+2 to one ability, or
 *     +1 to two; 20 cap) or a feat instead. Modeled as a per-ability +/-
 *     stepper with a 2-point budget: clicking "+" on one ability twice (then
 *     confirming) is the +2-to-one shape; clicking "+" once on two
 *     different abilities is the +1/+1 shape — the SAME two legal 5e shapes
 *     `_resolve_asi_increase` validates server-side, so an illegal spread
 *     can never be assembled in the UI to begin with. Each ability's "+" is
 *     ALSO individually disabled the moment one more point would push that
 *     ability's score past 20 (mirrors `_resolve_asi_increase`'s
 *     `ability_cap_exceeded` guard, enforced here too so the disabled state
 *     is visible before the click, not just refused after).
 *   - `spell` (TAV-1.0-SLICE-B-FIX-4) — a caster's level-up spell GAIN: up to
 *     `choice.cantrips` new cantrips and `choice.spells` new leveled spells,
 *     multi-select from `getAvailableSpells`'s pool (filtered to
 *     `!in_repertoire`), each bucket capped at its own allotment. This
 *     resolver is finalize-only server-side — the actual learning happens
 *     client-side via `learnSpell` (the SAME budget-enforced call the sheet's
 *     Spells tab and the creation picker use) BEFORE `resolveLevelChoice` is
 *     called, batched with `Promise.allSettled` so one failed pick never
 *     blocks the rest or the finalize. A wizard's (`caster_kind ===
 *     'spellbook'`) picked LEVELED spells are learned with `prepared: true`
 *     (Slice B Fix 3's contract — an un-prepared spellbook entry is
 *     uncastable under `DND_ENFORCE_SPELL_KNOWN`); every other caster_kind
 *     omits `prepared` (known casters always cast known spells; a
 *     'prepared'-kind caster only ever gets cantrips here, auto-prepared
 *     engine-side). Confirm is allowed even with a partial or empty
 *     selection — a player may forgo a pick, and the resolver clears the
 *     prompt regardless of what (if anything) was learned.
 *
 * T13 FIX PASS (Miko-QA defects + Kage-CR abort guard + Iro-A11y
 * CHANGES-REQUIRED, folded in before first commit): mode-toggle now resets
 * stale ASI state (DEFECT-1); all 3 radiogroups get arrow-key nav + roving
 * tabIndex (CRITICAL-1, mirrors SpellbookPanel.tsx's tablist onKeyDown);
 * the ability-stepper budget hint uses --ink-2 (CRITICAL-2); the stepper has
 * an sr-only aria-live status region (CRITICAL-3); a successful resolve
 * moves focus to the "Pending choices" heading when siblings remain
 * (CRITICAL-4a — see character/[id]/page.tsx for the last-choice case);
 * SubclassChoiceCard's Confirm button now passes Label-in-Name (SERIOUS-1);
 * catalog/feat fetch states are aria-live (SERIOUS-2/3); the subclass
 * catalog error now offers a Retry (SERIOUS-4/DEFECT-2); card titles are
 * real headings, scoped per-choice so two pending ASI cards don't collide
 * (MINOR-1/2, DEFECT-3); and the catalog/feat fetch `.catch`s no-op on an
 * aborted controller instead of surfacing a stale error (Kage abort guard).
 *
 * DDX-SUBCLASS-OPTION-FILTER (P3, known caveat — NOT built here, per the
 * story's explicit instruction): the SRD models a subclass's own
 * "choose one of several" sub-features (e.g. a Fighting Style) as separate
 * class_features records, not a nested choice on the subclass pending-choice
 * itself. This picker resolves the SUBCLASS pick only (e.g. Champion vs
 * Battle Master vs Eldritch Knight) — intra-subclass option filtering is a
 * documented follow-up, same treatment as DDX-16's warlock-invocations
 * "eligible menu, not yet chosen" placeholder.
 */
import { useEffect, useId, useRef, useState } from 'react';
import Button from '@/components/Button';
import SpellInfoPopover from '@/components/SpellInfoPopover';
import { useToast } from '@/components/Toast';
import {
  getAvailableSpells,
  getCatalog,
  getCharacterSheet,
  learnSpell,
  resolveLevelChoice,
} from '@/lib/api/dnd';
import { ABILITIES, slugifyName, type AbilityKey } from '@/lib/dnd/helpers';
import type {
  ApiError,
  AvailableSpellEntry,
  AvailableSpellsResult,
  CatalogItem,
  CharacterSheet,
  FeatureChoiceOption,
  PendingLevelChoice,
} from '@/lib/api/types';
import styles from './LevelChoicePicker.module.css';

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

/** Same body-shape probe as SpellbookPanel/CastSpellPanel's refusalReason. */
function refusalReason(e: ApiError): string | undefined {
  const body = e.body as { data?: { reason?: string }; reason?: string } | null | undefined;
  return body?.data?.reason ?? body?.reason ?? e.code;
}

// Deterministic resolve_level_choice refusals (engine owns every rule — see
// routes/characters.py::resolve_level_choice_route's docstring for the full
// reason list). A reason NOT in this map, or a non-ApiError (network/
// unknown), falls back to the generic transient message.
const RESOLVE_REFUSAL_COPY: Record<string, string> = {
  choice_not_found: 'That choice is no longer pending — reload to see the current state.',
  invalid_subclass: "That archetype isn't available for this class.",
  already_chosen: 'A subclass has already been chosen.',
  not_owner: "That's not your character.",
  unsupported_choice_type: "Suzu doesn't have a picker for that choice type yet.",
  invalid_asi: "That selection doesn't match the expected shape.",
  ability_cap_exceeded: 'That would push an ability above the maximum score of 20.',
  unknown_feat: "That feat isn't available right now.",
  feat_prereq_unmet: "This character doesn't meet that feat's prerequisites.",
  feat_already_taken: 'That feat has already been taken.',
  // INVOC — the feature_choice resolver's refusals (engine:
  // _resolve_feature_choice).
  invalid_feature_choice: "That selection doesn't match the expected shape.",
  unknown_option: "That option isn't on this class's menu.",
  option_level_unmet: 'One of those picks needs a higher character level.',
  duplicate_option: 'One of those picks is already known.',
  invalid_swap: "That swap isn't valid — drop something known, add something new.",
  over_menu_cap: 'That would exceed the number of picks this class can know.',
  // ENGINE-SUBCLASS-SCOPED-MENUS. Paired with the engine in the SAME change on
  // purpose: an unmapped reason falls back to "try again in a moment", which
  // is not just unhelpful but actively wrong here — retrying never works. This
  // repo has already shipped that exact drift once (the WF-I DM-override
  // refusal moved to a new reason and the modal kept branching on the retired
  // one, live-broken from prod night until it was caught days later).
  subclass_required: 'Choose your archetype first — this menu depends on it.',
  wrong_subclass: 'That option belongs to a different archetype.',
};

function resolveErrorMessage(err: unknown): string {
  const fallback = 'Could not save that choice. Try again in a moment.';
  if (!isApiError(err)) return fallback;
  const reason = refusalReason(err);
  return RESOLVE_REFUSAL_COPY[reason ?? ''] ?? fallback;
}

// SRD ASI feat slugs the engine will actually grant through this mechanic
// today (NekoNova-DnDEngine engine/commands/character_msm.py::
// _ASI_ELIGIBLE_FEATS). Manually mirrored here — there is no eligibility flag
// on the catalog wire (same "no catalog endpoint exposes the real rule" gap
// as conditions.ts's DND_CONDITIONS mirror of engine/rules.py::CONDITIONS).
// A catalog `feat` row outside this set (e.g. the PF2e-shaped `power-attack`
// row the engine's own docstring calls out) always refuses with
// `unknown_feat` server-side even if offered here, so it's filtered out
// rather than offered as a guaranteed dead end. Extend only when the
// engine's own allowlist grows.
const ASI_ELIGIBLE_FEAT_SLUGS = new Set<string>(['grappler']);

// FEAT-PREREQ-UX: client mirror of the engine's best-effort feat-prereq
// check (_resolve_asi_feat): a `prerequisites` entry naming an ability (the
// wire carries 5e-bits' abbreviated names, e.g. "STR" for Grappler) requires
// a score of 13+ in that ability. Only ability minimums are understood, and
// the threshold is the same hardcoded 13 — deliberately, so the disabled
// state here always agrees with the `feat_prereq_unmet` refusal the engine
// would return for the same pick. Returns the unmet requirements as display
// strings ("STR 13"), empty when the character qualifies.
function unmetFeatPrereqs(item: CatalogItem, sheet: CharacterSheet): string[] {
  const raw = (item.data as { prerequisites?: unknown }).prerequisites;
  const prereqs = Array.isArray(raw) ? raw : [];
  const unmet: string[] = [];
  for (const entry of prereqs) {
    const text = String(entry ?? '')
      .trim()
      .toLowerCase();
    // Kage I4 (INVOC r1): EXACT match only — the engine normalizes the
    // whole string and requires exact membership in ABILITIES, so a
    // full-sentence prereq ("Strength 13 or higher") is NOT enforced
    // server-side. A substring match here would block a feat the engine
    // allows, with a threshold this client invented. Mirror = exact.
    const ability = ABILITIES.find(
      (a) => text === a.abbr.toLowerCase() || text === a.key,
    );
    if (ability && (sheet.ability_scores[ability.key]?.score ?? 10) < 13) {
      unmet.push(`${ability.abbr} 13`);
    }
  }
  return unmet;
}

const SYSTEM = 'dnd5e';

/** A11Y (Iro CRITICAL-1): roving-tabindex radiogroup arrow-key nav, mirrors
 *  SpellbookPanel.tsx's tablist onKeyDown (:362-388) — Up/Left move to the
 *  previous option, Down/Right to the next (both wrap), Home/End jump to the
 *  ends. Arrow-key movement ALSO selects (native radio-group semantics), so
 *  callers select + refocus together. Returns null for any other key so the
 *  caller can no-op without calling preventDefault. */
function radioStepIndex(key: string, idx: number, length: number): number | null {
  if (length === 0) return null;
  const from = idx < 0 ? 0 : idx;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (from + 1) % length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (from - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}

export interface LevelChoicePickerProps {
  characterId: string;
  username: string;
  sheet: CharacterSheet;
  /** Fired with the freshly-refetched sheet after a successful resolve — the
   *  parent page re-renders every panel (subclass/class_features/ability
   *  scores/ac/hp/feats) off the new state. Same onChanged/onLeveledUp
   *  contract every other mutating sheet component already uses. */
  onResolved: (updated: CharacterSheet) => void;
}

export default function LevelChoicePicker({
  characterId,
  username,
  sheet,
  onResolved,
}: LevelChoicePickerProps) {
  // LVL (Aoi gap A, defensive): sort ascending by level so a stacked
  // floor-walk queue (subclass:3, asi:4, spell:5, …) always renders in the
  // order the levels were earned — the engine appends in walk order today,
  // but the "in the order they were earned" framing upstream must not
  // depend on an ordering guarantee the wire contract never made.
  const pending = [...(sheet.pending_choices ?? [])].sort(
    (a, b) => (a.level ?? 0) - (b.level ?? 0),
  );
  // A11Y (Iro CRITICAL-4a): focus-restore target after a card resolves. Only
  // relevant when THIS component stays mounted (other choices still
  // pending) — the just-resolved card unmounts out from under its own
  // focused Confirm button, stranding focus at <body> otherwise. The
  // last-choice case (pending_choices empties entirely) unmounts this whole
  // component too, so that focus-restore lives one level up, in
  // character/[id]/page.tsx.
  const pendingHeadingRef = useRef<HTMLHeadingElement>(null);

  function handleChildResolved(updated: CharacterSheet) {
    onResolved(updated);
    if ((updated.pending_choices?.length ?? 0) > 0) {
      pendingHeadingRef.current?.focus();
    }
  }

  if (pending.length === 0) return null;

  return (
    <div className={styles.wrap}>
      {/* TAV-SHEET-HEADING-ORDER: h2 — this component's own Card is a
          top-level sibling section on the character sheet, same as
          Inventory/Spells/Features (all h2). Its own per-choice cards below
          are h3, one level in. */}
      <h2 ref={pendingHeadingRef} tabIndex={-1} className="label" style={{ margin: '0 0 4px' }}>
        Pending choices
      </h2>
      {pending.map((choice) => {
        if (choice.type === 'subclass') {
          return (
            <SubclassChoiceCard
              key={choice.id}
              characterId={characterId}
              username={username}
              sheet={sheet}
              choice={choice}
              onResolved={handleChildResolved}
            />
          );
        }
        if (choice.type === 'asi') {
          return (
            <AsiChoiceCard
              key={choice.id}
              characterId={characterId}
              username={username}
              sheet={sheet}
              choice={choice}
              onResolved={handleChildResolved}
            />
          );
        }
        if (choice.type === 'spell') {
          return (
            <SpellChoiceCard
              key={choice.id}
              characterId={characterId}
              username={username}
              sheet={sheet}
              choice={choice}
              onResolved={handleChildResolved}
            />
          );
        }
        if (choice.type === 'feature_choice') {
          return (
            <FeatureChoiceCard
              key={choice.id}
              characterId={characterId}
              username={username}
              sheet={sheet}
              choice={choice}
              onResolved={handleChildResolved}
            />
          );
        }
        // unsupported_choice_type — the engine queues only subclass/asi/
        // spell/feature_choice today; this is forward-compat scaffolding,
        // not a live path.
        return (
          <div key={choice.id} className={styles.card}>
            {/* TAV-SHEET-HEADING-ORDER: h3 — nested under "Pending choices"
                (h2) above. */}
            <h3 className={styles.cardLabel}>{choice.label}</h3>
            <p className={styles.emptyRow}>
              Suzu doesn&rsquo;t have a picker for this choice type yet.
            </p>
          </div>
        );
      })}
    </div>
  );
}

interface ChoiceCardProps {
  characterId: string;
  username: string;
  sheet: CharacterSheet;
  choice: PendingLevelChoice;
  onResolved: (updated: CharacterSheet) => void;
}

function SubclassChoiceCard({
  characterId,
  username,
  sheet,
  choice,
  onResolved,
}: ChoiceCardProps) {
  const { toast } = useToast();
  const headingId = useId();
  const charClass = choice.class || sheet.char_class;
  const [options, setOptions] = useState<CatalogItem[] | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading');
  // A11Y/QA (SERIOUS-4, DEFECT-2): bump to retry a failed catalog fetch via
  // an effect-dep counter. This is THE canonical retry shape for every fetch
  // card in this file — the feat card originally retried by resetting its
  // load state to 'idle' with that state in the effect deps, which made the
  // idle→loading transition abort its own fetch (LVL-FEAT-SELF-ABORT); it
  // now mirrors THIS counter pattern.
  const [loadKey, setLoadKey] = useState(0);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [busy, setBusy] = useState(false);
  /** Synchronous double-submit latch — same useRef pattern as LevelUpButton's
   *  levelUpBusyRef / InventoryPanel's mutationBusyRef (React state can't
   *  close the same-tick double-click window). */
  const busyRef = useRef(false);
  // A11Y (Iro CRITICAL-1): option refs for arrow-key roving-tabindex focus.
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    // Canonical fetch-on-mount pattern (React docs "Fetching data" example).
    // There's no external store to subscribe to here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadState('loading');
    getCatalog(SYSTEM, { type: 'subclass' }, ac.signal)
      .then((res) => {
        // TAV-SUBCLASS-CLASSKEY-MISMATCH: `charClass` is a DISPLAY name
        // ("Ki Warrior") while a subclass row's `data.class` is a SLUG
        // ("ki-warrior"), so a bare lowercase compare matched nothing and the
        // card claimed "No archetypes are seeded" for a class with six. Every
        // SRD class is one word, which is the only reason this held until the
        // first multi-word class arrived. Slugify BOTH sides — see
        // `slugifyName`'s note; it mirrors the engine's `_slugify` exactly.
        const wanted = slugifyName(charClass);
        const filtered = res.items.filter(
          (item) => slugifyName(String((item.data as { class?: string }).class ?? '')) === wanted,
        );
        setOptions(filtered);
        setSelectedSlug((prev) => prev || filtered[0]?.slug || '');
        setLoadState('ok');
      })
      .catch(() => {
        // Kage abort guard: an aborted fetch (unmount / charClass change) is
        // not a real failure — don't clobber loadState with a stale error.
        if (ac.signal.aborted) return;
        setLoadState('error');
      });
    return () => ac.abort();
  }, [charClass, loadKey]);

  async function handleResolve() {
    if (busyRef.current || !selectedSlug) return;
    busyRef.current = true;
    setBusy(true);
    try {
      try {
        await resolveLevelChoice(characterId, username, choice.id, { subclass: selectedSlug });
      } catch (err) {
        toast({ message: resolveErrorMessage(err), tone: 'error' });
        return;
      }
      try {
        const after = await getCharacterSheet(characterId, username);
        onResolved(after);
        const chosenName = options?.find((o) => o.slug === selectedSlug)?.name ?? 'Archetype';
        // Announce success programmatically (a11y): the class_features/
        // subclass re-render is visual-only, mirrors LevelUpButton's toast.
        toast({ message: `${chosenName} chosen as ${sheet.name}'s archetype!`, tone: 'success' });
      } catch {
        toast({
          message: "Couldn't refresh your sheet — reload to see the result.",
          tone: 'warn',
        });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const chosenName = options?.find((o) => o.slug === selectedSlug)?.name ?? 'archetype';

  return (
    <div className={styles.card} aria-busy={busy}>
      {/* TAV-SHEET-HEADING-ORDER: h3 — nested under "Pending choices" (h2). */}
      <h3 id={headingId} className={styles.cardLabel}>
        {choice.label}
      </h3>
      {loadState === 'loading' && (
        <p className={styles.emptyRow} aria-busy="true" aria-live="polite" aria-atomic="true">
          Loading options…
        </p>
      )}
      {loadState === 'error' && (
        <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
          Couldn&rsquo;t load archetype options.{' '}
          <Button variant="ghost" size="default" onClick={() => setLoadKey((k) => k + 1)}>
            Retry
          </Button>
        </p>
      )}
      {loadState === 'ok' && options && options.length === 0 && (
        <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
          No archetypes are seeded for {charClass} yet.
        </p>
      )}
      {loadState === 'ok' && options && options.length > 0 && (
        <>
          <div
            className={styles.optionRow}
            role="radiogroup"
            aria-labelledby={headingId}
            onKeyDown={(e) => {
              const idx = options.findIndex((o) => o.slug === selectedSlug);
              const next = radioStepIndex(e.key, idx, options.length);
              if (next === null) return;
              e.preventDefault();
              setSelectedSlug(options[next].slug);
              optionRefs.current[next]?.focus();
            }}
          >
            {options.map((o, i) => (
              <button
                key={o.slug}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={selectedSlug === o.slug}
                tabIndex={selectedSlug === o.slug ? 0 : -1}
                className={
                  selectedSlug === o.slug ? `${styles.option} ${styles.optionOn}` : styles.option
                }
                disabled={busy}
                onClick={() => setSelectedSlug(o.slug)}
              >
                {o.name}
              </button>
            ))}
          </div>
          <Button
            variant="primary"
            size="default"
            aria-label={`Confirm archetype: ${chosenName}`}
            aria-busy={busy}
            disabled={busy || !selectedSlug}
            onClick={() => void handleResolve()}
          >
            {busy ? '…' : 'Confirm archetype'}
          </Button>
        </>
      )}
    </div>
  );
}

const ASI_MODE_ORDER: Array<'increase' | 'feat'> = ['increase', 'feat'];

function AsiChoiceCard({ characterId, username, sheet, choice, onResolved }: ChoiceCardProps) {
  const { toast } = useToast();
  const headingId = useId();
  const [mode, setMode] = useState<'increase' | 'feat'>('increase');
  const [allocations, setAllocations] = useState<Partial<Record<AbilityKey, number>>>({});
  const [feats, setFeats] = useState<CatalogItem[] | null>(null);
  const [featLoadState, setFeatLoadState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  // LVL-FEAT-SELF-ABORT fix: retry via an effect-dep counter (the
  // SubclassChoiceCard/SpellChoiceCard convention), NOT by resetting
  // featLoadState to 'idle' — see the effect's comment below.
  const [featLoadKey, setFeatLoadKey] = useState(0);
  const [selectedFeat, setSelectedFeat] = useState('');
  const [busy, setBusy] = useState(false);
  /** Synchronous double-submit latch — see SubclassChoiceCard's comment. */
  const busyRef = useRef(false);
  // A11Y (Iro CRITICAL-1): option refs for the mode-toggle + feat radiogroups.
  const modeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const featRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // A11Y (Iro CRITICAL-3/MODERATE-2): sr-only live status for the ability
  // steppers — the score/budget change is otherwise visual-only.
  const [srMessage, setSrMessage] = useState('');

  const totalAllocated = ABILITIES.reduce((sum, a) => sum + (allocations[a.key] ?? 0), 0);

  useEffect(() => {
    // LVL-FEAT-SELF-ABORT fix (found live by Leon: "Loading feats…" stuck
    // forever). The old effect kept `featLoadState` in its dep array AND
    // set it to 'loading' inside — so starting the fetch re-fired the
    // effect, whose cleanup ac.abort()'d the request it had just started,
    // and the abort guard in .catch swallowed the rejection: state stuck on
    // 'loading' with zero surviving requests (both showed net::ERR_ABORTED
    // in the browser; jest never caught it because the mock settled on the
    // next microtask, winning the race the real network always loses).
    // Now the state machine is NOT a dependency: the fetch runs on feat-mode
    // entry / retry-key bump / taken-feats change, exactly the counter
    // pattern the sibling cards use.
    if (mode !== 'feat') return;
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFeatLoadState('loading');
    getCatalog(SYSTEM, { type: 'feat' }, ac.signal)
      .then((res) => {
        const alreadyTaken = new Set((sheet.feats ?? []).map((f) => f.slug));
        const eligible = res.items.filter(
          (item) => ASI_ELIGIBLE_FEAT_SLUGS.has(item.slug) && !alreadyTaken.has(item.slug),
        );
        setFeats(eligible);
        // FEAT-PREREQ-UX: auto-select the first feat the character actually
        // QUALIFIES for — never a prereq-unmet one (those render disabled,
        // and pre-selecting one would arm a Confirm that can only refuse).
        setSelectedFeat(
          (prev) =>
            prev ||
            eligible.find((f) => unmetFeatPrereqs(f, sheet).length === 0)?.slug ||
            '',
        );
        setFeatLoadState('ok');
      })
      .catch(() => {
        // Kage abort guard — see SubclassChoiceCard's matching comment.
        if (ac.signal.aborted) return;
        setFeatLoadState('error');
      });
    return () => ac.abort();
  }, [mode, featLoadKey, sheet.feats]);

  // QA (Miko DEFECT-1): switching ASI mode must not leave a stale allocation
  // (or a stale feat pick) silently submittable from the OTHER mode — reset
  // both, plus the stepper's own live announcement, on every toggle.
  function handleModeChange(next: 'increase' | 'feat') {
    if (busy || next === mode) return;
    setMode(next);
    setAllocations({});
    setSelectedFeat('');
    setSrMessage('');
  }

  function incAbility(key: AbilityKey) {
    if (busy || totalAllocated >= 2) return;
    const current = allocations[key] ?? 0;
    if (current >= 2) return;
    const score = sheet.ability_scores[key]?.score ?? 10;
    // Mirrors _resolve_asi_increase's ability_cap_exceeded guard: disable the
    // increment the moment the NEXT point would push this ability past 20 —
    // a score of exactly 20 is legal, 21 never is.
    if (score + current + 1 > 20) return;
    const nextCurrent = current + 1;
    const nextTotal = totalAllocated + 1;
    setAllocations((prev) => ({ ...prev, [key]: nextCurrent }));
    const name = ABILITIES.find((a) => a.key === key)?.name ?? key;
    let msg = `${name} ${score + nextCurrent}, ${nextTotal} of 2 points spent.`;
    if (nextTotal >= 2) {
      msg += ' Budget spent — increase disabled.';
    } else if (score + nextCurrent + 1 > 20) {
      msg += ` ${name} at maximum.`;
    }
    setSrMessage(msg);
  }

  function decAbility(key: AbilityKey) {
    if (busy) return;
    const current = allocations[key] ?? 0;
    if (current <= 0) return;
    const nextCurrent = current - 1;
    const nextTotal = totalAllocated - 1;
    setAllocations((prev) => ({ ...prev, [key]: nextCurrent }));
    const name = ABILITIES.find((a) => a.key === key)?.name ?? key;
    const score = sheet.ability_scores[key]?.score ?? 10;
    setSrMessage(`${name} ${score + nextCurrent}, ${nextTotal} of 2 points spent.`);
  }

  async function handleResolve() {
    if (busyRef.current) return;
    let selection: Record<string, unknown>;
    let successMessage: string;
    if (mode === 'increase') {
      if (totalAllocated !== 2) return;
      const nonZero: Record<string, number> = {};
      for (const a of ABILITIES) {
        const v = allocations[a.key] ?? 0;
        if (v > 0) nonZero[a.key] = v;
      }
      selection = { mode: 'increase', allocations: nonZero };
      const allocationNames = Object.entries(nonZero)
        .map(([k, v]) => `${k.charAt(0).toUpperCase()}${k.slice(1)} +${v}`)
        .join(', ');
      successMessage = `${sheet.name}'s Ability Score Improvement: ${allocationNames}.`;
    } else {
      if (!selectedFeat) return;
      // FEAT-PREREQ-UX backstop: the unmet options are disabled and skipped
      // by arrow-nav, so this should be unreachable — but a stale selection
      // (e.g. scores changed under us via a sibling ASI card) must never
      // submit a pick the engine will refuse.
      const chosen = feats?.find((f) => f.slug === selectedFeat);
      if (!chosen || unmetFeatPrereqs(chosen, sheet).length > 0) return;
      selection = { mode: 'feat', feat: selectedFeat };
      successMessage = `${sheet.name} takes the ${chosen.name} feat!`;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      try {
        await resolveLevelChoice(characterId, username, choice.id, selection);
      } catch (err) {
        toast({ message: resolveErrorMessage(err), tone: 'error' });
        return;
      }
      try {
        const after = await getCharacterSheet(characterId, username);
        onResolved(after);
        // Announce success programmatically (a11y): the ability_scores/hp/ac
        // or feats re-render is visual-only, mirrors every other panel here.
        toast({ message: successMessage, tone: 'success' });
      } catch {
        toast({
          message: "Couldn't refresh your sheet — reload to see the result.",
          tone: 'warn',
        });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const canConfirm =
    mode === 'increase' ? totalAllocated === 2 : !!selectedFeat && featLoadState === 'ok';

  return (
    <div className={styles.card} aria-busy={busy}>
      {/* TAV-SHEET-HEADING-ORDER: h3 — nested under "Pending choices" (h2). */}
      <h3 id={headingId} className={styles.cardLabel}>
        {choice.label}
      </h3>
      {/* A11Y (Iro CRITICAL-3/MODERATE-2): kept mounted across mode switches
          (not conditional on `mode`) so the live region itself never
          remounts — only its text content changes, the standard aria-live
          pattern. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {srMessage}
      </div>

      <div
        className={styles.modeRow}
        role="radiogroup"
        aria-label={`Choice type (level ${choice.level})`}
        onKeyDown={(e) => {
          const idx = ASI_MODE_ORDER.indexOf(mode);
          const next = radioStepIndex(e.key, idx, ASI_MODE_ORDER.length);
          if (next === null) return;
          e.preventDefault();
          handleModeChange(ASI_MODE_ORDER[next]);
          modeRefs.current[next]?.focus();
        }}
      >
        <button
          ref={(el) => {
            modeRefs.current[0] = el;
          }}
          type="button"
          role="radio"
          aria-checked={mode === 'increase'}
          tabIndex={mode === 'increase' ? 0 : -1}
          className={mode === 'increase' ? `${styles.option} ${styles.optionOn}` : styles.option}
          disabled={busy}
          onClick={() => handleModeChange('increase')}
        >
          Increase abilities
        </button>
        <button
          ref={(el) => {
            modeRefs.current[1] = el;
          }}
          type="button"
          role="radio"
          aria-checked={mode === 'feat'}
          tabIndex={mode === 'feat' ? 0 : -1}
          className={mode === 'feat' ? `${styles.option} ${styles.optionOn}` : styles.option}
          disabled={busy}
          onClick={() => handleModeChange('feat')}
        >
          Take a feat
        </button>
      </div>

      {mode === 'increase' && (
        <>
          <p className={styles.hint}>
            Allocate 2 points — +2 to one ability, or +1 to two ({totalAllocated}/2 spent).
          </p>
          <div className={styles.abilityGrid}>
            {ABILITIES.map((a) => {
              const current = allocations[a.key] ?? 0;
              const score = sheet.ability_scores[a.key]?.score ?? 10;
              const nextWouldExceedCap = score + current + 1 > 20;
              const budgetSpent = totalAllocated >= 2;
              return (
                <div key={a.key} className={styles.abilityStepper}>
                  <span className={styles.abilityAbbr}>{a.abbr}</span>
                  <span className={`mono ${styles.abilityScore}`}>
                    {score}
                    {current > 0 && <span className={styles.abilityDelta}> +{current}</span>}
                  </span>
                  <div className={styles.stepperBtns}>
                    <button
                      type="button"
                      className={styles.stepBtn}
                      aria-label={`Decrease ${a.name} allocation`}
                      disabled={busy || current <= 0}
                      onClick={() => decAbility(a.key)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className={styles.stepBtn}
                      aria-label={`Increase ${a.name} allocation`}
                      disabled={busy || budgetSpent || current >= 2 || nextWouldExceedCap}
                      onClick={() => incAbility(a.key)}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {mode === 'feat' && (
        <>
          {featLoadState === 'loading' && (
            <p className={styles.emptyRow} aria-busy="true" aria-live="polite" aria-atomic="true">
              Loading feats…
            </p>
          )}
          {featLoadState === 'error' && (
            <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
              Couldn&rsquo;t load feats.{' '}
              <Button variant="ghost" size="default" onClick={() => setFeatLoadKey((k) => k + 1)}>
                Retry
              </Button>
            </p>
          )}
          {featLoadState === 'ok' && feats && feats.length === 0 && (
            <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
              No feats are available right now.
            </p>
          )}
          {featLoadState === 'ok' && feats && feats.length > 0 && (
            <>
              <div
                className={styles.optionRow}
                role="radiogroup"
                aria-label={`Feat (level ${choice.level})`}
                onKeyDown={(e) => {
                  // FEAT-PREREQ-UX: arrow-nav must skip prereq-unmet feats —
                  // they're disabled below, and arrow movement SELECTS in a
                  // radio group, so stepping onto one would arm a pick the
                  // engine can only refuse. Walk until an enabled option is
                  // found (bounded by the list length).
                  let idx = feats.findIndex((f) => f.slug === selectedFeat);
                  for (let step = 0; step < feats.length; step += 1) {
                    const next = radioStepIndex(e.key, idx, feats.length);
                    if (next === null) return;
                    if (unmetFeatPrereqs(feats[next], sheet).length === 0) {
                      e.preventDefault();
                      setSelectedFeat(feats[next].slug);
                      featRefs.current[next]?.focus();
                      return;
                    }
                    idx = next;
                  }
                  e.preventDefault(); // every option unmet — nothing to move to
                }}
              >
                {feats.map((f, i) => {
                  // FEAT-PREREQ-UX: a feat the character can't take renders
                  // disabled with the requirement inline — the old behavior
                  // offered it as the ONLY option and let the (correct)
                  // refusal toast be the first hint.
                  const unmet = unmetFeatPrereqs(f, sheet);
                  return (
                    <button
                      key={f.slug}
                      ref={(el) => {
                        featRefs.current[i] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={selectedFeat === f.slug}
                      tabIndex={selectedFeat === f.slug ? 0 : -1}
                      className={
                        selectedFeat === f.slug
                          ? `${styles.option} ${styles.optionOn}`
                          : styles.option
                      }
                      disabled={busy || unmet.length > 0}
                      onClick={() => setSelectedFeat(f.slug)}
                    >
                      {f.name}
                      {unmet.length > 0 && (
                        <span className={styles.prereqNote}> — requires {unmet.join(', ')}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {feats.every((f) => unmetFeatPrereqs(f, sheet).length > 0) && (
                <p className={styles.hint} aria-live="polite" aria-atomic="true">
                  {sheet.name} doesn&rsquo;t meet any offered feat&rsquo;s prerequisites —
                  choose an ability increase instead.
                </p>
              )}
            </>
          )}
        </>
      )}

      <Button
        variant="primary"
        size="default"
        aria-label={
          mode === 'increase'
            ? `Confirm Ability Score Improvement (level ${choice.level})`
            : `Confirm feat (level ${choice.level})`
        }
        aria-busy={busy}
        disabled={busy || !canConfirm}
        onClick={() => void handleResolve()}
      >
        {busy ? '…' : 'Confirm'}
      </Button>
    </div>
  );
}

/**
 * TAV-1.0-SLICE-B-FIX-4: `spell` choice — level-up spell GAIN. Fetch-on-mount
 * mirrors SubclassChoiceCard's own pattern (AbortController + Kage abort
 * guard, loadState machine, a retry affordance on fetch failure). Unlike the
 * other two cards, the mutation itself happens BEFORE resolveLevelChoice —
 * each pick is its own budget-enforced `learnSpell` call (mirrors the
 * creation picker's batch-apply, character/new/page.tsx:409-452), and the
 * resolver call at the end is finalize-only (clears the prompt; the engine
 * never re-validates the picks, per _resolve_spell_choice's own docstring).
 */
function SpellChoiceCard({ characterId, username, sheet, choice, onResolved }: ChoiceCardProps) {
  const { toast } = useToast();
  const headingId = useId();
  const cantripCap = choice.cantrips ?? 0;
  const leveledCap = choice.spells ?? 0;
  const cantripHintId = `${headingId}-cantrips`;
  const leveledHintId = `${headingId}-leveled`;

  const [available, setAvailable] = useState<AvailableSpellsResult | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading');
  // A11Y/QA (mirrors SubclassChoiceCard's SERIOUS-4/DEFECT-2 Retry): bump to
  // retry a failed fetch.
  const [loadKey, setLoadKey] = useState(0);
  const [selectedCantrips, setSelectedCantrips] = useState<Set<string>>(new Set());
  const [selectedLeveled, setSelectedLeveled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  /** Synchronous double-submit latch — same useRef pattern as the sibling cards. */
  const busyRef = useRef(false);

  useEffect(() => {
    const ac = new AbortController();
    // Canonical fetch-on-mount pattern (React docs "Fetching data" example).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadState('loading');
    getAvailableSpells(characterId, username, ac.signal)
      .then((data) => {
        setAvailable(data);
        setLoadState('ok');
      })
      .catch(() => {
        // Kage abort guard — see SubclassChoiceCard's matching comment.
        if (ac.signal.aborted) return;
        setLoadState('error');
      });
    return () => ac.abort();
  }, [characterId, username, loadKey]);

  function toggle(picked: Set<string>, setPicked: (next: Set<string>) => void, slug: string, cap: number) {
    if (busy) return;
    const next = new Set(picked);
    if (next.has(slug)) {
      next.delete(slug);
    } else if (next.size < cap) {
      next.add(slug);
    }
    setPicked(next);
  }

  async function handleResolve() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      // Slice B Fix 3 contract: a wizard's (spellbook caster's) picked
      // LEVELED spells must land prepared=true or they're uncastable under
      // enforcement. Cantrips are unaffected (already unconditionally
      // prepared=true engine-side); known/prepared caster_kinds are
      // unaffected (already correct without an override).
      const leveledPrepared = choice.caster_kind === 'spellbook' ? true : undefined;
      const picks: Promise<unknown>[] = [
        ...Array.from(selectedCantrips, (slug) => learnSpell(characterId, username, slug)),
        ...Array.from(selectedLeveled, (slug) =>
          learnSpell(characterId, username, slug, undefined, undefined, leveledPrepared),
        ),
      ];
      if (picks.length > 0) {
        const results = await Promise.allSettled(picks);
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          toast({
            message: `${failed} spell pick${failed > 1 ? 's' : ''} couldn’t be learned. You can add ${failed > 1 ? 'them' : 'it'} from the sheet.`,
            tone: 'warn',
          });
        }
      }
      // Finalize-only: clears the prompt regardless of what (if anything)
      // was learned above — see _resolve_spell_choice's own docstring.
      try {
        await resolveLevelChoice(characterId, username, choice.id, {});
      } catch (err) {
        toast({ message: resolveErrorMessage(err), tone: 'error' });
        return;
      }
      try {
        const after = await getCharacterSheet(characterId, username);
        onResolved(after);
        toast({ message: `Spell choices confirmed for ${sheet.name}.`, tone: 'success' });
      } catch {
        toast({
          message: "Couldn't refresh your sheet — reload to see the result.",
          tone: 'warn',
        });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // TAV-SPELLPICK-POOL-GROUPING: cantrips are a single spell level, so this
  // pool stays flat — just sorted, for consistency with the leveled groups.
  const cantripPool: AvailableSpellEntry[] = available
    ? [...available.cantrips]
        .filter((s) => !s.in_repertoire)
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  // TAV-SPELLPICK-POOL-GROUPING: was a single flat `Object.values(...).flat()`
  // across every spell level — grouped here, mirroring the PROVEN pattern in
  // SpellbookPanel.tsx's Browse tab (its `Object.entries(available.by_level)`
  // sort-and-map). ONE budget (`selectedLeveled`/`leveledCap`) still spans
  // every level below — the cap is a single cross-level allotment, not a
  // per-level one, so grouping is purely presentational.
  const leveledGroups: [string, AvailableSpellEntry[]][] = available
    ? Object.entries(available.by_level)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(
          ([lvl, spells]) =>
            [
              lvl,
              spells
                .filter((s) => !s.in_repertoire)
                .sort((a, b) => a.name.localeCompare(b.name)),
            ] as [string, AvailableSpellEntry[]],
        )
        .filter(([, spells]) => spells.length > 0)
    : [];

  // Shared toggle-button row — pulled out of renderBucket so the leveled
  // bucket's per-level sub-groups (below) can reuse the exact same button
  // markup/a11y (aria-pressed, disabled-at-cap) without duplicating it.
  function renderOptionButtons(
    pool: AvailableSpellEntry[],
    picked: Set<string>,
    setPicked: (next: Set<string>) => void,
    cap: number,
  ) {
    return pool.map((s) => {
      const checked = picked.has(s.slug);
      const disabled = busy || (!checked && picked.size >= cap);
      return (
        // LEVELUP-UX: each option gets a SpellInfoPopover wrapper — hovering
        // the option (or focusing/tapping its ⓘ trigger) shows casting time/
        // range/components/duration/description, inlined on the entry by the
        // engine. The toggle button itself is unchanged (no nested
        // interactives — the trigger is a sibling).
        <SpellInfoPopover key={s.slug} spell={s}>
          <button
            type="button"
            aria-pressed={checked}
            className={checked ? `${styles.option} ${styles.optionOn}` : styles.option}
            disabled={disabled}
            onClick={() => toggle(picked, setPicked, s.slug, cap)}
          >
            {s.name}
          </button>
        </SpellInfoPopover>
      );
    });
  }

  function renderBucket(
    hintId: string,
    label: string,
    emptyNoun: string,
    pool: AvailableSpellEntry[],
    picked: Set<string>,
    setPicked: (next: Set<string>) => void,
    cap: number,
  ) {
    return (
      <div key={hintId}>
        <p id={hintId} className={styles.hint} aria-live="polite" aria-atomic="true">
          {label} — {picked.size} of {cap} chosen
        </p>
        {pool.length === 0 ? (
          <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
            No new {emptyNoun} available to learn right now.
          </p>
        ) : (
          <div className={styles.optionRow} role="group" aria-labelledby={hintId}>
            {renderOptionButtons(pool, picked, setPicked, cap)}
          </div>
        )}
      </div>
    );
  }

  // TAV-SPELLPICK-POOL-GROUPING: the leveled bucket's own renderer — one
  // aria-live hint + one role="group" spans ALL levels (same accessible name/
  // count contract renderBucket uses for a single-level pool), with a
  // "Level N" sublabel per non-empty group inside it.
  function renderLeveledBucket() {
    return (
      <div key={leveledHintId}>
        <p id={leveledHintId} className={styles.hint} aria-live="polite" aria-atomic="true">
          New spells — {selectedLeveled.size} of {leveledCap} chosen
        </p>
        {leveledGroups.length === 0 ? (
          <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
            No new spells available to learn right now.
          </p>
        ) : (
          <div role="group" aria-labelledby={leveledHintId}>
            {leveledGroups.map(([lvl, spells]) => (
              <div key={lvl}>
                <p className={styles.levelSubLabel}>Level {lvl}</p>
                <div className={styles.optionRow}>
                  {renderOptionButtons(spells, selectedLeveled, setSelectedLeveled, leveledCap)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.card} aria-busy={busy}>
      {/* TAV-SHEET-HEADING-ORDER: h3 — nested under "Pending choices" (h2). */}
      <h3 id={headingId} className={styles.cardLabel}>
        {choice.label}
      </h3>
      {loadState === 'loading' && (
        <p className={styles.emptyRow} aria-busy="true" aria-live="polite" aria-atomic="true">
          Loading spell options…
        </p>
      )}
      {loadState === 'error' && (
        <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
          Couldn&rsquo;t load spell options.{' '}
          <Button variant="ghost" size="default" onClick={() => setLoadKey((k) => k + 1)}>
            Retry
          </Button>
        </p>
      )}
      {loadState === 'ok' && cantripCap > 0 &&
        renderBucket(
          cantripHintId,
          'Cantrips',
          'cantrips',
          cantripPool,
          selectedCantrips,
          setSelectedCantrips,
          cantripCap,
        )}
      {loadState === 'ok' && leveledCap > 0 && renderLeveledBucket()}
      <Button
        variant="primary"
        size="default"
        aria-label={`Confirm spell choices (level ${choice.level})`}
        aria-busy={busy}
        // Miko-QA MUST-FIX: gate on `loadState === 'loading'`, NOT 'error' —
        // a click while getAvailableSpells is still in flight would resolve
        // with zero picks, and _queue_level_choices never re-queues a
        // dedupe-by-id `spell:{level}` choice, so a slow tick or an
        // impatient tap would PERMANENTLY forfeit that level's spell picks.
        // The error-state Confirm stays enabled on purpose — that's the
        // intentional knowing-forgo path (fetch genuinely failed, nothing
        // more to wait for).
        disabled={busy || loadState === 'loading'}
        onClick={() => void handleResolve()}
      >
        {busy ? '…' : 'Confirm'}
      </Button>
    </div>
  );
}

/**
 * INVOC — `feature_choice` choice: a class's choose-N feature menu (warlock
 * Eldritch Invocations today; generic for any menu a homebrew class row
 * declares). Unlike the sibling cards there is NO fetch: the option menu
 * rides ON the pending-choice entry itself (`choice.options`, enriched at
 * sheet-read time) — display + pre-validation only, `_resolve_feature_choice`
 * re-validates everything server-side. Options above the character's level
 * render disabled with the requirement inline (the FEAT-PREREQ-UX pattern).
 * RAW swap-one-on-level-up rides the same resolution: when the character
 * already knows picks from this menu, an optional swap section offers
 * drop-one-known + add-one-new alongside the new picks.
 */
function FeatureChoiceCard({ characterId, username, sheet, choice, onResolved }: ChoiceCardProps) {
  const { toast } = useToast();
  const headingId = useId();
  const cap = choice.count ?? 0;
  const options = choice.options ?? [];
  const menuLabel = choice.menu_label ?? 'options';
  /* True while the character still OWES an archetype pick. Distinguishes "this
     menu is empty because you haven't chosen a School yet" from "this menu is
     genuinely broken" — the two need opposite advice, and the second one's
     copy ("reload the sheet") is an infinite loop if shown for the first. */
  const awaitingArchetype = (sheet.pending_choices ?? []).some(
    (c) => c.type === 'subclass',
  );
  const known =
    sheet.feature_choices?.find((g) => g.label === choice.menu_label)?.picks ?? [];
  const knownSlugs = new Set(known.map((p) => p.slug));
  const pickHintId = `${headingId}-picks`;
  const swapHintId = `${headingId}-swap`;

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [swapDrop, setSwapDrop] = useState('');
  const [swapAdd, setSwapAdd] = useState('');
  // Kage I3 (INVOC r1): the swap section duplicates the entire option pool
  // (~124 tab stops on one card for an L5 warlock) for an optional feature
  // most resolutions never use — collapsed behind a disclosure; the lists
  // only render (and only enter the tab order) while open. Closing it
  // clears any partial swap so a hidden half-selection can't hold Confirm
  // hostage.
  const [swapOpen, setSwapOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Synchronous double-submit latch — same useRef pattern as the sibling cards. */
  const busyRef = useRef(false);

  // The new-picks pool: everything not already known. Level-unmet options
  // stay VISIBLE but disabled with the requirement inline — players plan
  // ahead, and hiding them would make the menu look smaller than it is.
  const pool = options.filter((o) => !knownSlugs.has(o.slug));

  function togglePick(slug: string) {
    if (busy) return;
    const next = new Set(picked);
    if (next.has(slug)) {
      next.delete(slug);
    } else if (next.size < cap) {
      next.add(slug);
      // Miko P2-1 (INVOC gate): a slug can't be both a new pick and the
      // swap replacement — and clearing ONLY swapAdd used to orphan the
      // still-pressed drop half (Confirm silently dead, no copy anywhere).
      // Picking the option as a new pick withdraws the whole swap intent.
      if (swapAdd === slug) {
        setSwapAdd('');
        setSwapDrop('');
      }
    }
    setPicked(next);
  }

  // Swap is all-or-nothing: both halves chosen, or neither.
  const swapComplete = (swapDrop === '') === (swapAdd === '');
  // Miko P2-2 (INVOC gate): a choice can ask for more picks than the
  // character can currently take (count > non-known, level-eligible
  // options) — reachable for a thin homebrew menu, and previously an
  // UNMESSAGED permanent dead end (Confirm disabled, counter looked like
  // ordinary in-progress state). Detect it and say so below.
  const eligibleCount = pool.filter((o) => o.level <= sheet.level).length;
  const shortfall = options.length > 0 && eligibleCount < cap;
  // cap >= 1 pairs with the render-side dead-end (Kage m6): a malformed
  // count-less entry must never be confirmable at zero picks.
  const canConfirm =
    !busy && options.length > 0 && cap >= 1 && picked.size === cap && swapComplete;

  async function handleResolve() {
    if (busyRef.current || !canConfirm) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const selection: {
        picks: string[];
        swap?: { drop: string; add: string };
      } = { picks: Array.from(picked) };
      if (swapDrop && swapAdd) selection.swap = { drop: swapDrop, add: swapAdd };
      try {
        await resolveLevelChoice(characterId, username, choice.id, selection);
      } catch (err) {
        toast({ message: resolveErrorMessage(err), tone: 'error' });
        return;
      }
      try {
        const after = await getCharacterSheet(characterId, username);
        onResolved(after);
        const names = options
          .filter((o) => picked.has(o.slug))
          .map((o) => o.name)
          .join(', ');
        // Kage m13: a swap deserves confirmation too — the engine's own
        // message includes it, the toast shouldn't drop it.
        const swapNote =
          selection.swap != null
            ? ` (swapped ${known.find((o) => o.slug === selection.swap?.drop)?.name ?? selection.swap.drop} for ${options.find((o) => o.slug === selection.swap?.add)?.name ?? selection.swap.add})`
            : '';
        toast({
          message: `${sheet.name} learns ${names || menuLabel}${swapNote}!`,
          tone: 'success',
        });
      } catch {
        toast({
          message: "Couldn't refresh your sheet — reload to see the result.",
          tone: 'warn',
        });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function optionButton(
    o: FeatureChoiceOption,
    isOn: boolean,
    onClick: () => void,
    atCap: boolean,
  ) {
    const levelUnmet = o.level > sheet.level;
    return (
      <SpellInfoPopover
        key={o.slug}
        spell={{ name: o.name, description: o.description }}
        detailsLabel="Feature details"
        emptyLabel="No details available yet."
      >
        <button
          type="button"
          aria-pressed={isOn}
          className={isOn ? `${styles.option} ${styles.optionOn}` : styles.option}
          disabled={busy || levelUnmet || (!isOn && atCap)}
          onClick={onClick}
        >
          {o.name}
          {levelUnmet && (
            <span className={styles.prereqNote}> — requires level {o.level}</span>
          )}
        </button>
      </SpellInfoPopover>
    );
  }

  return (
    <div className={styles.card} aria-busy={busy}>
      {/* TAV-SHEET-HEADING-ORDER: h3 — nested under "Pending choices" (h2). */}
      <h3 id={headingId} className={styles.cardLabel}>
        {choice.label}
      </h3>
      {options.length === 0 && awaitingArchetype ? (
        /* ENGINE-SUBCLASS-SCOPED-MENUS: a menu whose every option is scoped to
           an archetype is legitimately EMPTY until one is chosen — the engine
           refuses this pick with `subclass_required` for the same reason. The
           generic "reload the sheet" copy below would be a lie here: reloading
           never helps, so the player loops. Name the actual next step. */
        <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
          Choose your archetype first — the {menuLabel} menu depends on it.
        </p>
      ) : options.length === 0 || cap < 1 ? (
        // Enrichment missing OR a malformed/legacy entry with no count
        // (Kage m6: cap 0 used to make Confirm enable at zero picks and
        // silently consume the choice). Honest dead-end either way.
        <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
          The {menuLabel} menu isn&rsquo;t available right now — reload the sheet
          to try again.
        </p>
      ) : (
        <>
          <p id={pickHintId} className={styles.hint} aria-live="polite" aria-atomic="true">
            New picks — {picked.size} of {cap} chosen
          </p>
          {/* Miko P2-2: say WHY Confirm can never enable, instead of looking
              like ordinary in-progress state forever. */}
          {shortfall && (
            <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
              Only {eligibleCount} of the {cap} required picks{' '}
              {eligibleCount === 1 ? 'is' : 'are'} available at level {sheet.level} —
              level up further to finish this choice.
            </p>
          )}
          <div className={styles.optionRow} role="group" aria-labelledby={pickHintId}>
            {pool.map((o) =>
              optionButton(
                o,
                picked.has(o.slug),
                () => togglePick(o.slug),
                picked.size >= cap,
              ),
            )}
          </div>
          {known.length > 0 && (
            <>
              {/* Kage I3: disclosure — the drop/add lists (a near-full
                  second copy of the pool) render only while open. */}
              <Button
                variant="ghost"
                size="default"
                aria-expanded={swapOpen}
                disabled={busy}
                onClick={() => {
                  if (swapOpen) {
                    // Closing clears any partial swap — a hidden
                    // half-selection must not keep Confirm disabled.
                    setSwapDrop('');
                    setSwapAdd('');
                  }
                  setSwapOpen((v) => !v);
                }}
              >
                {/* Kage r2-7: closing DISCARDS any selection — say so
                    when one exists instead of a neutral "Hide". */}
                {swapOpen
                  ? swapDrop || swapAdd
                    ? 'Cancel swap'
                    : 'Hide swap'
                  : 'Swap a known pick…'}
              </Button>
              {swapOpen && (
                <>
                  <p id={swapHintId} className={styles.hint}>
                    Optional: swap one known pick (choose one to drop AND its
                    replacement, or leave both unselected)
                  </p>
                  {/* Miko P2-1 rider: a half-selected swap silently disabled
                      Confirm — name the reason while it's incomplete. */}
                  {!swapComplete && (
                    <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
                      Finish the swap ({swapDrop ? 'pick its replacement' : 'pick what to drop'})
                      or clear it to confirm.
                    </p>
                  )}
                  <div role="group" aria-labelledby={swapHintId}>
                    <p className={styles.levelSubLabel}>Drop</p>
                    <div className={styles.optionRow}>
                      {known.map((o) =>
                        optionButton(
                          o,
                          swapDrop === o.slug,
                          () => {
                            if (busy) return;
                            setSwapDrop((prev) => (prev === o.slug ? '' : o.slug));
                          },
                          false,
                        ),
                      )}
                    </div>
                    <p className={styles.levelSubLabel}>Add instead</p>
                    <div className={styles.optionRow}>
                      {pool
                        .filter((o) => !picked.has(o.slug))
                        .map((o) =>
                          optionButton(
                            o,
                            swapAdd === o.slug,
                            () => {
                              if (busy) return;
                              setSwapAdd((prev) => (prev === o.slug ? '' : o.slug));
                            },
                            false,
                          ),
                        )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
      <Button
        variant="primary"
        size="default"
        aria-label={`Confirm ${menuLabel} (level ${choice.level})`}
        aria-busy={busy}
        disabled={!canConfirm}
        onClick={() => void handleResolve()}
      >
        {busy ? '…' : 'Confirm'}
      </Button>
    </div>
  );
}

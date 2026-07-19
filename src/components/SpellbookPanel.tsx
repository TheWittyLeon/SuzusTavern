'use client';
/**
 * SpellbookPanel — T4 (DDX-11t sheet Spells tab slice, character sheet).
 *
 * The sheet-scoped repertoire browser: a caster's known/prepared spellbook
 * (Known tab) plus a browse-and-learn pool (Browse tab), fed by the DDX-11
 * spell-repertoire hops (getKnownSpells / getAvailableSpells / learnSpell /
 * prepareSpell). This is a SEPARATE affordance from SpellSlotsPanel, which
 * owns spend/restore of numbered slot PIPS — this panel owns WHICH spells the
 * character actually has, and rides right below it in the same Spells
 * column. Mirrors InventoryPanel/SpellSlotsPanel's conventions exactly: the
 * shared synchronous `useRef` busy-latch, a success toast (a11y), per-control
 * aria-label naming action+target, aria-busy on the in-flight control,
 * disabled-while-busy, empty/non-caster graceful states.
 *
 * Non-casters render NOTHING: `isCaster` mirrors the sheet's own
 * `is_spellcaster` flag, checked FIRST (before any hook that would fetch),
 * matching SpellSlotsPanel's isCaster gate — the parent page ALSO wraps the
 * whole Card on `sheet.is_spellcaster` (same split: parent owns the Card,
 * this owns the content), so a non-caster's sheet never mounts this
 * component at all; the internal guard is a defense-in-depth backstop.
 *
 * Data source: unlike InventoryPanel/SpellSlotsPanel/HpControl, this panel's
 * data (the repertoire + the available pool) is NOT part of CharacterSheet
 * (see types.ts — no `spells`/`available_spells` field on that type) and
 * mutating it (learn/prepare) never changes HP/AC/spell_slots either — so
 * there is no `onChanged`/getCharacterSheet refetch here. Refetch-after-
 * mutate instead means "re-GET the two repertoire lists this panel itself
 * owns" — getKnownSpells always, and getAvailableSpells too if the Browse
 * tab has ever been opened this mount (no point re-fetching a pool the user
 * hasn't looked at yet).
 *
 * Engine owns every learn/prepare business rule (count caps, class-list
 * membership, caster-kind eligibility) — this component only wires the hops.
 * The learn/prepare refusals are mostly DETERMINISTIC (already_known,
 * over_known_limit, over_cantrip_limit, over_spellbook_limit,
 * not_on_class_list, spell_level_too_high, not_a_learning_caster;
 * cannot_prepare_cantrip, not_a_prepared_caster, spell_not_in_spellbook,
 * over_prepared_limit) — `learnErrorMessage`/`prepareErrorMessage` read the
 * engine's reason code off the caught ApiError (`body.data.reason` /
 * `body.reason` / `e.code`, same probe as RebindCharacterButton's
 * bindErrorMessage) and map it to specific copy; a generic "try again in a
 * moment" toast is reserved for a real network/unknown failure (no reason in
 * the body). This does NOT re-derive or gate on caster_kind beyond what's
 * needed to decide which buttons to SHOW — Browse's Learn/Prepare buttons
 * additionally gate Prepare on `in_repertoire` (a spellbook/wizard caster
 * must learn before preparing; prepared casters like cleric/druid have
 * `in_repertoire` effectively always true) — but a click that still slips
 * through to an ineligible spell is a legal user action that gets a clean,
 * specific refusal toast, not a silent client-side block.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import { useToast } from '@/components/Toast';
import {
  getAvailableSpells,
  getKnownSpells,
  learnSpell,
  prepareSpell,
} from '@/lib/api/dnd';
import type {
  ApiError,
  AvailableSpellEntry,
  AvailableSpellsResult,
  SheetSpellEntry,
  SpellListResult,
} from '@/lib/api/types';
import styles from './SpellbookPanel.module.css';

type Tab = 'known' | 'browse';
type FetchState = 'idle' | 'loading' | 'ok' | 'error';

function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e;
}

/** Same body-shape probe as RebindCharacterButton's bindErrorMessage: the
 *  engine's refusal reason may land in `body.data.reason`, `body.reason`, or
 *  (for the {success:false} envelope path) `e.code` directly — see dnd.ts's
 *  learnSpell/prepareSpell docstrings + client.ts's apiCall. */
function refusalReason(e: ApiError): string | undefined {
  const body = e.body as { data?: { reason?: string }; reason?: string } | null | undefined;
  return body?.data?.reason ?? body?.reason ?? e.code;
}

// Deterministic learn refusals (engine owns every rule — this only maps the
// reason code to short, specific copy). A reason NOT in this map, or a
// non-ApiError (network/unknown), falls back to the generic transient message.
const LEARN_REFUSAL_COPY: Record<string, string> = {
  already_known: 'Already in your spellbook.',
  over_known_limit: "You've reached your known-spell limit.",
  over_spellbook_limit: "You've reached your known-spell limit.",
  over_cantrip_limit: "You've reached your cantrip limit.",
  not_on_class_list: "That spell isn't on your class list.",
  spell_level_too_high: 'That spell is above your level.',
  not_a_learning_caster: "Your class can't learn new spells this way.",
};

// Deterministic prepare refusals — same convention as LEARN_REFUSAL_COPY.
const PREPARE_REFUSAL_COPY: Record<string, string> = {
  cannot_prepare_cantrip: 'Cantrips are always ready — no need to prepare.',
  not_a_prepared_caster: "Your class doesn't prepare spells this way.",
  spell_not_in_spellbook: 'Learn that spell before preparing it.',
  over_prepared_limit: "You've prepared all you can.",
};

function learnErrorMessage(err: unknown, name: string): string {
  const fallback = `Could not learn ${name}. Try again in a moment.`;
  if (!isApiError(err)) return fallback;
  const reason = refusalReason(err);
  return LEARN_REFUSAL_COPY[reason ?? ''] ?? fallback;
}

function prepareErrorMessage(err: unknown, name: string): string {
  const fallback = `Could not update ${name}. Try again in a moment.`;
  if (!isApiError(err)) return fallback;
  const reason = refusalReason(err);
  return PREPARE_REFUSAL_COPY[reason ?? ''] ?? fallback;
}

export interface SpellbookPanelProps {
  characterId: string;
  username: string;
  /** Learn/prepare controls only render for the owner — mirrors
   *  InventoryPanel/SpellSlotsPanel's isOwner gate. A non-owner still sees
   *  the read-only Known list (Browse is owner-only: learning/preparing a
   *  spell for someone else's character makes no sense). */
  isOwner: boolean;
  /** Mirrors the sheet's `is_spellcaster` — see the header comment. */
  isCaster: boolean;
}

function groupByLevel(spells: SheetSpellEntry[]): [number, SheetSpellEntry[]][] {
  const byLevel = new Map<number, SheetSpellEntry[]>();
  for (const s of spells) {
    const list = byLevel.get(s.level) ?? [];
    list.push(s);
    byLevel.set(s.level, list);
  }
  return Array.from(byLevel.entries()).sort((a, b) => a[0] - b[0]);
}

export default function SpellbookPanel({
  characterId,
  username,
  isOwner,
  isCaster,
}: SpellbookPanelProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('known');

  const [known, setKnown] = useState<SpellListResult | null>(null);
  const [knownState, setKnownState] = useState<FetchState>('idle');

  const [available, setAvailable] = useState<AvailableSpellsResult | null>(null);
  const [availableState, setAvailableState] = useState<FetchState>('idle');
  /** Tracks whether Browse has ever been opened this mount — refetch-after-
   *  mutate only re-pulls the available pool if the user has actually seen
   *  it, mirrored from availableState !== 'idle'. */
  const availableLoadedRef = useRef(false);

  const [busy, setBusy] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** Synchronous double-submit latch — see InventoryPanel's header comment. */
  const mutationBusyRef = useRef(false);

  // A11Y (Iro CRITICAL-1/MAJOR-2): roving-tabindex refs for the tab buttons
  // (indexed by tabOrder position, mirrors Composer.tsx's mode tablist) and
  // per-panel refs for the MODERATE-1 focus-on-open behavior below.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const knownPanelRef = useRef<HTMLDivElement>(null);
  const browsePanelRef = useRef<HTMLDivElement>(null);
  const panelRefs = { known: knownPanelRef, browse: browsePanelRef } as const;
  const tabOrder: Tab[] = isOwner ? ['known', 'browse'] : ['known'];
  const TAB_LABEL: Record<Tab, string> = { known: 'Known', browse: 'Browse' };

  // A11Y (Iro MAJOR-3): focus-restore target after a Learn/Prepare mutate —
  // the disabled-while-busy button either re-enables in place (Known tab) or
  // unmounts entirely (Browse Learn -> Prepare swap), so the <li> itself,
  // not the button, is the reliable thing to refocus. Keyed by slug; only
  // one of Known/Browse is ever mounted at a time so key collisions are moot.
  const rowRefs = useRef<Map<string, HTMLLIElement | null>>(new Map());
  function setRowRef(slug: string) {
    return (el: HTMLLIElement | null) => {
      if (el) rowRefs.current.set(slug, el);
      else rowRefs.current.delete(slug);
    };
  }

  /**
   * `silent` distinguishes the two callers: a plain mount/tab-open load shows
   * its own loading spinner and flips to an 'error' empty-state on failure
   * (nothing to preserve yet); a post-mutate refetch (silent:true) must NOT
   * clobber the last-good list on failure — same "stale display + warn
   * toast" contract InventoryPanel/SpellSlotsPanel use for their own
   * refetch-after-mutate — so it rethrows instead of touching state, letting
   * refetchAfterMutate's caller (handleLearn/handlePrepare) show the warn
   * toast while the previously-rendered list stays exactly as it was.
   */
  const loadKnown = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setKnownState('loading');
      try {
        const data = await getKnownSpells(characterId, username);
        setKnown(data);
        setKnownState('ok');
      } catch (err) {
        if (!opts?.silent) {
          setKnownState('error');
          return;
        }
        throw err;
      }
    },
    [characterId, username],
  );

  const loadAvailable = useCallback(
    async (opts?: { silent?: boolean }) => {
      availableLoadedRef.current = true;
      if (!opts?.silent) setAvailableState('loading');
      try {
        const data = await getAvailableSpells(characterId, username);
        setAvailable(data);
        setAvailableState('ok');
      } catch (err) {
        if (!opts?.silent) {
          setAvailableState('error');
          return;
        }
        throw err;
      }
    },
    [characterId, username],
  );

  useEffect(() => {
    if (!isCaster) return;
    // Canonical fetch-on-mount pattern (React docs "Fetching data" example).
    // There's no external store to subscribe to here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadKnown();
    // Re-fetch from scratch on character/user change; Browse re-loads lazily
    // the next time its tab is opened (availableLoadedRef resets below).
    availableLoadedRef.current = false;
    setAvailable(null);
    setAvailableState('idle');
  }, [isCaster, loadKnown]);

  function openTab(next: Tab) {
    setTab(next);
    // MIKO SHOULD-FIX: retry on re-open. A failed first load sets
    // availableState to 'error' permanently — without this, switching away
    // from Browse and back never retries, stranding the user on "Couldn't
    // load available spells." until a full page reload.
    if (next === 'browse' && (availableState === 'idle' || availableState === 'error')) {
      void loadAvailable();
    }
    // A11Y (Iro MODERATE-1): move focus onto the panel so its aria-live
    // loading/error/empty announcements land somewhere perceivable. The
    // keyboard arrow-key handler below re-focuses the tab button afterward,
    // which wins for that path (Composer's own tablist convention); this is
    // the resting focus for a plain tab click.
    panelRefs[next].current?.focus();
  }

  /** Shared refetch-after-mutate: always re-pull Known (its budget/entries
   *  always changed); re-pull Available too only if it's been loaded, since
   *  its in_repertoire/prepared flags and budget also shift on every
   *  learn/prepare. Both calls are `silent` — see loadKnown's header comment
   *  — so a failure here propagates to the caller's own try/catch instead of
   *  wiping the last-good list. */
  async function refetchAfterMutate() {
    await loadKnown({ silent: true });
    if (availableLoadedRef.current) await loadAvailable({ silent: true });
  }

  async function handleLearn(slug: string, name: string) {
    const key = `learn:${slug}`;
    if (mutationBusyRef.current) return;
    mutationBusyRef.current = true;
    setBusy(true);
    setBusyKey(key);
    try {
      try {
        await learnSpell(characterId, username, slug);
      } catch (err) {
        toast({ message: learnErrorMessage(err, name), tone: 'error' });
        return;
      }
      try {
        await refetchAfterMutate();
        // Announce success programmatically (a11y): the list re-render is
        // visual-only, so screen-reader users need the toast's live-region.
        toast({ message: `Learned ${name}.`, tone: 'success' });
      } catch {
        toast({
          message: "Couldn't refresh your spellbook — reload to see the result.",
          tone: 'warn',
        });
      }
    } finally {
      mutationBusyRef.current = false;
      setBusy(false);
      setBusyKey(null);
      // A11Y (Iro MAJOR-3): the button this click came from is either
      // re-enabling in place or unmounting (Browse Learn -> Prepare swap) —
      // refocus the stable row instead of letting focus strand at <body>.
      rowRefs.current.get(slug)?.focus();
    }
  }

  async function handlePrepare(slug: string, name: string, prepared: boolean) {
    const key = `prepare:${slug}`;
    if (mutationBusyRef.current) return;
    mutationBusyRef.current = true;
    setBusy(true);
    setBusyKey(key);
    try {
      try {
        await prepareSpell(characterId, username, slug, prepared);
      } catch (err) {
        toast({ message: prepareErrorMessage(err, name), tone: 'error' });
        return;
      }
      try {
        await refetchAfterMutate();
        toast({
          message: prepared ? `Prepared ${name}.` : `Unprepared ${name}.`,
          tone: 'success',
        });
      } catch {
        toast({
          message: "Couldn't refresh your spellbook — reload to see the result.",
          tone: 'warn',
        });
      }
    } finally {
      mutationBusyRef.current = false;
      setBusy(false);
      setBusyKey(null);
      // A11Y (Iro MAJOR-3): see handleLearn's matching comment.
      rowRefs.current.get(slug)?.focus();
    }
  }

  if (!isCaster) return null;

  const canPrepareKnown =
    known?.caster_kind === 'prepared' || known?.caster_kind === 'spellbook';

  return (
    <>
      <div className={styles.cardHead}>
        {/* TAV-SHEET-HEADING-ORDER: h2 — only rendered as a top-level sibling
            section on the character sheet (see InventoryPanel's comment). */}
        <h2 className="label" style={{ margin: 0 }}>
          Spellbook
        </h2>
      </div>

      <div
        className={styles.tabs}
        role="tablist"
        aria-label="Spellbook view"
        onKeyDown={(e) => {
          // A11Y (Iro CRITICAL-1): arrow-key roving tabindex, mirrors
          // Composer.tsx's mode tablist exactly (ArrowLeft/Right cycle,
          // Home/End jump to the ends).
          const idx = tabOrder.indexOf(tab);
          let next = idx;
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            next = (idx + 1) % tabOrder.length;
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            next = (idx - 1 + tabOrder.length) % tabOrder.length;
          } else if (e.key === 'Home') {
            e.preventDefault();
            next = 0;
          } else if (e.key === 'End') {
            e.preventDefault();
            next = tabOrder.length - 1;
          }
          if (next !== idx) {
            openTab(tabOrder[next]);
            // Move focus to the newly-active tab, not just the selection —
            // this runs after openTab's own panel-focus call above, so it
            // wins for the keyboard path.
            tabRefs.current[next]?.focus();
          }
        }}
      >
        {tabOrder.map((k, i) => (
          <button
            key={k}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`spellbook-tab-${k}`}
            aria-controls={`spellbook-panel-${k}`}
            aria-selected={tab === k}
            tabIndex={tab === k ? 0 : -1}
            className={tab === k ? `${styles.tab} ${styles.tabOn}` : styles.tab}
            onClick={() => openTab(k)}
          >
            {TAB_LABEL[k]}
          </button>
        ))}
      </div>

      {tab === 'known' && (
        <div
          ref={knownPanelRef}
          role="tabpanel"
          id="spellbook-panel-known"
          aria-labelledby="spellbook-tab-known"
          tabIndex={-1}
        >
          {knownState === 'loading' && !known && (
            <p className={styles.emptyRow} aria-busy="true">
              Loading spellbook…
            </p>
          )}
          {knownState === 'error' && (
            <p className={styles.emptyRow}>Couldn&rsquo;t load your spellbook.</p>
          )}
          {knownState === 'ok' && known && (
            <>
              {known.cantrips.length === 0 && known.spells.length === 0 ? (
                <p className={styles.emptyRow}>No spells known yet.</p>
              ) : (
                <>
                  {known.cantrips.length > 0 && (
                    <>
                      <p className={styles.levelHead}>Cantrips</p>
                      <ul className={styles.spellList}>
                        {known.cantrips.map((s) => (
                          <li
                            key={s.slug}
                            ref={setRowRef(s.slug)}
                            className={styles.spellRow}
                            tabIndex={-1}
                          >
                            <span className={styles.spellName}>{s.name}</span>
                            <span className={`mono ${styles.spellSchool}`}>{s.school}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {groupByLevel(known.spells).map(([level, spells]) => (
                    <div key={level}>
                      <p className={styles.levelHead}>Level {level}</p>
                      <ul className={styles.spellList}>
                        {spells.map((s) => {
                          const key = `prepare:${s.slug}`;
                          const rowBusy = busy && busyKey === key;
                          return (
                            <li
                              key={s.slug}
                              ref={setRowRef(s.slug)}
                              className={styles.spellRow}
                              aria-busy={rowBusy}
                              tabIndex={-1}
                            >
                              <span className={styles.spellName}>
                                {s.name}
                                {s.prepared && (
                                  <Pill tone="good" className={styles.spellPill}>
                                    prepared
                                  </Pill>
                                )}
                              </span>
                              <span className={`mono ${styles.spellSchool}`}>{s.school}</span>
                              {isOwner && canPrepareKnown && (
                                <Button
                                  variant="ghost"
                                  size="default"
                                  className={styles.spellBtn}
                                  aria-label={`${s.prepared ? 'Unprepare' : 'Prepare'} ${s.name}`}
                                  aria-busy={rowBusy}
                                  disabled={busy}
                                  onClick={() => void handlePrepare(s.slug, s.name, !s.prepared)}
                                >
                                  {rowBusy ? '…' : s.prepared ? 'Unprepare' : 'Prepare'}
                                </Button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'browse' && isOwner && (
        <div
          ref={browsePanelRef}
          role="tabpanel"
          id="spellbook-panel-browse"
          aria-labelledby="spellbook-tab-browse"
          tabIndex={-1}
        >
          {availableState === 'loading' && !available && (
            <p className={styles.emptyRow} aria-busy="true" aria-live="polite" aria-atomic="true">
              Loading available spells…
            </p>
          )}
          {availableState === 'error' && (
            <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
              Couldn&rsquo;t load available spells.{' '}
              <Button
                variant="ghost"
                size="default"
                className={styles.spellBtn}
                onClick={() => void loadAvailable()}
              >
                Retry
              </Button>
            </p>
          )}
          {availableState === 'ok' && available && (
            <>
              {available.cantrips.length === 0 &&
              Object.values(available.by_level).every((l) => l.length === 0) ? (
                <p className={styles.emptyRow} aria-live="polite" aria-atomic="true">
                  Nothing left to learn at your level.
                </p>
              ) : (
                <>
                  {available.cantrips.length > 0 && (
                    <BrowseLevelGroup
                      label="Cantrips"
                      spells={available.cantrips}
                      canLearn={available.can_learn}
                      canPrepare={false}
                      busy={busy}
                      busyKey={busyKey}
                      onLearn={handleLearn}
                      onPrepare={handlePrepare}
                      setRowRef={setRowRef}
                    />
                  )}
                  {Object.entries(available.by_level)
                    .sort((a, b) => Number(a[0]) - Number(b[0]))
                    .map(([lvl, spells]) =>
                      spells.length === 0 ? null : (
                        <BrowseLevelGroup
                          key={lvl}
                          label={`Level ${lvl}`}
                          spells={spells}
                          canLearn={available.can_learn}
                          canPrepare={available.can_prepare}
                          busy={busy}
                          busyKey={busyKey}
                          onLearn={handleLearn}
                          onPrepare={handlePrepare}
                          setRowRef={setRowRef}
                        />
                      ),
                    )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

interface BrowseLevelGroupProps {
  label: string;
  spells: AvailableSpellEntry[];
  canLearn: boolean;
  canPrepare: boolean;
  busy: boolean;
  busyKey: string | null;
  onLearn: (slug: string, name: string) => void;
  onPrepare: (slug: string, name: string, prepared: boolean) => void;
  /** A11Y (Iro MAJOR-3): row-focus-restore target, shared with the parent's
   *  rowRefs Map — see SpellbookPanel's header comment. */
  setRowRef: (slug: string) => (el: HTMLLIElement | null) => void;
}

function BrowseLevelGroup({
  label,
  spells,
  canLearn,
  canPrepare,
  busy,
  busyKey,
  onLearn,
  onPrepare,
  setRowRef,
}: BrowseLevelGroupProps) {
  return (
    <div>
      <p className={styles.levelHead}>{label}</p>
      <ul className={styles.spellList}>
        {spells.map((s) => {
          const learnKey = `learn:${s.slug}`;
          const prepareKey = `prepare:${s.slug}`;
          const learnBusy = busy && busyKey === learnKey;
          const prepareBusy = busy && busyKey === prepareKey;
          const rowBusy = learnBusy || prepareBusy;
          return (
            <li
              key={s.slug}
              ref={setRowRef(s.slug)}
              className={styles.spellRow}
              aria-busy={rowBusy}
              tabIndex={-1}
            >
              <span className={styles.spellName}>
                {s.name}
                {s.in_repertoire && (
                  <Pill tone={s.prepared ? 'good' : 'muted'} className={styles.spellPill}>
                    {s.prepared ? 'prepared' : 'known'}
                  </Pill>
                )}
              </span>
              <span className={`mono ${styles.spellSchool}`}>{s.school}</span>
              <div className={styles.spellBtns}>
                {!s.in_repertoire && canLearn && (
                  <Button
                    variant="ghost"
                    size="default"
                    className={styles.spellBtn}
                    aria-label={`Learn ${s.name}`}
                    aria-busy={learnBusy}
                    disabled={busy}
                    onClick={() => onLearn(s.slug, s.name)}
                  >
                    {learnBusy ? '…' : 'Learn'}
                  </Button>
                )}
                {/* KAGE: a spellbook (wizard) caster must LEARN a spell before
                    preparing it — Prepare on an un-learned Browse row is a
                    guaranteed engine refusal. Prepared casters (cleric/druid)
                    have in_repertoire effectively always true, so they're
                    unaffected by this gate. */}
                {canPrepare && s.in_repertoire && (
                  <Button
                    variant="ghost"
                    size="default"
                    className={styles.spellBtn}
                    aria-label={`${s.prepared ? 'Unprepare' : 'Prepare'} ${s.name}`}
                    aria-busy={prepareBusy}
                    disabled={busy}
                    onClick={() => onPrepare(s.slug, s.name, !s.prepared)}
                  >
                    {prepareBusy ? '…' : s.prepared ? 'Unprepare' : 'Prepare'}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

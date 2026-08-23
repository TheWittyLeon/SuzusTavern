'use client';
/**
 * Character sheet — /character/[id] (ST-054–058).
 *
 * Full 5e sheet rendered from the engine's STRUCTURED read
 * (GET /api/dnd/characters/:id/sheet → get_character_sheet_data), not the
 * cmd_sheet display string. Left column: identity card (ST-055), ability scores +
 * saving throws + skills (ST-056), inventory (ST-057). Right column: Suzu's note,
 * spells (ST-058, hidden for non-casters), class features.
 *
 * The engine is the source of mechanical truth — every number here comes from the
 * payload; the page only formats. Numbers use the mono font + tabular figures.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useAuthGate } from '@/lib/auth/useAuthGate';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { getCharacterSheet } from '@/lib/api/dnd';
import DeleteCharacterButton from '@/components/DeleteCharacterButton';
import LeaveCampaignButton from '@/components/LeaveCampaignButton';
import LevelUpButton from '@/components/LevelUpButton';
import WorkshopBuildControls from '@/components/WorkshopBuildControls';
import LevelChoicePicker from '@/components/LevelChoicePicker';
import SpellInfoPopover from '@/components/SpellInfoPopover';
import type { CharacterSheet } from '@/lib/api/types';
import TavernShell from '@/components/TavernShell';
import PageSkeleton from '@/components/PageSkeleton';
import Card from '@/components/Card';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import Icon from '@/components/Icon';
import SuzuDM from '@/components/SuzuDM';
import InventoryPanel from '@/components/InventoryPanel';
import CurrencyPurse from '@/components/CurrencyPurse';
import ResourcePanel from '@/components/ResourcePanel';
import RestControl from '@/components/RestControl';
import HpControl from '@/components/HpControl';
import SpellSlotsPanel from '@/components/SpellSlotsPanel';
import SpellbookPanel from '@/components/SpellbookPanel';
import { ABILITIES, SKILLS } from '@/lib/dnd/helpers';
import { raceSpeedLabel } from '@/lib/dnd/codex';
import { useSuzuNote } from '@/lib/dnd/useSuzuNote';
import { groupClassFeatures } from '@/lib/dnd/classFeatureText';
import { useClassFeatureDescriptions } from '@/lib/dnd/useClassFeatureDescriptions';
import styles from './CharacterView.module.css';

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export default function CharacterPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { user } = useAuth();
  const username = user?.username ?? null;
  const router = useRouter();

  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  // TAV-SPELLBOOK-STALE-AFTER-PICKER: SpellbookPanel owns its OWN repertoire
  // fetch (getKnownSpells/getAvailableSpells — see that component's header
  // comment on why it isn't part of CharacterSheet), so a level-up spell pick
  // resolved below doesn't touch it. Bumping this nonce on every
  // LevelChoicePicker resolve — subclass/asi included, not just spell — is
  // the low-risk signal to re-pull; an extra idempotent refetch for a
  // subclass/asi resolve is harmless.
  const [spellbookRefreshKey, setSpellbookRefreshKey] = useState(0);

  // TAV-REST-UI: a rest changes state owned by TWO different places — the
  // sheet (hit points, hit dice, spell slots) and ResourcePanel's own fetch
  // (class resources) — and the rest response carries neither, only a
  // message. So a successful rest has to drive both refreshes explicitly;
  // there is nothing to patch locally.
  const [restEpoch, setRestEpoch] = useState(0);

  // Suzu's note (ST-080) — called unconditionally (rules of hooks); null-safe
  // until the sheet loads. No aiAssistLevel source on a session-less sheet yet
  // (FLAGGED), so it defaults to the deterministic placeholder with ZERO LLM
  // calls; a persisted note (once generated) is read back verbatim.
  const { note: suzuNote } = useSuzuNote(sheet);

  // Features list: scaffolding menu labels hidden, repeats (Ability Score
  // Improvement x N) collapsed to one row with a count, rules text resolved
  // by name from the class catalog (classFeatureText.ts / TAV-CLASS-FEATURE-TEXT).
  const { descriptions: classFeatureDescriptions } = useClassFeatureDescriptions(
    sheet?.char_class ?? null,
  );
  const groupedClassFeatures = useMemo(
    () => (sheet ? groupClassFeatures(sheet.class_features) : []),
    [sheet],
  );

  /** Monotonic load generation. Several panels on this sheet (HpControl,
   *  SpellSlotsPanel, CurrencyPurse, InventoryPanel) each refetch and
   *  `setSheet` on their own, and only the panel you clicked greys itself
   *  out — so a slow refetch can land AFTER a later, faster one and revert
   *  the sheet to a stale snapshot. Reproduced (Kage-CR I5): start a rest,
   *  heal 5 while its reconcile is in flight, and the meter goes 4/9 → 9/9 →
   *  back to 4/9 when the rest's GET finally answers. Same defect and same
   *  fix as ResourcePanel's own `loadGenRef`. */
  const loadGenRef = useRef(0);

  /** EVERY direct sheet write goes through here, not through `setSheet`.
   *
   *  The generation counter above only orders `load()` against `load()`. The
   *  panels that cause the race do NOT go through `load` — HpControl,
   *  CurrencyPurse, InventoryPanel and SpellSlotsPanel each run their own
   *  `getCharacterSheet` and hand the result straight back via `onChanged`,
   *  so without this they never invalidate an in-flight load and the guard
   *  is inert against exactly the scenario it was added for (Kage-CR I5,
   *  round 2 — reproduced against the real page after the first fix, which
   *  is why the counter alone was not enough).
   *
   *  Bumping the generation on every direct write makes ANY writer invalidate
   *  ANY in-flight load. The field-visible case is the reverse of the probe:
   *  heal, then rest, and the heal's slower GET lands last carrying pre-rest
   *  hit points — "I long rested and my HP didn't come back."
   *
   *  Safe at mount: the page renders a skeleton until `state === 'ok'`, so no
   *  panel exists to write before the first load resolves. */
  const applySheet = useCallback((next: CharacterSheet) => {
    loadGenRef.current += 1;
    setSheet(next);
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal, opts?: { background?: boolean }) => {
      if (!username || !id) return;
      const gen = ++loadGenRef.current;
      try {
        const data = await getCharacterSheet(id, username, signal);
        if (signal?.aborted || gen !== loadGenRef.current) return;
        setSheet(data);
        setState('ok');
      } catch (err) {
        if (signal?.aborted || gen !== loadGenRef.current) return;
        // BACKGROUND (a post-rest reconcile): rethrow so the caller can say
        // the true thing. Blanking the whole sheet with `setState('error')`
        // after a rest that SUCCEEDED would read as though the rest had
        // failed, and the player would take another — and a rest is
        // irreversible. The initial mount keeps the error card.
        if (opts?.background) throw err;
        setState('error');
      }
    },
    [username, id],
  );

  /** TAV-REST-UI. A rest moved state in two places and the response carries
   *  neither, so both refreshes are driven from here.
   *
   *  ORDER IS LOAD-BEARING: the epoch bump happens BEFORE the await, so a
   *  sheet reconcile that fails still leaves ResourcePanel refetching off a
   *  fresh token. Swap these two lines and a failed reconcile silently
   *  strands the class resources as well as the sheet. */
  const handleRested = useCallback(async () => {
    setRestEpoch((n) => n + 1);
    await load(undefined, { background: true });
  }, [load]);

  /** B1 — LeaveCampaignButton's own local `left` latch already hides the
   *  control instantly, so this refetch exists purely to unstick everything
   *  ELSE on the sheet that gates on `levelup_policy.mode` (WorkshopBuildControls,
   *  LevelUpButton's floor/xp copy) — same background-refetch shape as
   *  `handleRested` above, and for the same reason: a full reload would work
   *  too, but every other post-mutation control on this page avoids one.
   *
   *  A11Y (Tora MAJOR-1 / Iro MAJOR-1, converged): on this success path,
   *  `LeaveCampaignButton` sets its own `left` latch and closes its
   *  `ConfirmDialog` in the SAME commit — the trigger button and the dialog
   *  unmount together, so `ConfirmDialog`'s own focus-restore
   *  (`previouslyFocused.current?.focus()`) targets an already-detached
   *  node and is a silent no-op. Left alone, a keyboard/screen-reader user
   *  loses their place at <body> at the exact moment the escape hatch
   *  succeeds. Same fix shape as `abilityHeadingRef` below (Iro
   *  CRITICAL-4b) and the trash page's `nextBtn ?? backRef`: move focus onto
   *  a stable, always-mounted heading that survives the unmount. Fires
   *  before the await (not after) so it lands regardless of how long the
   *  background refetch takes — the control is already gone by the time
   *  this callback runs either way. */
  const handleLeftCampaign = useCallback(async () => {
    abilityHeadingRef.current?.focus();
    await load(undefined, { background: true });
  }, [load]);

  useEffect(() => {
    if (!username) return;
    const ac = new AbortController();
    // Canonical fetch-on-mount pattern (React docs "Fetching data" example);
    // `load` sets state only after the async request resolves, guarded by
    // `signal.aborted`. There's no external store to subscribe to here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(ac.signal);
    return () => ac.abort();
  }, [username, load]);

  // A11Y (Iro CRITICAL-4b): the LAST pending level-choice resolving unmounts
  // the whole LevelChoicePicker Card (its own render gate below is
  // `pending_choices.length > 0`), stranding focus at <body> — the picker's
  // OWN focus-restore (its "Pending choices" heading) only helps while it's
  // still mounted for a sibling choice, see LevelChoicePicker.tsx's header
  // comment. Track the previous pending count so this only fires on a
  // >0 -> 0 transition, never on the initial load (which may already be 0).
  const abilityHeadingRef = useRef<HTMLHeadingElement>(null);
  // LEVELUP-UX: scroll/focus target for the dialog's "Resolve your choices"
  // CTA — the pending-choices Card itself (Card forwards its root ref and
  // spreads tabIndex; Kage m7 — no extra wrapper DOM node needed).
  const pendingChoicesRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const prevPendingCountRef = useRef(sheet?.pending_choices?.length ?? 0);
  useEffect(() => {
    const count = sheet?.pending_choices?.length ?? 0;
    if (prevPendingCountRef.current > 0 && count === 0) {
      abilityHeadingRef.current?.focus();
    }
    prevPendingCountRef.current = count;
  }, [sheet?.pending_choices]);

  // UIR2-TAV-3: this used to be `if (!user) return <skeleton>` with no
  // escape hatch — a failed silent refresh left `user` null forever, so the
  // skeleton never resolved. useAuthGate bounds it: resolving → skeleton,
  // failed refresh → re-auth prompt, genuinely logged out → /login.
  const gate = useAuthGate({
    skeleton: <PageSkeleton variant="card" lines={4} />,
    label: 'Loading character',
  });
  if (gate) return gate;

  if (state === 'error') {
    return (
      <TavernShell active="dashboard" title="Character">
        <Card className={styles.panel}>
          <p className={styles.errorTitle}>Suzu can&rsquo;t find that one.</p>
          <p className={styles.errorBody}>
            The character may not exist, or it isn&rsquo;t yours to view.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" href="/character/new">
              Create a character
            </Button>
            <Button variant="ghost" href="/dashboard">
              Back to dashboard
            </Button>
          </div>
        </Card>
      </TavernShell>
    );
  }

  if (state === 'loading' || !sheet) {
    return (
      <TavernShell active="dashboard" title="Character">
        <div aria-busy="true" aria-label="Loading character sheet">
          <PageSkeleton variant="card" lines={4} />
          <div style={{ marginTop: 18 }}>
            <PageSkeleton variant="list" lines={4} />
          </div>
        </div>
      </TavernShell>
    );
  }

  const subtitleParts = [
    sheet.race,
    `${sheet.char_class} ${sheet.level}`,
    sheet.subclass || null,
  ].filter(Boolean);
  const initial = (sheet.name || '?').charAt(0).toUpperCase();
  const ageHeightLine = [sheet.alignment, sheet.subrace].filter(Boolean).join(' · ');
  // Precomputed to avoid JSX inter-expression whitespace pitfalls.
  // DDX-10: client-side UX gate only (mirrors every other owner/DM-only
  // affordance in this repo — the engine's real ownership check is the Track A
  // DND_REQUIRE_ACTOR kill-switch). CORRECTED (Kuro-Sec S4, 2026-08-12): this
  // used to claim the flag defaults OFF — it does not. DND_REQUIRE_ACTOR is
  // live TRUE in both dev and prod (has been since ~2026-07-09), so GET
  // .../sheet DOES enforce actor identity server-side today. A security
  // comment that misstates the live posture is worse than none, so: this
  // client-side `isOwner` gate is UX-only either way — it decides whether the
  // Level-Up button renders, nothing more — but never treat this line, or its
  // absence, as evidence of what the server actually enforces.
  const isOwner = !!username && sheet.owner_username.toLowerCase() === username.toLowerCase();

  return (
    <TavernShell
      active="dashboard"
      title={sheet.name}
      actions={
        <>
          {/* B1 (TAV-CHAR-STUCK-AFTER-CAMPAIGN-END): renders nothing unless
              `sheet.levelup_policy` says bound — see the component's own
              header comment. Placed before Delete: freeing a stuck character
              is the lower-stakes, more-likely-needed action of the two. */}
          {username && (
            <LeaveCampaignButton
              characterId={id}
              characterName={sheet.name}
              username={username}
              sheet={sheet}
              onLeft={handleLeftCampaign}
            />
          )}
          {username && (
            <DeleteCharacterButton
              variant="button"
              characterId={id}
              characterName={sheet.name}
              username={username}
              onDeleted={() => router.push('/dashboard')}
            />
          )}
          <Button
            variant="primary"
            href="/lobby"
            leadingIcon={<Icon name="Compass" size={14} aria-hidden />}
          >
            Find a table
          </Button>
        </>
      }
    >
      <div className={styles.sheet}>
        {/* LEFT */}
        <div className={styles.colMain}>
          {/* Identity card (ST-055) */}
          <Card className={styles.identity}>
            <span className={styles.idAvatar} aria-hidden>
              {initial}
            </span>
            <div className={styles.idBody}>
              <p className="label">Background · {sheet.background || '—'}</p>
              {/* The page <h1> (TavernShell title) already is the name; this is a
                  styled display line, not a second heading. */}
              <p className={styles.idName}>{sheet.name}</p>
              <p className={styles.idSub}>
                {subtitleParts.join(' · ').toLowerCase()}
                {ageHeightLine ? ` · ${ageHeightLine.toLowerCase()}` : ''}
              </p>
              <dl className={`mono ${styles.idStats}`}>
                <div className={styles.idStat}>
                  <dt style={{ color: 'var(--cool-ink)' }}>AC</dt>
                  <dd>{sheet.ac}</dd>
                </div>
                <div className={styles.idStat}>
                  <dt style={{ color: 'var(--crit-ink)' }}>INIT</dt>
                  <dd>{signed(sheet.initiative)}</dd>
                </div>
                <div className={styles.idStat}>
                  <dt style={{ color: 'var(--accent-2)' }}>PROF</dt>
                  <dd>+{sheet.proficiency_bonus}</dd>
                </div>
                <div className={styles.idStat}>
                  <dt>SPD</dt>
                  {/* F6/MLP-SHEET-SPEED-CRASH: never render sheet.speed as a
                      raw JSX child — it's a dict for MLP multi-mode
                      movement. raceSpeedLabel (DDX21-1, same crash class)
                      already appends the "ft." unit, so no separate " ft"
                      suffix here. */}
                  <dd>{raceSpeedLabel(sheet.speed)}</dd>
                </div>
              </dl>
              {/* HP (T5/DDX-09): interactive damage/heal, replaces the old
                  static HP dt/dd + hpBar (now owned by HpControl). */}
              <HpControl
                characterId={id}
                username={username ?? ''}
                isOwner={isOwner}
                hp={sheet.hp}
                onChanged={applySheet}
              />
              {sheet.conditions.length > 0 && (
                <div className={styles.conditions}>
                  {sheet.conditions.map((c) => (
                    <Pill key={c} tone="warn">
                      {c}
                    </Pill>
                  ))}
                </div>
              )}
            </div>
            <div className={styles.idLevel}>
              <p className="label">Level</p>
              <p className={styles.idLevelNum}>{sheet.level}</p>
              {/* LVL (Aoi §3b): mode-aware XP line — in workshop mode
                  "XP 0 / 300" four pixels above a button saying "level
                  freely" is a straight contradiction, so the threshold is
                  replaced with a workshop marker. Falls back to today's
                  exact rendering when levelup_policy is absent
                  (pre-upgrade backend). */}
              <p className={`mono ${styles.idXp}`}>
                XP {sheet.xp.toLocaleString()}
                {sheet.levelup_policy?.mode === 'workshop'
                  ? ' · workshop'
                  : sheet.xp_next != null
                    ? ` / ${sheet.xp_next.toLocaleString()}`
                    : ''}
              </p>
            </div>
            {/* DDX-10: owner-only level-up affordance. Absent entirely for a
                non-owner viewer (not merely disabled) — see the isOwner note
                above. Full-width via .wrap/.result's grid-column: 1 / -1. */}
            {username && isOwner && (
              <LevelUpButton
                characterId={id}
                username={username}
                sheet={sheet}
                onLeveledUp={applySheet}
                // LEVELUP-UX: the dialog's "Resolve your choices" CTA lands
                // the user on the pending-choices Card below — scroll +
                // focus (tabIndex={-1} wrapper) so keyboard/SR users arrive
                // too, not just the viewport.
                onResolveChoices={() => {
                  requestAnimationFrame(() => {
                    pendingChoicesRef.current?.scrollIntoView({
                      block: 'start',
                      // Kage m6: the JS option overrides CSS scroll-behavior,
                      // so honor prefers-reduced-motion here explicitly (the
                      // codex page's convention).
                      behavior: reducedMotion ? 'auto' : 'smooth',
                    });
                    pendingChoicesRef.current?.focus({ preventScroll: true });
                  });
                }}
              />
            )}
            {/* LVLDN: workshop-only build editing (level down / reset) —
                renders nothing for bound characters or on a pre-upgrade
                backend (the component's own fail-closed gate). Repertoire
                survives a rebuild but slots/budget change, so the spellbook
                gets the same refresh nudge as a picker resolve. */}
            {username && isOwner && (
              <WorkshopBuildControls
                characterId={id}
                username={username}
                sheet={sheet}
                onRebuilt={(updated) => {
                  applySheet(updated);
                  setSpellbookRefreshKey((k) => k + 1);
                }}
              />
            )}
          </Card>

          {/* T13 (DDX-14t/15t): owner-only level-choice picker — subclass
              archetype / Ability Score Improvement / feat. Same isOwner gate
              as LevelUpButton above (a non-owner has no reason to resolve
              someone else's build decisions, and the engine route is
              OWNER-authed regardless); absent entirely when there is nothing
              pending, not merely empty, mirroring LevelUpButton's own
              own-Card-per-affordance split. */}
          {username && isOwner && (sheet.pending_choices?.length ?? 0) > 0 && (
            <Card ref={pendingChoicesRef} tabIndex={-1}>
              {/* LVL (Aoi gap A): a floor walk (or several banked manual
                  level-ups) stacks 2+ choice cards at once — one framing
                  sentence turns "unrelated-looking cards" into one climb.
                  MUST precede the picker in DOM order so sequential/braille
                  reading hits the framing before the first card. */}
              {(sheet.pending_choices?.length ?? 0) > 1 && (
                <p className={styles.floorWalkNote}>
                  {sheet.name} climbed to level {sheet.level} — resolve these{' '}
                  {sheet.pending_choices?.length} choices in the order they
                  were earned.
                </p>
              )}
              <LevelChoicePicker
                characterId={id}
                username={username}
                sheet={sheet}
                onResolved={(updated) => {
                  applySheet(updated);
                  // TAV-SPELLBOOK-STALE-AFTER-PICKER: see the state
                  // declaration above — nudges SpellbookPanel to re-pull.
                  setSpellbookRefreshKey((k) => k + 1);
                }}
              />
            </Card>
          )}

          {/* Ability scores (ST-056). Heading added as a stable a11y focus
              landmark (Iro CRITICAL-4b, see the effect above) — ref+
              tabIndex=-1 so it's focusable programmatically without joining
              the tab order.
              TAV-SHEET-HEADING-ORDER: h2, not h3 — this is the sheet's first
              section heading after TavernShell's own page h1 (the character
              name); h3 here skipped a level (axe heading-order, moderate).
              Visual size is unaffected — `.label` is a plain utility class,
              not tied to the heading tag. */}
          <h2
            ref={abilityHeadingRef}
            tabIndex={-1}
            className="label"
            style={{ margin: '0 0 8px' }}
          >
            Ability scores
          </h2>
          <div className={styles.abilityRow}>
            {ABILITIES.map((a) => {
              const block = sheet.ability_scores[a.key];
              const score = block?.score ?? 10;
              const mod = block?.modifier ?? 0;
              return (
                <div key={a.key} className={styles.statBox}>
                  <span className={styles.statName}>{a.abbr}</span>
                  <span className={styles.statVal}>{score}</span>
                  <span className={`mono ${styles.statMod}`}>{signed(mod)}</span>
                </div>
              );
            })}
          </div>

          {/* Saving throws (ST-056) */}
          <Card>
            {/* TAV-SHEET-HEADING-ORDER: h2 — sibling section heading to
                "Ability scores" above, not a subsection of it. */}
            <h2 className="label" style={{ margin: '0 0 10px' }}>
              Saving throws
            </h2>
            <div className={styles.saveRow}>
              {ABILITIES.map((a) => {
                const mod = sheet.ability_scores[a.key]?.modifier ?? 0;
                const proficient = sheet.proficient_saves.includes(a.key);
                const total = mod + (proficient ? sheet.proficiency_bonus : 0);
                return (
                  <div key={a.key} className={styles.save} data-prof={proficient}>
                    {/* TAV-20: aria-label is prohibited on a role-less <span>
                        (axe aria-prohibited-attr, serious) so AT never announced
                        proficiency — role="img" makes the dot a labelable node. */}
                    <span
                      role="img"
                      className={`${styles.profDot} ${proficient ? styles.profOn : ''}`}
                      aria-label={proficient ? 'proficient' : 'not proficient'}
                    />
                    <span className={styles.saveName}>{a.abbr}</span>
                    <span className={`mono ${styles.saveMod}`}>{signed(total)}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Skills (ST-056) */}
          <Card>
            {/* TAV-SHEET-HEADING-ORDER: h2 — sibling section heading. */}
            <h2 className="label" style={{ margin: '0 0 10px' }}>
              Skills
            </h2>
            <div className={styles.skillGrid}>
              {SKILLS.map((s) => {
                const abilityMod = sheet.ability_scores[s.ability]?.modifier ?? 0;
                const proficient = sheet.proficient_skills.includes(s.key);
                const total = abilityMod + (proficient ? sheet.proficiency_bonus : 0);
                return (
                  <div key={s.key} className={styles.skillRow}>
                    {/* TAV-20: role="img" so the proficiency aria-label is valid
                        on the dot (was aria-prohibited-attr on a role-less span). */}
                    <span
                      role="img"
                      className={`${styles.profDot} ${proficient ? styles.profOn : ''}`}
                      aria-label={proficient ? 'proficient' : 'not proficient'}
                    />
                    {/* The name and the ability abbr must be SEPARATE
                        blockified children, not two text sources inside one
                        inline span — otherwise the accessible name computation
                        concatenates them and a screen reader announces
                        "AcrobaticsDEX". `.skillName` is a flex row for exactly
                        this reason, which is also why the sibling Saving Throws
                        row above has always read correctly. */}
                    <span className={styles.skillName}>
                      <span>{s.name}</span>
                      <small className={styles.skillAbbr}>{s.abbr}</small>
                    </span>
                    <span className={`mono ${styles.skillMod}`}>{signed(total)}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Inventory (ST-057, interactive equip/unequip — T5/DDX-09) */}
          <Card>
            <InventoryPanel
              characterId={id}
              username={username ?? ''}
              isOwner={isOwner}
              inventory={sheet.inventory}
              inventoryWeight={sheet.inventory_weight}
              onChanged={applySheet}
            />
          </Card>

          {/* Purse (T12/DDX-23t): gold display + owner-only Spend. Own
              small Card, right below Inventory — economy affordances live
              together. */}
          <Card>
            <CurrencyPurse
              characterId={id}
              username={username ?? ''}
              isOwner={isOwner}
              currencyGp={sheet.currency_gp ?? 0}
              onChanged={applySheet}
            />
            {/* Class-declared resources (Ki, Rage, Channel Divinity, a
                subclass's Natural Recovery, ...). Shares the economy card:
                these are the other "spend a finite thing" affordances, and
                the panel renders NOTHING for a class that declares none, so
                a rogue's card is unchanged. `refreshToken` is the sheet's own
                level — a level-up regrows maxima, and the panel owns its own
                fetch rather than the sheet carrying resource state. */}
            <ResourcePanel
              characterId={id}
              username={username ?? ''}
              isOwner={isOwner}
              // COMPOSITE, not a sum. Both a level-up and a rest change the
              // resources, and `level + restEpoch` collides: level 5 after one
              // rest and level 6 after none both read 6, so the post-level-up
              // refetch would silently not fire. See ResourcePanel's prop doc.
              refreshToken={`${sheet.level}:${restEpoch}`}
            />
          </Card>

          {/* ITS OWN CARD, deliberately (Leon's ruling, 2026-08-04).
              Rest first shipped inside the economy Card above, next to the
              purse and the resource panel. That was wrong twice over: those
              two are about SPENDING a finite thing and rest is the opposite
              verb, and rest's broadest effect — hit points — is rendered
              several cards further up, so the control sat as far as possible
              from the number it moves. It is also not a member of any one
              panel's subject: it restores hit points, hit dice, spell slots
              AND class resources, and the resource panel renders nothing at
              all for a class that declares none (rogue, ranger) or for
              everyone when the class-resource flag is off — exactly the
              characters who still need to rest. A standalone Card says
              "broad-effect action", which is what it is. */}
          <Card>
            <RestControl
              characterId={id}
              username={username ?? ''}
              isOwner={isOwner}
              onRested={handleRested}
            />
          </Card>
        </div>

        {/* RIGHT */}
        <div className={styles.colSide}>
          {/* Suzu's note (ST-080) — labeled region; AI-attributed, persona flavor. */}
          <Card pop className={styles.suzuNote} role="region" aria-labelledby="suzu-note-label">
            <div className={styles.suzuHead}>
              <SuzuDM size={42} glow={false} aria-hidden />
              <div>
                {/* --ink-2 (not the .label default --ink-3): this is the region's
                    accessible name and --ink-3 fails AA on the tinted card across
                    the dark palettes. 11px (drop the 0.6rem override) for legibility. */}
                <p className="label" id="suzu-note-label" style={{ color: 'var(--ink-2)' }}>
                  Suzu&rsquo;s note
                </p>
                <p className={styles.suzuHeadTitle}>On {sheet.name.split(' ')[0]}</p>
              </div>
            </div>
            <p className={styles.suzuQuote}>&ldquo;{suzuNote}&rdquo;</p>
          </Card>

          {/* Spells (ST-058, interactive spend/restore — T5/DDX-09) — only
              for casters. The Card wrapper + is_spellcaster gate stay here
              (same split as InventoryPanel: parent owns the Card, the
              component owns the content); SpellSlotsPanel ALSO self-guards
              on its own isCaster prop, see its header comment. */}
          {sheet.is_spellcaster && (
            <Card>
              <SpellSlotsPanel
                characterId={id}
                username={username ?? ''}
                isOwner={isOwner}
                isCaster={sheet.is_spellcaster}
                spellcasting={sheet.spellcasting}
                spellSlots={sheet.spell_slots}
                spellPoints={sheet.spell_points}
                onChanged={applySheet}
              />
            </Card>
          )}

          {/* Spells tab — sheet Spells tab slice (T4 / DDX-11t): browse/learn/
              prepare the actual repertoire. Separate Card from SpellSlotsPanel
              above (that one owns numbered slot pips; this one owns WHICH
              spells the character has) — same is_spellcaster gate, same
              parent-owns-Card / component-owns-content split, and
              SpellbookPanel ALSO self-guards on its own isCaster prop. */}
          {sheet.is_spellcaster && (
            <Card>
              <SpellbookPanel
                characterId={id}
                username={username ?? ''}
                isOwner={isOwner}
                isCaster={sheet.is_spellcaster}
                refreshKey={spellbookRefreshKey}
              />
            </Card>
          )}

          {/* Features */}
          <Card>
            {/* TAV-SHEET-HEADING-ORDER: h2 — sibling section heading. */}
            <h2 className="label" style={{ margin: '0 0 10px' }}>
              Features
            </h2>
            {groupedClassFeatures.length === 0 ? (
              <p className={styles.emptyRow}>No class features recorded.</p>
            ) : (
              <ul className={styles.featureList}>
                {groupedClassFeatures.map((f) => (
                  <li key={f.name} className={styles.featureRow}>
                    <SpellInfoPopover
                      spell={{ name: f.name, description: classFeatureDescriptions[f.name] }}
                      detailsLabel="Feature details"
                      emptyLabel="No details available yet."
                    >
                      {f.name}
                      {f.count > 1 && <span className="mono"> ×{f.count}</span>}
                    </SpellInfoPopover>
                  </li>
                ))}
              </ul>
            )}
            {/* INVOC — the character's CHOSEN menu picks (warlock Eldritch
                Invocations today; generic per menu group). Rendered inside
                the same Features card, one titled block per group; each pick
                gets the SpellInfoPopover treatment so its rules text is one
                hover/tap away (same pattern as the level-up picker). */}
            {(sheet.feature_choices ?? [])
              .filter((group) => group.picks.length > 0)
              .map((group) => (
                <div key={group.label}>
                  {/* h3 — nested under this card's "Features" h2. Kage S1:
                      no raw fontSize override — .label owns the type scale. */}
                  <h3 className="label" style={{ margin: '10px 0 6px' }}>
                    {group.label}
                  </h3>
                  <ul className={styles.featureList}>
                    {group.picks.map((pick) => (
                      <li key={pick.slug} className={styles.featureRow}>
                        <SpellInfoPopover
                          spell={{ name: pick.name, description: pick.description }}
                          detailsLabel="Feature details"
                          emptyLabel="No details available yet."
                        >
                          {pick.name}
                        </SpellInfoPopover>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </Card>

          {/* CHAR-LANG: languages known — race's concrete languages plus the
              setting-wide "Equestrian" grant (every PC speaks it regardless
              of race). `languages` is optional on the wire (pre-existing
              fixtures / a character created before this field existed), so
              this defaults to an empty list rather than crashing. */}
          <Card>
            <h2 className="label" style={{ margin: '0 0 10px' }}>
              Languages
            </h2>
            {(sheet.languages ?? []).length === 0 ? (
              <p className={styles.emptyRow}>No languages recorded.</p>
            ) : (
              <div className={styles.languages}>
                {(sheet.languages ?? []).map((lang) => (
                  <Pill key={lang} tone="muted">
                    {lang}
                  </Pill>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </TavernShell>
  );
}

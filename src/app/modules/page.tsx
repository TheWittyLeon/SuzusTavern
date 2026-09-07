'use client';
/**
 * Modules — the way-to-start (Option B blocking surface; ST-037, ADV-9).
 *
 * Adventure list is data-driven: fetched from GET /api/dnd/catalog?type=adventure
 * (ADV-9). The old hardcoded MODULES constant is gone. Adding a new adventure to
 * the catalog makes it appear here with no Tavern change.
 *
 * content_rating (baked-in decision): default 'sfw'; 'mature' is only selectable
 * on private/unlisted tables. It is client-typed (like dm_mode) — stored locally,
 * not sent to the engine, until the column lands (STORY-313). The hard SFW
 * interlock for public/streamed tables is enforced server-side (STORY-314); the
 * client gating here is convenience, not the guarantee.
 *
 * Suzu's PDF library + your homebrew tabs are post-MVP (disabled).
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useAuthGate } from '@/lib/auth/useAuthGate';
import { useToast } from '@/components/Toast';
import { bindCharacter, createSessionFull, getCatalog, listMyCharacters } from '@/lib/api/dnd';
import type {
  AdventureCatalogItem,
  Character,
  ContentRating,
  DmMode,
  SeriesCatalogItem,
  Visibility,
} from '@/lib/api/types';
import { engineErrorMessage } from '@/lib/dnd/engineError';
import {
  toCatalogItem,
  toSeriesCatalogItem,
  formatLevelRange,
  formatLength,
  formatMemberCount,
} from '@/lib/dnd/adventureCatalog';
import SeriesCoverArt from '@/components/SeriesCoverArt';
import { SESSION_START_REASON_MAP } from '@/lib/dnd/engineReasons';

type AiAssistLevel = 'full' | 'assist' | 'off';
import {
  uniqueChannelFromName,
  setSessionAnnotations,
} from '@/lib/sessionAnnotations';
import TavernShell from '@/components/TavernShell';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Pill, { type PillTone } from '@/components/Pill';
import Icon from '@/components/Icon';
import SuzuDM from '@/components/SuzuDM';
import PageSkeleton from '@/components/PageSkeleton';
import ConfirmDialog from '@/components/ConfirmDialog';
import styles from './Modules.module.css';

// ── ONE-CHAR-ONE-CAMPAIGN-UX: picker state badge ─────────────────────────────

/**
 * State badge for a character card. `in_use` undefined/false ⇒ Free (graceful
 * degrade on a pre-upgrade backend). `active_campaign_status === 'ended'`
 * overrides the "In {name}" copy entirely — an ended campaign still occupies
 * the character's one-and-only binding slot, so the badge tells the player
 * releasing it is the way to reuse it, regardless of the campaign's name.
 */
function characterBadge(c: Character): { text: string; tone: PillTone } {
  if (!c.in_use) return { text: 'Free', tone: 'good' };
  if (c.active_campaign_status === 'ended') {
    return { text: 'Ended — release to reuse', tone: 'bad' };
  }
  return {
    text: c.active_campaign_name ? `In ${c.active_campaign_name}` : 'In another table',
    tone: 'warn',
  };
}

interface CharOption {
  key: string;
  charId: number | undefined;
  selected: boolean;
  label: string;
  meta: string;
  badge: { text: string; tone: PillTone } | null;
  activate: () => void;
}

/**
 * Session-start character picker (ONE-CHAR-ONE-CAMPAIGN-UX). Each character is
 * a keyboard-focusable, selectable card (never disabled) with a state badge.
 * Picking a Free card selects it directly; picking an in-use card arms the
 * release-confirm (via `onPickInUse`) instead of selecting immediately — the
 * selection only commits once the confirm dialog is accepted.
 *
 * `labelledBy` names the group from the wrapping `<fieldset><legend>` (Iro
 * MINOR-6) instead of a redundant `aria-label` duplicating the legend text.
 */
function CharacterPicker({
  characters,
  selectedCharId,
  onPickFree,
  onPickInUse,
  labelledBy,
}: {
  characters: Character[];
  selectedCharId: number | undefined;
  onPickFree: (charId: number | undefined) => void;
  onPickInUse: (c: Character) => void;
  labelledBy: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const options: CharOption[] = [
    {
      key: 'none',
      charId: undefined,
      selected: selectedCharId === undefined,
      label: 'No character',
      meta: 'DM only — you narrate, no PC seated',
      badge: null,
      activate: () => onPickFree(undefined),
    },
    ...characters.map((c) => {
      const charId = Number(c.character_id);
      return {
        key: c.character_id,
        charId,
        selected: selectedCharId === charId,
        label: c.name,
        meta: `Lv ${c.level} ${c.char_class}`,
        badge: characterBadge(c),
        activate: () =>
          c.in_use && c.active_campaign_id
            ? onPickInUse(c)
            : onPickFree(Number.isFinite(charId) ? charId : undefined),
      };
    }),
  ];

  const selectedIdx = options.findIndex((o) => o.selected);
  // Iro CRITICAL-1: roving-tabindex position is tracked independently of
  // `selected` (aria-checked). Arrow keys move ONLY this — they must never
  // call `activate()`, or landing on an in-use card would pop the
  // release-confirm alertdialog on mere navigation (WCAG 3.2.2 On Input).
  const [focusedIdx, setFocusedIdx] = useState(selectedIdx === -1 ? 0 : selectedIdx);

  // Re-sync roving tabindex to the selection whenever `selectedCharId` changes
  // for a reason OTHER than arrow-key focus movement (the initial auto-default,
  // or the confirm dialog committing a release pick) — arrow moves already
  // update focusedIdx directly in `move()`. Adjusted during render (the React-
  // recommended alternative to a sync-effect for "derived state that resets on
  // a prop change") rather than in a useEffect, which would fire one render late.
  const [prevSelectedCharId, setPrevSelectedCharId] = useState(selectedCharId);
  if (selectedCharId !== prevSelectedCharId) {
    setPrevSelectedCharId(selectedCharId);
    if (selectedIdx !== -1) setFocusedIdx(selectedIdx);
  }

  const move = (dir: 1 | -1) => {
    const next = (focusedIdx + dir + options.length) % options.length;
    refs.current[next]?.focus();
    setFocusedIdx(next);
  };

  return (
    <div
      className={styles.charPicker}
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((o, i) => {
        const descId = o.badge ? `char-badge-${o.key}` : undefined;
        return (
          <button
            key={o.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={o.selected}
            aria-describedby={descId}
            tabIndex={i === focusedIdx ? 0 : -1}
            className={`${styles.charCard} ${o.selected ? styles.charCardOn : ''}`}
            onFocus={() => setFocusedIdx(i)}
            onClick={(e) => {
              // Iro MAJOR-4: Safari/WebKit doesn't focus a <button> on mouse
              // click, so ConfirmDialog's `previouslyFocused` capture could
              // miss this card. Focus it explicitly before arming/selecting —
              // this also makes CRITICAL-1's focus tracking deterministic
              // for mouse users, not just keyboard.
              e.currentTarget.focus();
              o.activate();
            }}
          >
            <span className={styles.charName}>{o.label}</span>
            <span className={styles.charMeta}>{o.meta}</span>
            {o.badge && (
              <Pill id={descId} tone={o.badge.tone} className={styles.charBadge}>
                {o.badge.text}
              </Pill>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Adventure catalog fetch (ADV-9) ──────────────────────────────────────────

type AdventureStatus = 'loading' | 'ok' | 'error';

// ─────────────────────────────────────────────────────────────────────────────

const VISIBILITIES: { id: Visibility; label: string; note: string }[] = [
  { id: 'public', label: 'Public', note: 'Anyone can find and watch. Always SFW.' },
  { id: 'unlisted', label: 'Unlisted', note: 'Only people with the link can join.' },
  { id: 'private', label: 'Private', note: 'Invite only.' },
];

interface RadioOption<T extends string> {
  id: T;
  label: string;
  note: string;
  disabled?: boolean;
}

/**
 * Accessible radiogroup of styled buttons (ST-076). role="radiogroup" + roving
 * tabindex (checked = 0, others = -1) + Arrow-key navigation that moves focus,
 * skipping disabled options — the APG radiogroup contract the previous
 * fieldset-of-buttons lacked.
 */
function RadioGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: RadioOption<T>[];
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (dir: 1 | -1) => {
    const idx = options.findIndex((o) => o.id === value);
    let next = idx;
    for (let i = 0; i < options.length; i += 1) {
      next = (next + dir + options.length) % options.length;
      if (!options[next].disabled) break;
    }
    if (next === idx || options[next].disabled) return;
    onChange(options[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div
      className={styles.choices}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          aria-disabled={o.disabled || undefined}
          disabled={o.disabled}
          tabIndex={value === o.id ? 0 : -1}
          className={`${styles.choice} ${value === o.id ? styles.choiceOn : ''}`}
          onClick={() => !o.disabled && onChange(o.id)}
        >
          <span className={styles.choiceLabel}>{o.label}</span>
          <span className={styles.choiceNote}>{o.note}</span>
        </button>
      ))}
    </div>
  );
}

function StarterForm({
  adventure,
  onCancel,
}: {
  adventure: AdventureCatalogItem;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [name, setName] = useState(adventure.name);
  const [dmMode, setDmMode] = useState<DmMode>('ai');
  // S5.5: AI assist level. Exposed for human-DM sessions (ai+off is locked by engine;
  // the form prevents it by disabling 'off'/'assist' when dmMode==='ai').
  const [aiAssistLevel, setAiAssistLevel] = useState<AiAssistLevel>('full');
  const [visibility, setVisibility] = useState<Visibility>('private');
  // HB-P2: casting model — 'slots' (classic, default) vs 'points' (DMG spell-point
  // variant). Locked at creation; only 'points' is ever sent on the wire.
  const [castingModel, setCastingModel] = useState<'slots' | 'points'>('slots');
  // LVL-1 (FR-1): campaign starting-level floor. String state so the input
  // can hold intermediate/invalid text without clamping silently — an
  // out-of-range value shows the error copy and blocks Begin instead of
  // auto-correcting (consistent with D3's "never a silent mutation" feel).
  // Only a valid value > 1 goes on the wire (settings-blob omit-if-default,
  // same pattern as casting_model above).
  const [startingLevelInput, setStartingLevelInput] = useState('1');
  const startingLevelNum = Number(startingLevelInput.trim());
  const startingLevelValid =
    /^\d+$/.test(startingLevelInput.trim()) &&
    startingLevelNum >= 1 &&
    startingLevelNum <= 20;
  const [rating, setRating] = useState<ContentRating>('sfw');
  const [submitting, setSubmitting] = useState(false);

  // Character binding — fetch on mount and default to the first FREE character so
  // the binding is explicit + visible. With one FREE character the picker is
  // hidden (it's auto-bound); with several — or a lone character that's
  // in_use (Iro CRITICAL-2, no free default to fall back to) — the picker
  // shows so the player can change the selection or release/move their busy
  // character. Without a default, the picker sat on "no character" → nothing
  // was sent → the engine's party/combat fallback silently used the first
  // character, which read as "it bound a character I didn't choose."
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<number | undefined>(undefined);
  // ONE-CHAR-ONE-CAMPAIGN-UX: the in-use character the player just picked,
  // awaiting the release-confirm dialog's outcome. Non-null arms the dialog.
  const [pendingRelease, setPendingRelease] = useState<Character | null>(null);

  useEffect(() => {
    const username = user?.username;
    if (!username) return;
    const ac = new AbortController();
    listMyCharacters(username, ac.signal)
      .then((chars) => {
        setCharacters(chars);
        // Default to the first FREE character (not just chars[0]) — auto-arming
        // a release the player never confirmed would be a silent side effect.
        // `!c.in_use` is also true when `in_use` is undefined (pre-upgrade
        // backend), so this is a no-op change on today's wire shape.
        const firstFree = chars.find((c) => !c.in_use);
        if (firstFree) {
          const parsed = Number(firstFree.character_id);
          if (Number.isFinite(parsed)) setSelectedCharId(parsed);
        }
      })
      .catch(() => setCharacters([]));
    return () => ac.abort();
  }, [user?.username]);

  // Hard rule (client side): mature is only available on unlisted/private. A
  // public table is forced to SFW — protects the Twitch channel (STORY-314).
  const matureAllowed = visibility !== 'public';
  const effectiveRating: ContentRating = matureAllowed ? rating : 'sfw';

  const onVisibilityChange = (v: Visibility) => {
    setVisibility(v);
    if (v === 'public') setRating('sfw');
  };

  const handleBegin = async () => {
    const username = user?.username;
    if (!username || submitting) return;
    // uniqueChannelFromName gives a collision-resistant slug (base + 4-char random suffix)
    // so two players who both name their table "The Hollow Tide Cave" get distinct sessions.
    const channel = uniqueChannelFromName(name);
    setSubmitting(true);

    // Map the StarterForm's dmMode + aiAssistLevel to the engine's axes.
    // 'solo' is legacy shorthand for human+off. The engine normalises ai+off → ai+full,
    // but the form already prevents that combination by locking ai_assist to 'full'
    // when dmMode === 'ai'.
    const engineDmMode: 'ai' | 'human' = dmMode === 'ai' ? 'ai' : 'human';
    const engineAiAssist: AiAssistLevel = dmMode === 'ai' ? 'full' : aiAssistLevel;

    // Miko F3: only set once the release call actually succeeds — used in the
    // catch below to reconcile local state if createSessionFull fails afterward.
    let released = false;
    try {
      // ONE-CHAR-ONE-CAMPAIGN-UX: release a busy character from its current
      // table before moving it here. `picked.in_use` can only be true here
      // for a selectedCharId the player reached via the release-confirm
      // dialog's Confirm action (CharacterPicker never sets selectedCharId to
      // an in-use character directly) — so this is reachable only after an
      // explicit confirm, never silently. If release throws, the catch below
      // shows the failure toast and createSessionFull never runs — the character
      // stays exactly where it was (the design's accepted non-atomic-window
      // safe state), and `submitting` still guards double-submit.
      const picked = characters?.find((c) => Number(c.character_id) === selectedCharId);
      if (picked?.in_use && picked.active_campaign_id) {
        await bindCharacter(picked.active_campaign_id, { username, character_id: null });
        released = true;
      }

      const { session, floor_applied } = await createSessionFull({
        username,
        channel,
        // Verbatim human name from the form (trimmed) — stored as the campaign display
        // name by the engine. The lobby/dashboard/play/recap UIs render this via sessionTitle().
        name: name.trim(),
        dm_mode: engineDmMode,
        ai_assist_level: engineAiAssist,
        visibility,
        content_rating: effectiveRating,
        // ADV-9: pass the adventure's public_id so the engine creates the campaign
        // with adventure_ref stamped. The engine owns the link; no localStorage needed.
        adventure_ref: adventure.public_id,
        // Character binding: include selected character_id when the player has chosen one.
        ...(selectedCharId !== undefined ? { character_id: selectedCharId } : {}),
        // HB-P2: only an explicit 'points' goes on the wire — omitting keeps the
        // engine's slots default and stores nothing on the campaign row.
        ...(castingModel === 'points' ? { casting_model: 'points' as const } : {}),
        // LVL-1: only a raised floor goes on the wire — omitting keeps the
        // engine's level-1 default and stores nothing on the campaign row.
        ...(startingLevelValid && startingLevelNum > 1
          ? { starting_level: startingLevelNum }
          : {}),
      });
      // Persist client-side enrichment as a fallback for pre-upgrade backends.
      const key = session?.session_id ?? channel;
      setSessionAnnotations(key, {
        dm_mode: dmMode,
        content_rating: effectiveRating,
        visibility,
      });
      const successMsg = engineDmMode === 'ai'
        ? `${name} is ready. Suzu will be your DM.`
        : engineAiAssist === 'off'
          ? `${name} is ready. No AI — pure human DM.`
          : `${name} is ready. Suzu assists on request.`;
      toast({
        tone: 'success',
        title: 'Table set',
        message: successMsg,
      });
      // LVL-1 (Aoi gap C, create touchpoint): the bind crossed the table's
      // starting-level floor — say so, with a jump to where the queued
      // choices get resolved. Absent on the common no-floor path.
      if (floor_applied) {
        const n = floor_applied.pending_added;
        toast({
          tone: 'success',
          title: `${floor_applied.name ?? 'Your character'} leveled up!`,
          message: `Auto-leveled to match the table: ${floor_applied.from_level} → ${floor_applied.to_level}.${n > 0 ? ` ${n} choice${n === 1 ? '' : 's'} waiting.` : ''}`,
          action: {
            label: 'Resolve now',
            onClick: () =>
              router.push(`/character/${encodeURIComponent(String(floor_applied.character_id))}`),
          },
        });
      }
      // Land directly in the new session (mirrors dashboard/page.tsx's Resume link).
      // Pre-upgrade backends can return a null session — fall back to /dashboard.
      if (session?.session_id) {
        router.push(`/play/${encodeURIComponent(session.session_id)}`);
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      // Miko F3: release succeeded but createSessionFull failed — the character
      // is now free server-side, but the local list still shows "In {old
      // campaign}". Clear it optimistically so a retry doesn't read as
      // reissuing a release (it would still be harmlessly idempotent, but
      // the stale badge is misleading either way).
      if (released) {
        setCharacters((prev) =>
          prev
            ? prev.map((c) =>
                Number(c.character_id) === selectedCharId
                  ? {
                      ...c,
                      in_use: false,
                      active_campaign_id: null,
                      active_campaign_name: null,
                      active_campaign_status: null,
                    }
                  : c,
              )
            : prev,
        );
      }
      toast({
        tone: 'error',
        // WF-A reconciliation (2026-08-12): curated per-reason copy for
        // msm_disabled / unknown_adventure, generic fallback for everything
        // else — see SESSION_START_REASON_MAP's own doc comment.
        message: engineErrorMessage(err, {
          fallback: 'Could not start the table. Try again in a moment.',
          reasonMap: SESSION_START_REASON_MAP,
        }),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card pop className={styles.form}>
      <div className={styles.formHead}>
        <SuzuDM size={56} glow={false} aria-hidden />
        <div>
          <h2 className={styles.formTitle}>Set the table</h2>
          <p className={styles.formSub}>
            Running <strong>{adventure.name}</strong>. A few choices and we begin.
          </p>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Table name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
        />
      </label>

      <fieldset className={styles.field}>
        <legend className={styles.fieldLabel}>Dungeon Master</legend>
        <RadioGroup
          label="Dungeon Master"
          value={dmMode}
          onChange={(v) => {
            setDmMode(v);
            // When switching to AI mode, lock assist level to 'full' (engine invariant).
            // When switching away from AI, default to 'off' (the solo/manual experience).
            if (v === 'ai') setAiAssistLevel('full');
            else if (aiAssistLevel === 'full') setAiAssistLevel('off');
          }}
          options={[
            { id: 'ai', label: 'Suzu DMs', note: 'full AI narration · memory · dice in the open' },
            { id: 'human', label: 'Human DM', note: 'you drive the scene; AI assist is optional' },
            { id: 'solo', label: 'Solo', note: 'no DM — just you and the engine' },
          ]}
        />
      </fieldset>

      {/* S5.5: AI assist level — shown for human/solo modes only.
          When dmMode==='ai', assist is locked to 'full' (the engine invariant).
          When dmMode==='human', all three levels are available.
          When dmMode==='solo', only 'off' makes sense (shown, but the other options
          are available so an experienced player can run solo with AI commentary). */}
      {dmMode !== 'ai' && (
        <fieldset className={styles.field}>
          <legend className={styles.fieldLabel}>AI narration</legend>
          <RadioGroup
            label="AI narration level"
            value={aiAssistLevel}
            onChange={setAiAssistLevel}
            options={[
              {
                id: 'off' as AiAssistLevel,
                label: 'No AI',
                note: 'pure human/manual — no LLM calls on this table',
              },
              {
                id: 'assist' as AiAssistLevel,
                label: 'AI assist on request',
                note: 'Suzu narrates only when the DM explicitly asks',
              },
              {
                id: 'full' as AiAssistLevel,
                label: 'Full AI DM',
                note: 'Suzu narrates automatically on every beat',
                disabled: dmMode === 'solo',
              },
            ]}
          />
          {aiAssistLevel === 'off' && (
            <p className={styles.interlock}>
              <Icon name="Shield" size={12} aria-hidden /> No LLM calls — the engine runs
              deterministically. The server enforces this even if the client changes.
            </p>
          )}
        </fieldset>
      )}
      {dmMode === 'ai' && (
        <p className={styles.interlock} style={{ marginTop: 0 }}>
          <Icon name="Shield" size={12} aria-hidden /> Suzu DMs mode requires full AI narration.
        </p>
      )}

      <fieldset className={styles.field}>
        <legend className={styles.fieldLabel}>Who can see it</legend>
        <RadioGroup
          label="Who can see it"
          value={visibility}
          onChange={onVisibilityChange}
          options={VISIBILITIES}
        />
      </fieldset>

      <fieldset className={styles.field}>
        <legend className={styles.fieldLabel}>Spellcasting</legend>
        <RadioGroup
          label="Spellcasting"
          value={castingModel}
          onChange={setCastingModel}
          options={[
            { id: 'slots', label: 'Spell slots', note: 'classic 5e · default' },
            {
              id: 'points',
              label: 'Spell points',
              note: 'one pool, cast big or small · warlocks keep slots',
            },
          ]}
        />
      </fieldset>

      {/* LVL-1 (Aoi touchpoint 1): starting-level floor. A bounded number
          input, deliberately NOT a RadioGroup — twenty chip options for a
          scalar 1-20 is a scroll-wall; the settings-blob/omit-if-default
          WIRE pattern still mirrors casting_model exactly (Aoi §2's stated
          deviation). Inline validation on every keystroke, no silent clamp.
          Kage m1: label/span wrapper (the "Table name" pattern above), not a
          fieldset — a legend names a GROUP, leaving a lone control unnamed. */}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Starting level</span>
        <input
          className={`input ${styles.floorInput}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          step={1}
          value={startingLevelInput}
          aria-describedby="starting-level-hint"
          aria-invalid={!startingLevelValid}
          disabled={submitting}
          onChange={(e) => setStartingLevelInput(e.target.value)}
        />
      </label>
      <p
        id="starting-level-hint"
        className={`${styles.interlock} ${!startingLevelValid ? styles.hintInvalid : ''}`}
      >
        {!startingLevelValid
          ? 'Enter a level from 1 to 20.'
          : startingLevelNum > 1
            ? `Characters below level ${startingLevelNum} are auto-leveled to ${startingLevelNum} the moment they join — any subclass or Ability Score Improvement picks along the way are still theirs to make.`
            : 'Everyone starts at level 1 — the classic climb.'}
      </p>

      <fieldset className={styles.field}>
        <legend className={styles.fieldLabel}>Content rating</legend>
        <RadioGroup
          label="Content rating"
          value={effectiveRating}
          onChange={setRating}
          options={[
            { id: 'sfw', label: 'Safe for stream', note: 'default · always allowed' },
            {
              id: 'mature',
              label: 'Mature',
              note: 'private / unlisted only',
              disabled: !matureAllowed,
            },
          ]}
        />
        {!matureAllowed && (
          <p className={styles.interlock}>
            <Icon name="Shield" size={12} aria-hidden /> Public tables are always
            safe-for-stream — it protects the channel.
          </p>
        )}
      </fieldset>

      {/* Character binding — shown only once character list loads.
          ONE-CHAR-ONE-CAMPAIGN-UX: cards with in-use state badges replace the
          old plain <select> (Sora-Arch design §4b) — a native <select> option
          can't carry a tone-coded badge or arm a confirm dialog on pick.
          Iro CRITICAL-2: a lone character still gets a picker (+ badge +
          release dialog) when it's in_use — otherwise a player whose ONLY
          character is busy gets no card and no way to release/move it, which
          silently falls through to an unexplained DM-only table. A lone FREE
          character keeps today's silent auto-bind (no picker needed). */}
      {characters !== null &&
        (characters.length > 1 || (characters.length === 1 && characters[0].in_use === true)) && (
          <fieldset className={styles.field}>
            <legend id="char-picker-legend" className={styles.fieldLabel}>
              Your character
            </legend>
            <CharacterPicker
              characters={characters}
              selectedCharId={selectedCharId}
              onPickFree={setSelectedCharId}
              onPickInUse={setPendingRelease}
              labelledBy="char-picker-legend"
            />
          </fieldset>
        )}

      <ConfirmDialog
        open={pendingRelease !== null}
        role="alertdialog"
        title={`Release ${pendingRelease?.name ?? 'this character'}?`}
        body={
          pendingRelease && (
            <>
              <strong>{pendingRelease.name}</strong> is currently in{' '}
              <strong>{pendingRelease.active_campaign_name ?? 'another table'}</strong>. Release it
              and bring it to this table? Its old table keeps its story but will have no character
              until you re-add one.
            </>
          )
        }
        confirmLabel="Release & bring here"
        cancelLabel="Cancel"
        onCancel={() => setPendingRelease(null)}
        onConfirm={() => {
          if (pendingRelease) {
            const charId = Number(pendingRelease.character_id);
            if (Number.isFinite(charId)) setSelectedCharId(charId);
          }
          setPendingRelease(null);
        }}
      />

      <div className={styles.formFoot}>
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Back
        </Button>
        <Button
          variant="primary"
          onClick={() => void handleBegin()}
          disabled={submitting || name.trim().length === 0 || !startingLevelValid}
          leadingIcon={<Icon name="D20" size={14} aria-hidden />}
        >
          {submitting ? 'Setting the table…' : 'Begin'}
        </Button>
      </div>
    </Card>
  );
}

function ModulesPageInner() {
  const [selected, setSelected] = useState<AdventureCatalogItem | null>(null);
  const [adventures, setAdventures] = useState<AdventureCatalogItem[]>([]);
  const [series, setSeries] = useState<SeriesCatalogItem[]>([]);
  const [status, setStatus] = useState<AdventureStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const retryRef = useRef<HTMLButtonElement>(null);
  // T4p1: a series-detail part row deep-links here as
  // /modules?adventure=<public_id> so "run this part" reuses the exact same
  // StarterForm/createSessionFull flow every other catalog card uses — no
  // second session-start implementation. Only fires the FIRST time it can
  // match (guarded below) so clearing the selection (Back) doesn't re-select.
  const searchParams = useSearchParams();
  const deepLinkAdventureRef = searchParams.get('adventure');
  const [deepLinkConsumed, setDeepLinkConsumed] = useState(false);

  // Iro MAJOR-1: retry guard — ignore taps when not in error state to prevent
  // two concurrent fetches from rapid double-tap before the 'loading' re-render commits.
  const retry = useCallback(() => {
    if (status !== 'error') return;
    setAttempt((n) => n + 1);
  }, [status]);

  useEffect(() => {
    if (!deepLinkAdventureRef || deepLinkConsumed || status !== 'ok') return;
    const match = adventures.find((a) => a.public_id === deepLinkAdventureRef);
    if (match) {
      // Deriving selection from async-loaded catalog data (adventures/status
      // come from the separate fetch effect above) — there's no render-time
      // equivalent, matching the fetch-on-mount pattern's own justification.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(match);
      setDeepLinkConsumed(true);
    }
  }, [deepLinkAdventureRef, deepLinkConsumed, status, adventures]);

  useEffect(() => {
    const ac = new AbortController();
    // Canonical fetch-on-mount pattern (React docs "Fetching data" example).
    // There's no external store to subscribe to here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading');
    getCatalog('dnd5e', { type: 'adventure' }, ac.signal)
      .then((res) => {
        if (ac.signal.aborted) return;
        setAdventures(
          res.items
            .map(toCatalogItem)
            // D2 (design doc): editorial-chunk rows (spine-splice inputs, e.g.
            // Act-I chunks) are peers in the catalog but not standalone-
            // playable modules — keep them out of the browsable grid without
            // retiring them (they still need to exist for playtesting).
            .filter((a) => a.summary.editorial_role !== 'spine_chunk'),
        );
        setStatus('ok');
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setAdventures([]);
        setStatus('error');
      });
    // Series is a browse ENHANCEMENT, not the page's core data — an older
    // engine build, SUZU_DND_SERIES off, or a network hiccup here degrades to
    // "no series shown" rather than failing the whole page (ADV-9's existing
    // graceful-degrade posture, extended to the new content_type).
    getCatalog('dnd5e', { type: 'series' }, ac.signal)
      .then((res) => {
        if (ac.signal.aborted) return;
        setSeries(
          res.items
            .map(toSeriesCatalogItem)
            .filter((s): s is SeriesCatalogItem => s !== null),
        );
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setSeries([]);
      });
    return () => ac.abort();
  }, [attempt]);

  // Focus the retry button when the error state is entered (a11y — matches
  // the wizard pattern from character creation, Iro S2.4 MAJOR-1).
  useEffect(() => {
    if (status === 'error') retryRef.current?.focus();
  }, [status]);

  // UIR2-TAV-3: this page previously had NO auth gate at all — it rendered
  // <TavernShell> unconditionally, so TavernShell's own useAuth() call could
  // see a null user (resolving, or a failed silent refresh) and UserMenu's
  // `?? 'Adventurer'` fallback would surface as if it were a real identity.
  const gate = useAuthGate({
    skeleton: <PageSkeleton variant="card" lines={4} />,
    label: 'Loading adventures',
  });
  if (gate) return gate;

  return (
    <TavernShell active="modules" title="Start a campaign">
      <div className={styles.tabs} role="tablist" aria-label="Module source">
        {/* Roving tabindex: the active tab is Tab-reachable (0); the disabled
            "soon" previews sit at -1 so the tablist is keyboard-discoverable
            without trapping Tab on placeholders (Iro/Tora S3.4). */}
        <span
          className={`${styles.tab} ${styles.tabOn}`}
          role="tab"
          aria-selected="true"
          tabIndex={0}
        >
          Official one-shots
        </span>
        <span
          className={styles.tab}
          role="tab"
          aria-selected="false"
          aria-disabled="true"
          tabIndex={-1}
          title="Coming soon"
        >
          Suzu&rsquo;s library <span className={styles.soon}>soon</span>
        </span>
        <span
          className={styles.tab}
          role="tab"
          aria-selected="false"
          aria-disabled="true"
          tabIndex={-1}
          title="Coming soon"
        >
          Your homebrew <span className={styles.soon}>soon</span>
        </span>
      </div>

      {selected ? (
        <StarterForm adventure={selected} onCancel={() => setSelected(null)} />
      ) : (
        /* Iro MAJOR-1: persistent live-region so screen readers hear "content
           loaded" when the skeleton swaps to the grid. aria-busy mirrors the
           loading flag; aria-atomic="false" means only the changed subtree is
           announced, not the whole region on every paint. The error card keeps
           its own role="alert" — assertive beats polite, so errors still fire
           immediately regardless of the live-region's polite setting. */
        <div aria-live="polite" aria-busy={status === 'loading'} aria-atomic="false">
          {/* Loading state */}
          {status === 'loading' && (
            <PageSkeleton variant="card" lines={4} />
          )}

          {/* Error state */}
          {status === 'error' && (
            <Card
              className={styles.catalogError}
              role="alert"
              aria-labelledby="modules-error-title"
            >
              <p id="modules-error-title" className={styles.catalogErrorTitle}>
                Suzu can&rsquo;t reach the adventure catalog right now.
              </p>
              <p id="modules-error-body" className={styles.catalogErrorBody}>
                The module list couldn&rsquo;t be loaded. Check your connection or try again in a moment.
              </p>
              <Button
                ref={retryRef}
                variant="primary"
                size="lg"
                onClick={retry}
                aria-describedby="modules-error-body"
              >
                Try again
              </Button>
            </Card>
          )}

          {/* Empty state (loaded but no adventures OR series in catalog) */}
          {status === 'ok' && adventures.length === 0 && series.length === 0 && (
            <Card className={styles.catalogError} role="status" aria-labelledby="modules-empty-title">
              <p id="modules-empty-title" className={styles.catalogErrorTitle}>
                No modules available yet.
              </p>
              <p className={styles.catalogErrorBody}>
                Check back soon — adventures will appear here once the catalog is seeded.
              </p>
            </Card>
          )}

          {/* T4p1 IA fix: series and one-shots are TWO SEPARATE grids, not one
              mixed grid with a `span 2` series card wedged among span-1
              cards. A single grid's auto-placement can't guarantee a
              one-shot card never lands in a series row — it only happened
              to look right at exactly 2 series cards. Splitting the section
              entirely removes the mechanism that could break, at any N. */}
          {status === 'ok' && series.length > 0 && (
            <section aria-labelledby="series-section-heading" className={styles.section}>
              <h2 id="series-section-heading" className={styles.sectionHeading}>
                Series
              </h2>
              <ul className={styles.seriesGrid} aria-label="Campaign series">
                {series.map((s) => (
                  <Card key={s.public_id} as="li" pop className={styles.seriesCard}>
                    <SeriesCoverArt cover={s.summary.cover} size={96} className={styles.seriesCoverArt} />
                    <div className={styles.seriesBody}>
                      <div className={styles.seriesLabel}>
                        <Pill tone="lav">
                          Series &middot; {formatMemberCount(s.summary.member_count)}
                        </Pill>
                        {s.summary.level_range && (
                          <Pill tone="muted">{formatLevelRange(s.summary.level_range)}</Pill>
                        )}
                      </div>
                      <h3 className={styles.seriesTitle}>{s.name}</h3>
                      {s.summary.subtitle && (
                        <p className={styles.seriesBlurb}>{s.summary.subtitle}</p>
                      )}
                      <div className={styles.seriesFoot}>
                        <Button
                          variant="primary"
                          href={`/modules/series/${encodeURIComponent(s.slug || s.public_id)}`}
                          aria-label={`View series — ${s.name}`}
                        >
                          View series
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </ul>
            </section>
          )}

          {/* Adventure grid (one-shots) */}
          {status === 'ok' && adventures.length > 0 && (
            <section aria-labelledby={series.length > 0 ? 'oneshots-section-heading' : undefined} className={styles.section}>
              {series.length > 0 && (
                <h2 id="oneshots-section-heading" className={styles.sectionHeading}>
                  One-shots
                </h2>
              )}
              <ul className={styles.grid} aria-label="Adventures">
                {adventures.map((adv) => (
                  <Card key={adv.public_id} as="li" className={styles.module}>
                    <span className={styles.moduleIcon} aria-hidden>
                      <Icon name="Map" size={26} />
                    </span>
                    <div className={styles.moduleHead}>
                      <div className={styles.modulePills}>
                        {adv.summary.level_range && (
                          <Pill tone="lav">{formatLevelRange(adv.summary.level_range)}</Pill>
                        )}
                        {adv.summary.length && (
                          <Pill tone="muted">{formatLength(adv.summary.length)}</Pill>
                        )}
                        {adv.summary.series && (
                          <Pill tone="warm">{adv.summary.series.title}</Pill>
                        )}
                      </div>
                      <h2 className={styles.moduleTitle}>{adv.name}</h2>
                      {adv.summary.subtitle && (
                        <p className={styles.moduleBlurb}>{adv.summary.subtitle}</p>
                      )}
                    </div>
                    <div className={styles.moduleFoot}>
                      {/* Iro MAJOR-2: aria-label gives each "Run this" button a unique
                          accessible name across cards. Visible text "Run this" is a
                          substring of the label — Label-in-Name / voice-control safe. */}
                      <Button
                        variant="primary"
                        onClick={() => setSelected(adv)}
                        leadingIcon={<Icon name="D20" size={14} aria-hidden />}
                        aria-label={`Run this — ${adv.name}`}
                      >
                        Run this
                      </Button>
                    </div>
                  </Card>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </TavernShell>
  );
}

// ── Default export — Suspense wrapper for useSearchParams ─────────────────────
/**
 * useSearchParams() requires a Suspense boundary (mirrors src/app/login/page.tsx's
 * wrapper — same reasoning: enables streaming/static prerender without bailing
 * to a full client render). The fallback matches the page's existing loading
 * skeleton so a deep link (?adventure=…) never flashes unstyled content.
 */
export default function ModulesPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="card" lines={4} />}>
      <ModulesPageInner />
    </Suspense>
  );
}

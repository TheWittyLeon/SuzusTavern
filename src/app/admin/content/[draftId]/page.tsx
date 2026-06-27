'use client';
/**
 * /admin/content/[draftId] — Side-by-Side Draft Review (S8.3)
 *
 * Loads a single content draft and presents a two-pane layout:
 *   - Source pane (left/top): read-only extracted PDF text + provenance metadata.
 *   - Fields pane (right/bottom): editable form with per-content-type fields.
 *
 * Actions: Approve (→ live), Reject (→ rejected, requires reason), Save edits.
 *
 * Z-index contract: <RejectDialog> is rendered at the PAGE level, above the
 * splitLayout scroll containers, so its position:fixed backdrop is never clipped
 * by an overflow:auto ancestor. See Aoi-UI spec §RejectDialog for the trap.
 *
 * S8.3 — Gated Content Pipeline: Tavern admin review screen.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useRouter, useParams } from 'next/navigation';
import TavernShell from '@/components/TavernShell';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import PageSkeleton from '@/components/PageSkeleton';
import RejectDialog from '@/components/RejectDialog';
import { ToastProvider, useToast } from '@/components/Toast';
import { useAuth } from '@/lib/auth/AuthProvider';
import {
  getDraft,
  saveDraft,
  approveDraft,
  rejectDraft,
  type ContentDraft,
} from '@/lib/api/adminContent';
import { formatStarted } from '@/lib/format';
import type { PillTone } from '@/components/Pill';
import styles from './ReviewScreen.module.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function contentTypePillTone(contentType: string): PillTone {
  switch (contentType) {
    case 'weapon':   return 'warn';
    case 'perk':     return 'cool';
    case 'creature': return 'bad';
    default:         return 'muted';
  }
}

// ── SPECIAL grid component ────────────────────────────────────────────────────

const SPECIAL_STATS = ['S', 'P', 'E', 'C', 'I', 'A', 'L'] as const;
const SPECIAL_KEYS: Record<typeof SPECIAL_STATS[number], string> = {
  S: 'strength', P: 'perception', E: 'endurance',
  C: 'charisma', I: 'intelligence', A: 'agility', L: 'luck',
};

interface SpecialGridProps {
  values: Record<string, number>;
  onChange: (key: string, value: number) => void;
  max?: number;
  hint?: string;
  prefix?: string;
}

function SpecialGrid({ values, onChange, max = 10, hint, prefix = 'special' }: SpecialGridProps) {
  return (
    <div className={styles.specialGrid}>
      {SPECIAL_STATS.map((abbr) => {
        const key = SPECIAL_KEYS[abbr];
        const id = `${prefix}-${key}`;
        return (
          <div key={abbr} className={styles.specialCell}>
            <label htmlFor={id} className="label">{abbr}</label>
            <input
              id={id}
              type="number"
              min={0}
              max={max}
              className="input"
              value={values[key] ?? 0}
              onChange={(e) => onChange(key, Number(e.target.value))}
              aria-describedby={hint ? `${prefix}-hint` : undefined}
            />
          </div>
        );
      })}
      {hint && <p id={`${prefix}-hint`} className={styles.fieldHint}>{hint}</p>}
    </div>
  );
}

// ── Per-content-type field editors ────────────────────────────────────────────

interface DataFieldsForTypeProps {
  contentType: string;
  data: Record<string, unknown>;
  onChange: (newData: Record<string, unknown>) => void;
}

// ── Weapon fields ─────────────────────────────────────────────────────────────

function WeaponFields({ data, onChange }: Omit<DataFieldsForTypeProps, 'contentType'>) {
  type DamageEntry = { amount: number; type: string; location_hint?: string };
  const damages = (data.damage as DamageEntry[] | undefined) ?? [];
  const skill = (data.skill as string | undefined) ?? '';
  const qualitiesArr = (data.qualities as string[] | undefined) ?? [];
  const qualitiesText = qualitiesArr.join('\n');

  const setDamages = (updated: DamageEntry[]) =>
    onChange({ ...data, damage: updated });
  const setSkill = (v: string) => onChange({ ...data, skill: v });
  const setQualities = (text: string) =>
    onChange({
      ...data,
      qualities: text.split('\n').map((l) => l.trim()).filter(Boolean),
    });

  const updateDamage = (i: number, patch: Partial<DamageEntry>) => {
    const next = damages.map((d, idx) => (idx === i ? { ...d, ...patch } : d));
    setDamages(next);
  };
  const addDamage = () => {
    if (damages.length >= 3) return;
    setDamages([...damages, { amount: 0, type: '' }]);
  };

  return (
    <div className={styles.fieldsSection}>
      <div className={styles.fieldGroup}>
        <p className="label">Damage entries</p>
        {damages.map((entry, i) => (
          <div key={i} className={styles.damageRow}>
            <div className={styles.fieldGroup}>
              <label htmlFor={`dmg-amount-${i}`} className="label">
                Damage amount (entry {i + 1})
              </label>
              <input
                id={`dmg-amount-${i}`}
                type="number"
                min={0}
                className="input"
                value={entry.amount}
                onChange={(e) => updateDamage(i, { amount: Number(e.target.value) })}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label htmlFor={`dmg-type-${i}`} className="label">
                Damage type (entry {i + 1})
              </label>
              <input
                id={`dmg-type-${i}`}
                type="text"
                className="input"
                placeholder="energy / physical / radiation"
                value={entry.type}
                onChange={(e) => updateDamage(i, { type: e.target.value })}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label htmlFor={`dmg-loc-${i}`} className="label">Location hint (optional)</label>
              <input
                id={`dmg-loc-${i}`}
                type="text"
                className="input"
                placeholder="e.g. head"
                value={entry.location_hint ?? ''}
                onChange={(e) => updateDamage(i, { location_hint: e.target.value || undefined })}
              />
            </div>
          </div>
        ))}
        <Button
          variant="ghost"
          onClick={addDamage}
          disabled={damages.length >= 3}
          aria-label="Add damage entry"
        >
          Add damage entry
        </Button>
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor="weapon-skill" className="label">Skill</label>
        <input
          id="weapon-skill"
          type="text"
          className="input"
          value={skill}
          onChange={(e) => setSkill(e.target.value)}
          aria-describedby="weapon-skill-hint"
        />
        <p id="weapon-skill-hint" className={styles.fieldHint}>
          The Fallout skill used for this weapon attack (e.g. Guns, Melee)
        </p>
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor="weapon-qualities" className="label">Qualities</label>
        <textarea
          id="weapon-qualities"
          className="input"
          rows={3}
          value={qualitiesText}
          onChange={(e) => setQualities(e.target.value)}
          aria-describedby="weapon-qualities-hint"
        />
        <p id="weapon-qualities-hint" className={styles.fieldHint}>
          One quality per line (e.g. &quot;Vicious 2&quot;, &quot;Piercing 1&quot;, &quot;Blast&quot;). Compare to the snippet.
        </p>
      </div>
    </div>
  );
}

// ── Perk fields ───────────────────────────────────────────────────────────────

function PerkFields({ data, onChange }: Omit<DataFieldsForTypeProps, 'contentType'>) {
  type PerkReqs = { special: Record<string, number>; level: number };
  const ranks = (data.ranks as number | undefined) ?? 1;
  const requirements = (data.requirements as PerkReqs | undefined) ?? { special: {}, level: 1 };
  const effect = (data.effect as string | undefined) ?? '';

  const setRanks = (v: number) => onChange({ ...data, ranks: v });
  const setLevel = (v: number) =>
    onChange({ ...data, requirements: { ...requirements, level: v } });
  const setSpecial = (key: string, value: number) =>
    onChange({
      ...data,
      requirements: { ...requirements, special: { ...requirements.special, [key]: value } },
    });
  const setEffect = (v: string) => onChange({ ...data, effect: v });

  return (
    <div className={styles.fieldsSection}>
      <div className={styles.fieldRow}>
        <div className={styles.fieldGroup}>
          <label htmlFor="perk-ranks" className="label">Ranks</label>
          <input
            id="perk-ranks"
            type="number"
            min={1}
            max={10}
            className="input"
            value={ranks}
            onChange={(e) => setRanks(Number(e.target.value))}
            aria-describedby="perk-ranks-hint"
          />
          <p id="perk-ranks-hint" className={styles.fieldHint}>
            Number of times this perk can be taken
          </p>
        </div>
        <div className={styles.fieldGroup}>
          <label htmlFor="perk-level" className="label">Required level</label>
          <input
            id="perk-level"
            type="number"
            min={1}
            className="input"
            value={requirements.level}
            onChange={(e) => setLevel(Number(e.target.value))}
          />
        </div>
      </div>

      <div className={styles.fieldGroup}>
        <p className="label">SPECIAL requirements</p>
        <SpecialGrid
          values={requirements.special}
          onChange={setSpecial}
          hint="Minimum SPECIAL stat required (0 = no requirement)"
          prefix="perk-special"
        />
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor="perk-effect" className="label">Effect</label>
        <textarea
          id="perk-effect"
          className="input"
          rows={5}
          value={effect}
          onChange={(e) => setEffect(e.target.value)}
          aria-describedby="perk-effect-hint"
        />
        <p id="perk-effect-hint" className={styles.fieldHint}>
          The full mechanical description of this perk. Match the snippet text.
        </p>
      </div>
    </div>
  );
}

// ── Creature fields ───────────────────────────────────────────────────────────

function CreatureFields({ data, onChange }: Omit<DataFieldsForTypeProps, 'contentType'>) {
  type Attack = { weapon_ref: string; [k: string]: unknown };
  const special = (data.special as Record<string, number> | undefined) ?? {};
  const hp = (data.hp as { max: number } | undefined) ?? { max: 0 };
  const skillsObj = (data.skills as Record<string, number> | undefined) ?? {};
  const skillsText = Object.entries(skillsObj)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const attacks = (data.attacks as Attack[] | undefined) ?? [];

  const setSpecial = (key: string, value: number) =>
    onChange({ ...data, special: { ...special, [key]: value } });
  const setHp = (v: number) => onChange({ ...data, hp: { max: v } });
  const setSkills = (text: string) => {
    const obj: Record<string, number> = {};
    text.split('\n').forEach((line) => {
      const m = line.match(/^([^:]+):\s*(\d+)$/);
      if (m) obj[m[1].trim()] = Number(m[2]);
    });
    onChange({ ...data, skills: obj });
  };
  const setAttackRef = (i: number, ref: string) => {
    const next = attacks.map((a, idx) => (idx === i ? { ...a, weapon_ref: ref } : a));
    onChange({ ...data, attacks: next });
  };
  const addAttack = () => {
    if (attacks.length >= 5) return;
    onChange({ ...data, attacks: [...attacks, { weapon_ref: '' }] });
  };

  return (
    <div className={styles.fieldsSection}>
      <div className={styles.fieldGroup}>
        <p className="label">SPECIAL stats</p>
        <SpecialGrid
          values={special}
          onChange={setSpecial}
          max={15}
          prefix="creature-special"
        />
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor="creature-hp" className="label">HP (max)</label>
        <input
          id="creature-hp"
          type="number"
          min={0}
          className="input"
          value={hp.max}
          onChange={(e) => setHp(Number(e.target.value))}
        />
      </div>

      <div className={styles.fieldGroup}>
        <label htmlFor="creature-skills" className="label">Skills</label>
        <textarea
          id="creature-skills"
          className="input"
          rows={4}
          value={skillsText}
          onChange={(e) => setSkills(e.target.value)}
          aria-describedby="creature-skills-hint"
        />
        <p id="creature-skills-hint" className={styles.fieldHint}>
          e.g. &quot;Athletics: 3&quot;, &quot;Stealth: 4&quot;. One per line.
        </p>
      </div>

      <div className={styles.fieldGroup}>
        <p className="label">Attacks</p>
        {attacks.map((attack, i) => (
          <div key={i} className={styles.fieldGroup}>
            <label htmlFor={`attack-ref-${i}`} className="label">
              Weapon ref (attack {i + 1})
            </label>
            <input
              id={`attack-ref-${i}`}
              type="text"
              className="input"
              placeholder="e.g. laser-rifle"
              value={attack.weapon_ref}
              onChange={(e) => setAttackRef(i, e.target.value)}
            />
          </div>
        ))}
        <Button
          variant="ghost"
          onClick={addAttack}
          disabled={attacks.length >= 5}
          aria-label="Add attack entry"
        >
          Add attack
        </Button>
        <p className={styles.fieldHint}>
          Slugs of weapons in the catalog, or free text for unnamed attacks
        </p>
      </div>
    </div>
  );
}

// ── Fallback (unsupported content type) ──────────────────────────────────────

function FallbackFields({ data }: { data: Record<string, unknown> }) {
  return (
    <div className={styles.rawDataFallback}>
      <p className="label">Raw data (read-only — content type not yet supported for editing)</p>
      <pre className={styles.snippet}>{JSON.stringify(data, null, 2)}</pre>
      <p className={styles.fieldHint} style={{ color: 'var(--warn)' }}>
        This content type does not have structured editing yet. Approve or reject
        based on the raw data shown.
      </p>
    </div>
  );
}

// ── DataFieldsForType switcher ────────────────────────────────────────────────

function DataFieldsForType({ contentType, data, onChange }: DataFieldsForTypeProps) {
  switch (contentType) {
    case 'weapon':   return <WeaponFields data={data} onChange={onChange} />;
    case 'perk':     return <PerkFields data={data} onChange={onChange} />;
    case 'creature': return <CreatureFields data={data} onChange={onChange} />;
    default:         return <FallbackFields data={data} />;
  }
}

// ── Source provenance panel ───────────────────────────────────────────────────

function SourceProvenancePanel({ draft }: { draft: ContentDraft }) {
  const snippetLabelId = useId();

  return (
    <section aria-labelledby="source-heading" className={styles.sourcePane}>
      <h2 id="source-heading" className={styles.paneHeading}>
        Source — Page {draft.source.page}
      </h2>
      <div className={styles.provenanceMeta}>
        <span className="label">Document</span>
        <span className="mono">{draft.source.key}</span>
        <span className="label">Pack</span>
        <span>{draft.pack_id}</span>
        <span className="label">Type</span>
        <Pill tone={contentTypePillTone(draft.content_type)}>{draft.content_type}</Pill>
        {draft.previous_content_id != null && (
          <Pill tone="warm">re-version of live #{draft.previous_content_id}</Pill>
        )}
      </div>

      <div className={styles.snippetShell} role="region" aria-label="Extracted source snippet">
        <span className="label" id={snippetLabelId}>Extracted snippet</span>
        <pre
          className={styles.snippet}
          aria-labelledby={snippetLabelId}
          /* tabIndex={0} makes it focusable so keyboard users can scroll it */
          tabIndex={0}
        >
          {draft.source.snippet}
        </pre>
      </div>
    </section>
  );
}

// ── Draft fields editor ───────────────────────────────────────────────────────

type ActionKind = 'save' | 'approve' | 'reject';

interface DraftFieldsEditorProps {
  draft: ContentDraft;
  isBusy: boolean;
  currentAction: ActionKind | null;
  actionError: string | null;
  onSave: (name: string, data: Record<string, unknown>) => void;
  onApprove: () => void;
  onRejectOpen: () => void;
  onClearError: () => void;
}

function DraftFieldsEditor({
  draft,
  isBusy,
  currentAction,
  actionError,
  onSave,
  onApprove,
  onRejectOpen,
  onClearError,
}: DraftFieldsEditorProps) {
  const [localName, setLocalName] = useState(draft.name);
  const [localData, setLocalData] = useState<Record<string, unknown>>(draft.data);
  const [isDirty, setIsDirty] = useState(false);

  // Reset local state when a new draft loads (e.g. after a save re-fetch)
  useEffect(() => {
    setLocalName(draft.name);
    setLocalData(draft.data);
    setIsDirty(false);
  }, [draft.draft_id, draft.name, draft.data]);

  const handleNameChange = (v: string) => {
    setLocalName(v);
    setIsDirty(true);
  };

  const handleDataChange = (newData: Record<string, unknown>) => {
    setLocalData(newData);
    setIsDirty(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirty || isBusy) return;
    onSave(localName, localData);
  };

  return (
    <section aria-labelledby="fields-heading" className={styles.fieldsPane}>
      <div className={styles.fieldsHeader}>
        <h2 id="fields-heading" className={styles.paneHeading}>Draft fields</h2>
        <div className={styles.fieldsMeta}>
          <span className="label">ID</span>
          <span className="mono">{draft.draft_id}</span>
          <span className="label">Slug</span>
          <span className="mono">{draft.slug}</span>
          <span className="label">Updated</span>
          <span>{formatStarted(draft.updated_at)}</span>
        </div>
      </div>

      <form
        className={styles.fieldsForm}
        onSubmit={handleSave}
        aria-label="Edit draft fields"
        noValidate
      >
        {/* Name field — always present regardless of content type */}
        <div className={styles.fieldGroup}>
          <label htmlFor="field-name" className="label">Name</label>
          <input
            id="field-name"
            className="input"
            type="text"
            value={localName}
            onChange={(e) => handleNameChange(e.target.value)}
            required
            aria-required="true"
            aria-describedby="field-name-hint"
          />
          <p id="field-name-hint" className={styles.fieldHint}>
            Display name for this item (compare to the snippet on the left)
          </p>
        </div>

        {/* Per-content-type data fields */}
        <DataFieldsForType
          contentType={draft.content_type}
          data={localData}
          onChange={handleDataChange}
        />

        {/* Action buttons */}
        <div className={styles.formActions} role="group" aria-label="Draft actions">
          <Button
            type="submit"
            variant="ghost"
            disabled={!isDirty || isBusy}
            aria-busy={isBusy && currentAction === 'save' ? 'true' : undefined}
          >
            {isBusy && currentAction === 'save' ? 'Saving…' : 'Save edits'}
          </Button>
          <Button
            variant="primary"
            disabled={isBusy}
            aria-busy={isBusy && currentAction === 'approve' ? 'true' : undefined}
            onClick={onApprove}
            type="button"
          >
            {isBusy && currentAction === 'approve' ? 'Approving…' : 'Approve'}
          </Button>
          <Button
            variant="danger"
            disabled={isBusy}
            onClick={onRejectOpen}
            type="button"
          >
            Reject
          </Button>
        </div>
      </form>

      {/* Inline action error — stays persistent until dismissed */}
      {actionError && (
        <div role="alert" className={styles.actionError}>
          <span style={{ color: 'var(--bad-ink)' }}>{actionError}</span>
          <Button variant="ghost" onClick={onClearError} aria-label="Dismiss error">
            Dismiss
          </Button>
        </div>
      )}
    </section>
  );
}

// ── Main review page (inner, inside ToastProvider) ────────────────────────────

type ReviewPageState =
  | { status: 'loading' }
  | { status: 'success'; draft: ContentDraft }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

function ReviewPageInner() {
  const router = useRouter();
  const params = useParams();
  const draftId = Number(params?.draftId);
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [pageState, setPageState] = useState<ReviewPageState>({ status: 'loading' });
  const [isBusy, setIsBusy] = useState(false);
  const [currentAction, setCurrentAction] = useState<ActionKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Auth gate
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!user.roles?.includes('admin')) { router.replace('/dashboard'); return; }
  }, [user, authLoading, router]);

  // Load draft
  useEffect(() => {
    if (!user?.roles?.includes('admin') || !draftId) return;

    setPageState({ status: 'loading' });
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    getDraft(draftId, user.username, controller.signal)
      .then((draft) => {
        setPageState({ status: 'success', draft });
      })
      .catch((err: { status?: number; name?: string; message?: string }) => {
        if (err?.name === 'AbortError') return;
        if (err?.status === 404) {
          setPageState({ status: 'not_found' });
        } else {
          setPageState({ status: 'error', message: 'Could not load this draft. Try again.' });
        }
      });

    return () => controller.abort();
  }, [user, draftId, retryKey]);

  const reload = useCallback(() => setRetryKey((k) => k + 1), []);

  const handleSave = useCallback(async (name: string, data: Record<string, unknown>) => {
    if (!user || pageState.status !== 'success') return;
    setIsBusy(true);
    setCurrentAction('save');
    setActionError(null);
    try {
      const result = await saveDraft(draftId, { name, data }, user.username);
      toast({
        tone: 'success',
        message: `Changes saved (version ${result.version})`,
        duration: 4000,
      });
      // Re-fetch to get updated_at + version
      reload();
    } catch {
      setActionError('Failed to save changes. Please try again.');
    } finally {
      setIsBusy(false);
      setCurrentAction(null);
    }
  }, [user, pageState, draftId, toast, reload]);

  const handleApprove = useCallback(async () => {
    if (!user || pageState.status !== 'success') return;
    setIsBusy(true);
    setCurrentAction('approve');
    setActionError(null);
    try {
      await approveDraft(draftId, user.username);
      toast({
        tone: 'success',
        message: 'Approved — item is now live',
        duration: 5000,
      });
      router.push('/admin/content');
    } catch {
      setActionError('Failed to approve this draft. Please try again.');
    } finally {
      setIsBusy(false);
      setCurrentAction(null);
    }
  }, [user, pageState, draftId, toast, router]);

  const handleRejectConfirm = useCallback(async (reason: string) => {
    if (!user || pageState.status !== 'success') return;
    setIsBusy(true);
    setCurrentAction('reject');
    setActionError(null);
    try {
      await rejectDraft(draftId, user.username, reason);
      setRejectDialogOpen(false);
      toast({
        tone: 'info',
        message: 'Draft rejected',
        duration: 4000,
      });
      router.push('/admin/content');
    } catch {
      setRejectDialogOpen(false);
      setActionError('Failed to reject this draft. Please try again.');
    } finally {
      setIsBusy(false);
      setCurrentAction(null);
    }
  }, [user, pageState, draftId, toast, router]);

  const draft = pageState.status === 'success' ? pageState.draft : null;

  if (authLoading || (!user?.roles?.includes('admin') && !authLoading)) {
    return null;
  }

  return (
    <TavernShell
      active="admin"
      title={draft?.name ?? 'Review draft'}
      actions={
        <div className={styles.headerActions}>
          <Button variant="ghost" href="/admin/content">Back to queue</Button>
          <Pill tone="warn" dot>draft</Pill>
        </div>
      }
    >
      <div
        aria-live="polite"
        aria-busy={pageState.status === 'loading' ? 'true' : 'false'}
      >
        {pageState.status === 'loading' && (
          <PageSkeleton variant="card" lines={5} />
        )}

        {pageState.status === 'not_found' && (
          <div className={`glass ${styles.stateCard}`}>
            <p style={{ color: 'var(--ink-2)' }}>
              This draft was not found. It may have been approved, rejected, or deleted.
            </p>
            <Button variant="ghost" href="/admin/content">Back to queue</Button>
          </div>
        )}

        {pageState.status === 'error' && (
          <div role="alert" className={`glass ${styles.stateCard}`}>
            <p style={{ color: 'var(--bad-ink)' }}>{pageState.message}</p>
            <div className={styles.stateCardActions}>
              <Button variant="ghost" onClick={reload}>Try again</Button>
              <Button variant="ghost" href="/admin/content">Back to queue</Button>
            </div>
          </div>
        )}

        {pageState.status === 'success' && draft && (
          <div className={styles.splitLayout}>
            <SourceProvenancePanel draft={draft} />
            <DraftFieldsEditor
              draft={draft}
              isBusy={isBusy}
              currentAction={currentAction}
              actionError={actionError}
              onSave={handleSave}
              onApprove={handleApprove}
              onRejectOpen={() => setRejectDialogOpen(true)}
              onClearError={() => setActionError(null)}
            />
          </div>
        )}
      </div>

      {/* RejectDialog rendered at page level — outside the splitLayout scroll
          containers — so its position:fixed backdrop is never clipped by
          overflow:auto ancestors (the stacking trap Aoi calls out in the spec). */}
      <RejectDialog
        open={rejectDialogOpen}
        busy={isBusy && currentAction === 'reject'}
        onConfirm={handleRejectConfirm}
        onCancel={() => setRejectDialogOpen(false)}
      />
    </TavernShell>
  );
}

// ── Page export (wraps in ToastProvider) ─────────────────────────────────────

export default function ReviewDraftPage() {
  return (
    <ToastProvider>
      <ReviewPageInner />
    </ToastProvider>
  );
}
